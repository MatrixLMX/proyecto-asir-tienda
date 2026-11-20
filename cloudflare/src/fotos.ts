/** Fotos de los productos, solas: con el código de barras se busca en Open
 *  Food Facts (la misma base de datos abierta que ya da el nombre) y se guarda
 *  la dirección de la foto. No se descarga ni se guarda la imagen.
 *
 *  imagen_url: NULL = aún no se ha buscado; "" = se buscó y no hay (o se
 *  quitó a mano); una dirección = la foto. */
import { Hono } from "hono";
import { type Ctx, soloAdmin } from "./comun";

export const fotos = new Hono<Ctx>();

// Cada búsqueda es una petición a internet: el Worker gratuito admite 50 por
// visita, así que se van buscando de 20 en 20
const POR_TANDA = 20;

/** Solo se aceptan fotos de Open Food Facts, por https. */
export const fotoValida = (url: unknown) =>
  typeof url === "string" && /^https:\/\/images\.openfoodfacts\.org\/[\w./-]+\.(jpg|jpeg|png|webp)$/i.test(url) && url.length <= 300;

export async function fotoDe(codigo: string): Promise<string | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${codigo}.json?fields=image_front_url,image_front_small_url,image_url`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "TiendaASIR/1.0 (proyecto educativo)" }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) { await r.body?.cancel(); return r.status === 404 ? "" : null; }
    const d = await r.json<{ status?: number; product?: Record<string, string | undefined> }>();
    if (d.status !== 1) return "";
    const p = d.product ?? {};
    const foto = p.image_front_url || p.image_url || p.image_front_small_url || "";
    return fotoValida(foto) ? foto : "";
  } catch {
    return null; // sin conexión: se vuelve a intentar otro día
  }
}

/** Busca la foto de los productos con código que aún no la tienen buscada. */
export async function rellenarFotos(db: D1Database, max = POR_TANDA) {
  const { results } = await db.prepare(
    `SELECT id, codigo_barras FROM productos
      WHERE imagen_url IS NULL AND codigo_barras GLOB '[0-9]*' AND length(codigo_barras) BETWEEN 8 AND 14
      ORDER BY activo DESC, id DESC LIMIT ?`,
  ).bind(max).all<{ id: number; codigo_barras: string }>();
  let encontradas = 0;
  const pasos: D1PreparedStatement[] = [];
  for (const p of results) {
    const foto = await fotoDe(p.codigo_barras);
    if (foto === null) continue;
    if (foto) encontradas++;
    pasos.push(db.prepare("UPDATE productos SET imagen_url = ? WHERE id = ? AND imagen_url IS NULL").bind(foto, p.id));
  }
  if (pasos.length) await db.batch(pasos);
  const pendientes = (await db.prepare(
    `SELECT COUNT(*) AS n FROM productos
      WHERE imagen_url IS NULL AND codigo_barras GLOB '[0-9]*' AND length(codigo_barras) BETWEEN 8 AND 14`,
  ).first<number>("n")) ?? 0;
  return { buscadas: results.length, encontradas, pendientes: pasos.length ? pendientes : 0 };
}

// La web lo llama al abrir el Catálogo si hay productos sin foto buscada
fotos.post("/productos/fotos", soloAdmin, async (c) => c.json(await rellenarFotos(c.env.DB)));
