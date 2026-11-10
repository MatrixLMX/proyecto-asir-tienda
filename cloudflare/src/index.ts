/** API de la tienda en Cloudflare Workers + D1. Mismas rutas y respuestas que
 *  la versión FastAPI (app/backend/app/main.py), para no tocar el frontend. */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sign, verify } from "hono/jwt";
import { admin, claveValida } from "./admin";
import { asistente } from "./asistente";
import { avisoDiario, avisos } from "./avisos";
import { catalogo } from "./catalogo";
import { comprobarPassword, hashPassword } from "./claves";
import { type C, type Ctx, type Entorno, type Usuario, cuerpo, escribir, fallo } from "./comun";
import { estadisticas } from "./estadisticas";
import { fiado } from "./fiado";
import { inventario } from "./inventario";
import { notas } from "./notas";
import { ofertas } from "./ofertas";
import { ventas } from "./ventas";

const HORAS_SESION = 12;
const MAX_INTENTOS = 5;

const app = new Hono<Ctx>();

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
//  Límite de intentos: se mira antes de calcular el hash, para que un ataque
//  no gaste la CPU de la cuenta.
// ---------------------------------------------------------------------
const ipDe = (c: C) => c.req.header("CF-Connecting-IP") ?? "local";

async function comprobarBloqueo(c: C) {
  const intentos = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM intentos_login WHERE ip = ? AND fecha > datetime('now', '-15 minutes')",
  ).bind(ipDe(c)).first<number>("n");
  if ((intentos ?? 0) >= MAX_INTENTOS) {
    throw fallo(429, "Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar.");
  }
}

async function apuntarFallo(c: C) {
  const db = c.env.DB;
  await db.batch([
    db.prepare("DELETE FROM intentos_login WHERE fecha <= datetime('now', '-15 minutes')"),
    db.prepare("INSERT INTO intentos_login (ip) VALUES (?)").bind(ipDe(c)),
  ]);
}

app.post("/api/auth/login", async (c) => {
  const datos = await cuerpo(c);
  if (typeof datos.usuario !== "string" || typeof datos.password !== "string") {
    throw fallo(400, "Faltan el usuario o la contraseña");
  }
  await comprobarBloqueo(c);

  const db = c.env.DB;
  const fila = await db.prepare(
    "SELECT usuario, nombre, rol, password_hash FROM usuarios_app WHERE usuario = ? AND activo",
  ).bind(datos.usuario).first<Usuario & { password_hash: string }>();

  if (!fila || !(await comprobarPassword(datos.password, fila.password_hash))) {
    await apuntarFallo(c);
    throw fallo(401, "Usuario o contraseña incorrectos");
  }
  await db.prepare("DELETE FROM intentos_login WHERE ip = ?").bind(ipDe(c)).run();

  const usuario: Usuario = { usuario: fila.usuario, nombre: fila.nombre, rol: fila.rol };
  const token = await sign(
    { sub: usuario.usuario, exp: Math.floor(Date.now() / 1000) + HORAS_SESION * 3600 },
    c.env.JWT_SECRET, "HS256");
  return c.json({ token, usuario });
});

// ---------------------------------------------------------------------
//  Sesión. Ahora la web está en internet: en cada petición se mira que el
//  usuario siga activo y con qué perfil, para que desactivar a alguien o
//  quitarle el perfil de administrador valga al momento, no al caducar la sesión.
// ---------------------------------------------------------------------
const conAcceso = new Hono<Ctx>();

conAcceso.use("*", async (c, siguiente) => {
  const cabecera = c.req.header("Authorization");
  if (!cabecera?.startsWith("Bearer ")) throw fallo(401, "Inicia sesión");
  let sub: string;
  try {
    sub = String((await verify(cabecera.slice(7), c.env.JWT_SECRET, "HS256")).sub);
  } catch {
    throw fallo(401, "Sesión caducada o no válida");
  }
  const u = await c.env.DB.prepare("SELECT usuario, nombre, rol FROM usuarios_app WHERE usuario = ? AND activo")
    .bind(sub).first<Usuario>();
  if (!u) throw fallo(401, "Sesión caducada o no válida");
  c.set("u", u);
  await siguiente();
});

conAcceso.get("/auth/yo", (c) => c.json({ ...c.get("u"), asistente: Boolean(c.env.GOOGLE_API_KEY) }));

conAcceso.post("/auth/cambiar-password", async (c) => {
  const d = await cuerpo(c);
  if (typeof d.actual !== "string") throw fallo(400, "La contraseña actual no es correcta");
  const nueva = claveValida(d.nueva);
  await comprobarBloqueo(c);

  const db = c.env.DB;
  const { usuario } = c.get("u");
  const guardado = await db.prepare("SELECT password_hash FROM usuarios_app WHERE usuario = ?").bind(usuario).first<string>("password_hash");
  if (!guardado || !(await comprobarPassword(d.actual, guardado))) {
    await apuntarFallo(c);
    throw fallo(400, "La contraseña actual no es correcta");
  }
  await escribir(c, [db.prepare("UPDATE usuarios_app SET password_hash = ? WHERE usuario = ?").bind(await hashPassword(nueva), usuario)]);
  return c.json({ ok: true });
});

conAcceso.route("/", ventas);
conAcceso.route("/", catalogo);
conAcceso.route("/", admin);
conAcceso.route("/", asistente);
conAcceso.route("/", notas);
conAcceso.route("/", ofertas);
conAcceso.route("/", fiado);
conAcceso.route("/", inventario);
conAcceso.route("/", avisos);
conAcceso.route("/", estadisticas);

conAcceso.all("*", () => { throw fallo(404, "No encontrado"); });

app.route("/api", conAcceso);

export default {
  fetch: app.fetch,
  // El cron de wrangler.toml: el aviso de cada mañana
  scheduled: (_evento: ScheduledController, env: Entorno, ctx: ExecutionContext) => { ctx.waitUntil(avisoDiario(env)); },
};
