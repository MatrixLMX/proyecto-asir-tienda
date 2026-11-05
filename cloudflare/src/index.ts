/** API de la tienda en Cloudflare Workers + D1. Mismas rutas y respuestas que
 *  la versión FastAPI (app/backend/app/main.py), para no tocar el frontend. */
import { Hono, type Context, type Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { sign, verify } from "hono/jwt";
import { comprobarPassword } from "./claves";

interface Entorno {
  DB: D1Database;
  JWT_SECRET: string;
  NOMBRE_TIENDA?: string;
  NIF_TIENDA?: string;
  DIRECCION_TIENDA?: string;
}
interface Usuario { usuario: string; nombre: string; rol: "admin" | "dependiente" }
type Ctx = { Bindings: Entorno; Variables: { u: Usuario } };

const HORAS_SESION = 12;
const MAX_INTENTOS = 5;

const app = new Hono<Ctx>();

const fallo = (status: 400 | 401 | 404 | 429, detail: string) =>
  new HTTPException(status, { res: Response.json({ detail }, { status }) });

app.onError((e, c) => {
  if (e instanceof HTTPException) return e.getResponse();
  console.error(e);
  return c.json({ detail: "Error interno del servidor" }, 500);
});

// ---------------------------------------------------------------------
//  Rutas públicas: la pantalla de login las necesita antes de entrar
// ---------------------------------------------------------------------
app.get("/api/salud", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ ok: true });
});

app.get("/api/tienda", (c) => c.json({
  nombre: c.env.NOMBRE_TIENDA ?? "Mi Tienda",
  nif: c.env.NIF_TIENDA ?? "",
  direccion: c.env.DIRECCION_TIENDA ?? "",
}));

// ---------------------------------------------------------------------
//  Login
// ---------------------------------------------------------------------
app.post("/api/auth/login", async (c) => {
  const datos = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (typeof datos.usuario !== "string" || typeof datos.password !== "string") {
    throw fallo(400, "Faltan el usuario o la contraseña");
  }
  const db = c.env.DB;
  const ip = c.req.header("CF-Connecting-IP") ?? "local";

  // Antes de calcular el hash: un ataque no debe gastar la CPU de la cuenta
  const intentos = await db.prepare(
    "SELECT COUNT(*) AS n FROM intentos_login WHERE ip = ? AND fecha > datetime('now', '-15 minutes')",
  ).bind(ip).first<number>("n");
  if ((intentos ?? 0) >= MAX_INTENTOS) {
    throw fallo(429, "Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar.");
  }

  const fila = await db.prepare(
    "SELECT usuario, nombre, rol, password_hash FROM usuarios_app WHERE usuario = ? AND activo",
  ).bind(datos.usuario).first<Usuario & { password_hash: string }>();

  if (!fila || !(await comprobarPassword(datos.password, fila.password_hash))) {
    await db.batch([
      db.prepare("DELETE FROM intentos_login WHERE fecha <= datetime('now', '-15 minutes')"),
      db.prepare("INSERT INTO intentos_login (ip) VALUES (?)").bind(ip),
    ]);
    throw fallo(401, "Usuario o contraseña incorrectos");
  }
  await db.prepare("DELETE FROM intentos_login WHERE ip = ?").bind(ip).run();

  const usuario: Usuario = { usuario: fila.usuario, nombre: fila.nombre, rol: fila.rol };
  const token = await sign(
    { sub: usuario.usuario, nombre: usuario.nombre, rol: usuario.rol, exp: Math.floor(Date.now() / 1000) + HORAS_SESION * 3600 },
    c.env.JWT_SECRET, "HS256");
  return c.json({ token, usuario });
});

async function conSesion(c: Context<Ctx>, siguiente: Next) {
  const cabecera = c.req.header("Authorization");
  if (!cabecera?.startsWith("Bearer ")) throw fallo(401, "Inicia sesión");
  try {
    const p = await verify(cabecera.slice(7), c.env.JWT_SECRET, "HS256");
    c.set("u", { usuario: String(p.sub), nombre: String(p.nombre), rol: p.rol as Usuario["rol"] });
  } catch {
    throw fallo(401, "Sesión caducada o no válida");
  }
  await siguiente();
}

const conAcceso = new Hono<Ctx>();
conAcceso.use("*", conSesion);

conAcceso.get("/auth/yo", (c) => c.json({ ...c.get("u"), asistente: false }));

// ---------------------------------------------------------------------
//  Consultas
// ---------------------------------------------------------------------
const todas = async (c: Context<Ctx>, sql: string, ...params: unknown[]) =>
  c.json((await c.env.DB.prepare(sql).bind(...params).all()).results);

conAcceso.get("/productos/mas-vendidos", async (c) => {
  const limite = Math.min(Math.max(Number(c.req.query("limite") ?? 12) || 12, 1), 48);
  const { results } = await c.env.DB.prepare(
    "SELECT producto_id FROM v_mas_vendidos ORDER BY tickets DESC, producto_id LIMIT ?",
  ).bind(limite).all<{ producto_id: number }>();
  return c.json(results.map((f) => f.producto_id));
});

conAcceso.get("/productos", (c) => {
  const q = c.req.query("q") ?? "";
  const like = `%${q}%`;
  return todas(c, "SELECT * FROM v_stock WHERE producto LIKE ? OR categoria LIKE ? OR codigo_barras = ? ORDER BY producto", like, like, q);
});

conAcceso.get("/alertas/stock", (c) => todas(c, "SELECT * FROM v_alertas_stock ORDER BY stock_actual"));
conAcceso.get("/alertas/caducidades", (c) => todas(c, "SELECT * FROM v_caducidades ORDER BY fecha_caducidad"));

// ---------------------------------------------------------------------
//  Ventas
// ---------------------------------------------------------------------
const METODOS = ["efectivo", "tarjeta", "bizum", "mixto"];

const ERRORES_VENTA: Record<string, string> = {
  STOCK_INSUFICIENTE: "Stock insuficiente: otra venta acaba de gastarlo. Revisa el ticket.",
  PRODUCTO_BAJA: "Hay un producto dado de baja en el ticket",
  SOLO_UNIDADES: "Hay un producto que se vende por unidades, no por peso",
  MIXTO_EXCEDE: "Con tarjeta y Bizum se cobra más que el total",
  MIXTO_PARTES: "Un pago mixto necesita al menos dos formas de pago",
};

const numero = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : NaN);

conAcceso.post("/ventas", async (c) => {
  const v = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const metodo = String(v.metodo_pago ?? "efectivo");
  const entrada = v.lineas;
  if (!METODOS.includes(metodo)) throw fallo(400, "Forma de pago no válida");
  if (!Array.isArray(entrada) || !entrada.length) throw fallo(400, "El ticket está vacío");

  const lineas = entrada.map((l: Record<string, unknown>) => ({
    producto_id: numero(l?.producto_id),
    milli: Math.round(numero(l?.cantidad) * 1000),
  }));
  if (lineas.some((l) => !Number.isInteger(l.producto_id) || !(l.milli > 0) || l.milli > 1e9)) {
    throw fallo(400, "Revisa los productos y las cantidades del ticket");
  }
  const mixto = metodo === "mixto";
  const tarjeta = mixto ? Math.round(numero(v.pago_tarjeta ?? 0) * 100) : 0;
  const bizum = mixto ? Math.round(numero(v.pago_bizum ?? 0) * 100) : 0;
  if (!(tarjeta >= 0) || !(bizum >= 0)) throw fallo(400, "Importe de pago no válido");

  const db = c.env.DB;

  // Comprobación previa solo para dar un mensaje con nombre y cantidad. La
  // garantía real son los triggers, dentro de la transacción.
  const pedido = new Map<number, number>();
  for (const l of lineas) pedido.set(l.producto_id, (pedido.get(l.producto_id) ?? 0) + l.milli);
  const ids = [...pedido.keys()];
  const { results: productos } = await db.prepare(
    `SELECT id, nombre, stock_milli FROM productos WHERE id IN (${ids.map(() => "?").join(",")})`,
  ).bind(...ids).all<{ id: number; nombre: string; stock_milli: number }>();
  if (productos.length !== ids.length) throw fallo(400, "Hay un producto que no existe en el ticket");
  for (const p of productos) {
    if (p.stock_milli < pedido.get(p.id)!) {
      throw fallo(400, `Stock insuficiente de "${p.nombre}": quedan ${p.stock_milli / 1000}`);
    }
  }

  // D1 ejecuta el batch como una transacción: si algo falla, no se guarda nada.
  // Dentro de ella nadie más escribe, así que MAX(id) es la venta recién creada.
  const estaVenta = "(SELECT MAX(id) FROM ventas)";
  const pasos = [
    db.prepare("INSERT INTO ventas (metodo_pago, pago_tarjeta_cent, pago_bizum_cent, usuario) VALUES (?, ?, ?, ?)")
      .bind(metodo, tarjeta, bizum, c.get("u").usuario),
    ...lineas.map((l) => db.prepare(
      `INSERT INTO lineas_venta (venta_id, producto_id, cantidad_milli, precio_unitario_cent, iva_cp, coste_unitario_dm)
       SELECT ${estaVenta}, p.id, ?, p.precio_venta_cent, i.porcentaje_cp, p.coste_medio_dm
         FROM productos p JOIN tipos_iva i ON i.id = p.iva_id WHERE p.id = ?`,
    ).bind(l.milli, l.producto_id)),
    db.prepare(`UPDATE ventas SET cerrada = 1 WHERE id = ${estaVenta}`),
    db.prepare(`SELECT id, fecha, total_cent FROM ventas WHERE id = ${estaVenta}`),
  ];

  let resultado: D1Result[];
  try {
    resultado = await db.batch(pasos);
  } catch (e) {
    const texto = String(e);
    const codigo = Object.keys(ERRORES_VENTA).find((k) => texto.includes(k));
    if (codigo) throw fallo(400, ERRORES_VENTA[codigo]!);
    if (texto.includes("stock_milli") || texto.includes("restante_milli")) throw fallo(400, ERRORES_VENTA.STOCK_INSUFICIENTE!);
    throw e;
  }
  const fila = resultado.at(-1)!.results[0] as { id: number; fecha: string; total_cent: number };
  return c.json({ id: fila.id, fecha: `${fila.fecha.replace(" ", "T")}Z`, total: fila.total_cent / 100 });
});

conAcceso.all("*", () => { throw fallo(404, "Esta función aún no está disponible en la versión de prueba"); });

app.route("/api", conAcceso);

export default app;
