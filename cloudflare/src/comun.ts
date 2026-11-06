/** Lo que comparten todas las rutas: tipos, errores, validación y escritura. */
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

export interface Entorno {
  DB: D1Database;
  JWT_SECRET: string;
  NOMBRE_TIENDA?: string;
  NIF_TIENDA?: string;
  DIRECCION_TIENDA?: string;
  GOOGLE_API_KEY?: string;
  LLM_MODEL?: string;
  VAPID_JWK?: string;
}
export interface Usuario { usuario: string; nombre: string; rol: "admin" | "dependiente" }
export type Ctx = { Bindings: Entorno; Variables: { u: Usuario } };
export type C = Context<Ctx>;
export type Datos = Record<string, unknown>;

export const fallo = (status: 400 | 401 | 403 | 404 | 409 | 429 | 503, detail: string) =>
  new HTTPException(status, { res: Response.json({ detail }, { status }) });

export async function soloAdmin(c: C, siguiente: Next) {
  if (c.get("u").rol !== "admin") throw fallo(403, "Solo para el administrador");
  await siguiente();
}

// ---------------------------------------------------------------------
//  Lectura
// ---------------------------------------------------------------------
export const filas = async <T = Datos>(c: C, sql: string, ...params: unknown[]) =>
  (await c.env.DB.prepare(sql).bind(...params).all<T>()).results;

export const lista = async (c: C, sql: string, ...params: unknown[]) => c.json(await filas(c, sql, ...params));

export const hoy = async (c: C) => (await c.env.DB.prepare("SELECT hoy FROM v_ahora").first<string>("hoy"))!;

// SQLite no ordena ni busca bien con acentos: "Ácido" iría detrás de "Zumo" y
// "limon" no encontraría "Limón". Se hace aquí, con las reglas del español.
const colacion = new Intl.Collator("es", { sensitivity: "base", numeric: true });
export const ordenar = <T>(lista: T[], campo: keyof T) =>
  lista.sort((a, b) => colacion.compare(String(a[campo] ?? ""), String(b[campo] ?? "")));

export const normalizar = (s: unknown) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// ---------------------------------------------------------------------
//  Escritura: una transacción que deja dicho quién hace el cambio para los
//  triggers de auditoría (lo que en MariaDB era @usuario_app).
// ---------------------------------------------------------------------
const ERRORES: Record<string, string> = {
  STOCK_INSUFICIENTE: "Stock insuficiente: otra venta acaba de gastarlo. Revisa el ticket.",
  PRODUCTO_BAJA: "Hay un producto dado de baja en el ticket",
  SOLO_UNIDADES: "Hay un producto que se vende por unidades, no por peso",
  MIXTO_EXCEDE: "Las partes del pago suman más que el total",
  MIXTO_PARTES: "Un pago mixto necesita al menos dos formas de pago",
  CADUCIDAD_SIN_FECHA: "Ese producto controla caducidad: indica la fecha o configura su vida útil",
  MERMA_STOCK: "La merma es mayor que el stock disponible",
  MERMA_LOTE: "El lote no corresponde a ese producto",
  FIADO_SIN_CLIENTE: "Para fiar hay que elegir un cliente",
  DEVOLUCION_EXCEDE: "No se puede devolver más de lo que se vendió",
  DEVOLUCION_FIADO: "El cliente debe menos que eso: devuélvelo en efectivo, tarjeta o Bizum",
  VENTA_CON_DEVOLUCIONES: "Este ticket ya tiene devoluciones: devuelve lo que falte en vez de anularlo",
  ANULAR_FIADO_PAGADO: "El cliente ya ha pagado parte de esto: haz una devolución en vez de anular el ticket",
  PAGO_EXCEDE: "Es más de lo que debe el cliente",
};

function traducir(e: unknown): never {
  const texto = String(e);
  const codigo = Object.keys(ERRORES).find((k) => texto.includes(k));
  if (codigo) throw fallo(400, ERRORES[codigo]!);
  if (texto.includes("UNIQUE constraint")) {
    const que = texto.includes("codigo_barras") ? "código de barras"
      : texto.includes("nombre") || texto.includes("usuario") ? "nombre" : "dato";
    throw fallo(409, `Ya existe otro registro con ese ${que}.`);
  }
  if (texto.includes("FOREIGN KEY constraint")) throw fallo(400, "Hace referencia a algo que no existe o está en uso.");
  if (texto.includes("CHECK constraint")) {
    if (texto.includes("stock_milli") || texto.includes("restante_milli")) throw fallo(400, ERRORES.STOCK_INSUFICIENTE!);
    throw fallo(400, "Datos no válidos.");
  }
  throw e;
}

export async function escribir(c: C, pasos: D1PreparedStatement[]): Promise<D1Result[]> {
  const db = c.env.DB;
  try {
    const r = await db.batch([
      db.prepare("INSERT OR REPLACE INTO contexto_app (id, usuario) VALUES (1, ?)").bind(c.get("u").usuario),
      ...pasos,
      db.prepare("DELETE FROM contexto_app"),
    ]);
    return r.slice(1, -1);
  } catch (e) {
    return traducir(e);
  }
}

/** UPDATE solo con los campos recibidos. Las columnas salen del mapa, nunca del usuario. */
export type Campo = [columna: string, convertir: (v: unknown) => unknown];

export function cambios(datos: Datos, mapa: Record<string, Campo>) {
  const sets: string[] = [];
  const valores: unknown[] = [];
  for (const [campo, [columna, convertir]] of Object.entries(mapa)) {
    if (campo in datos) {
      sets.push(`${columna} = ?`);
      valores.push(convertir(datos[campo]));
    }
  }
  return { sets: sets.join(", "), valores };
}

export async function actualizar(c: C, tabla: string, id: number, datos: Datos, mapa: Record<string, Campo>) {
  const { sets, valores } = cambios(datos, mapa);
  if (sets) {
    if (!(await c.env.DB.prepare(`SELECT id FROM ${tabla} WHERE id = ?`).bind(id).first())) throw fallo(404, "No encontrado");
    await escribir(c, [c.env.DB.prepare(`UPDATE ${tabla} SET ${sets} WHERE id = ?`).bind(...valores, id)]);
  }
  return c.json({ ok: true });
}

// ---------------------------------------------------------------------
//  Validación de lo que llega (lo que hacía Pydantic)
// ---------------------------------------------------------------------
export const cuerpo = (c: C) => c.req.json<Datos>().catch(() => ({}) as Datos).then((d) => {
  if (typeof d !== "object" || d === null || Array.isArray(d)) throw fallo(400, "Revisa los datos del formulario");
  return d;
});

export function numero(v: unknown, que: string, max = 1e7): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) throw fallo(400, `Revisa ${que}`);
  return v;
}
export const cent = (v: unknown, que: string) => Math.round(numero(v, que) * 100);
export const dm = (v: unknown, que: string) => Math.round(numero(v, que) * 10000);
export const milli = (v: unknown, que: string) => Math.round(numero(v, que, 1e6) * 1000);

export function entero(v: unknown, que: string, max = 2 ** 31): number {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > max) throw fallo(400, `Revisa ${que}`);
  return v as number;
}
export const enteroONulo = (v: unknown, que: string, max?: number) => (v === null || v === undefined ? null : entero(v, que, max));

/** Texto recortado. Vacío o null da null (o error si es obligatorio). */
export function texto(v: unknown, que: string, max: number, obligatorio = false): string | null {
  if (v === null || v === undefined || v === "") {
    if (obligatorio) throw fallo(400, `Falta ${que}`);
    return null;
  }
  if (typeof v !== "string") throw fallo(400, `Revisa ${que}`);
  const t = v.trim();
  if (!t && obligatorio) throw fallo(400, `Falta ${que}`);
  if (t.length > max) throw fallo(400, `${que} es demasiado largo`);
  return t || null;
}

export function fechaONula(v: unknown, que = "la fecha"): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw fallo(400, `Revisa ${que}`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw fallo(400, `Revisa ${que}`);
  return v;
}

export const booleano = (v: unknown, que: string) => {
  if (typeof v !== "boolean" && v !== 0 && v !== 1) throw fallo(400, `Revisa ${que}`);
  return v ? 1 : 0;
};

export function idRuta(c: C, nombre = "id"): number {
  const n = Number(c.req.param(nombre));
  if (!Number.isInteger(n) || n < 1) throw fallo(404, "No encontrado");
  return n;
}

/** Parámetro entero de la URL, con valor por defecto y límites. */
export function enteroUrl(c: C, nombre: string, defecto: number, min: number, max: number): number {
  const crudo = c.req.query(nombre);
  const n = crudo === undefined ? defecto : Number(crudo);
  if (!Number.isInteger(n)) throw fallo(400, `Revisa ${nombre}`);
  return Math.min(Math.max(n, min), max);
}
