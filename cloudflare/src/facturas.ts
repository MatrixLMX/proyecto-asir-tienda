/** Leer una factura o albarán de proveedor a partir de una foto (o un PDF).
 *
 *  Gemini saca el proveedor, el número y las líneas; aquí se emparejan con el
 *  catálogo (primero lo aprendido de otras facturas, luego el código de barras
 *  y por último el nombre). No se guarda nada: el administrador revisa el
 *  resultado y la compra se registra después con POST /compras, que es quien
 *  aprende cómo llama cada proveedor a cada producto. */
import { Hono } from "hono";
import { ErrorProveedor, MODELO, llamar } from "./asistente";
import { type C, type Ctx, type Datos, cuerpo, fallo, filas, normalizar, soloAdmin } from "./comun";

export const facturas = new Hono<Ctx>();

// El Flash normal lee mejor las facturas; si está saturado se usa el Lite
const MODELO_FACTURAS = "gemini-flash-latest";
const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
const MAX_BASE64 = 14_000_000; // unos 10 MB de fichero

/** Clave con la que se guarda y se busca una descripción de factura. */
export const claveAlias = (s: unknown) => normalizar(s).replace(/[^a-z0-9%,.]+/g, " ").trim().replace(/\s+/g, " ").slice(0, 120);

// Palabras que no ayudan a reconocer un producto ni un proveedor
const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "y", "con", "sin", "en", "para", "x", "u", "ud", "uds", "unid", "unidades",
  "sl", "slu", "sa", "sau", "s", "l", "cb", "sc", "coop", "sociedad", "limitada", "anonima", "distribuciones", "distribucion", "comercial", "grupo", "iberia", "espana"]);
const palabras = (s: string) => normalizar(s).replace(/[^a-z0-9]+/g, " ").split(" ").filter((p) => p.length > 1 && !VACIAS.has(p));

/** Parecido entre la descripción de la factura y el nombre de un producto (0 a 1). */
function parecido(factura: string, producto: string) {
  const f = palabras(factura), p = palabras(producto);
  if (!p.length || !f.length) return 0;
  // Las facturas abrevian: "CC" o "COCA" cuentan como "coca"
  const coincide = (a: string) => f.some((b) => b === a || (a.length >= 4 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))));
  const comunes = p.filter(coincide);
  if (!comunes.some((x) => x.length >= 3 && !/^\d+$/.test(x))) return 0;
  return comunes.length / p.length;
}

const ESQUEMA = {
  type: "OBJECT",
  properties: {
    es_factura: { type: "BOOLEAN", description: "false si la imagen no es una factura, albarán o ticket de compra" },
    proveedor: { type: "STRING", description: "Nombre comercial corto del proveedor que emite la factura (sin S.L., S.A.…)", nullable: true },
    nif_proveedor: { type: "STRING", nullable: true },
    numero_factura: { type: "STRING", nullable: true },
    fecha: { type: "STRING", description: "Fecha de la factura en formato AAAA-MM-DD", nullable: true },
    total_sin_iva: { type: "NUMBER", description: "Base imponible total", nullable: true },
    total_con_iva: { type: "NUMBER", description: "Total a pagar", nullable: true },
    lineas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          descripcion: { type: "STRING", description: "Descripción del artículo tal como aparece en la factura" },
          codigo_barras: { type: "STRING", description: "EAN de 8 a 14 dígitos si aparece en la línea", nullable: true },
          es_producto: { type: "BOOLEAN", description: "false para portes, envases retornables, recargos, descuentos generales y similares" },
          unidades_por_bulto: { type: "NUMBER", description: "Unidades que trae cada caja o pack, si se factura por cajas; si no, 1" },
          cantidad: { type: "NUMBER", description: "Unidades sueltas totales (cajas × unidades por caja), o kilos si se vende a granel" },
          por_kg: { type: "BOOLEAN", description: "true si el artículo se factura por peso" },
          coste_unitario: { type: "NUMBER", description: "Precio de UNA unidad suelta (o de un kg), SIN IVA y con los descuentos de la línea aplicados" },
          iva: { type: "NUMBER", description: "Porcentaje de IVA de la línea (4, 10, 21, 0…), sin el recargo de equivalencia", nullable: true },
          importe: { type: "NUMBER", description: "Importe total de la línea sin IVA", nullable: true },
        },
        required: ["descripcion", "es_producto", "cantidad", "coste_unitario", "unidades_por_bulto", "por_kg"],
      },
    },
  },
  required: ["es_factura", "lineas"],
};

const INSTRUCCIONES = `Eres el lector de facturas de una tienda de alimentación española.
Extrae los datos de la factura o albarán de la imagen. Reglas:
- Una línea por artículo, en el orden de la factura. No inventes líneas ni datos que no se lean.
- Si un artículo se factura por cajas o packs, cantidad = número de unidades sueltas que entran en la tienda y coste_unitario = precio de una unidad suelta.
- coste_unitario siempre SIN IVA y con el descuento de esa línea ya aplicado. Si la factura solo da precios con IVA, quítaselo.
- Los números en formato decimal con punto (1.25), sin símbolo de euro.
- Portes, envases, recargo de equivalencia y descuentos generales van con es_producto = false.`;

interface LineaLeida {
  descripcion: string; codigo_barras?: string | null; es_producto: boolean; unidades_por_bulto: number; cantidad: number;
  por_kg: boolean; coste_unitario: number; iva?: number | null; importe?: number | null;
}
interface Leido {
  es_factura: boolean; proveedor?: string | null; nif_proveedor?: string | null; numero_factura?: string | null; fecha?: string | null;
  total_sin_iva?: number | null; total_con_iva?: number | null; lineas: LineaLeida[];
}

type Pagina = { tipo: string; datos: string };

async function leer(c: C, paginas: Pagina[]): Promise<Leido> {
  const peticion = {
    systemInstruction: { parts: [{ text: INSTRUCCIONES }] },
    contents: [{ role: "user", parts: [
      ...paginas.map((p) => ({ inlineData: { mimeType: p.tipo, data: p.datos } })),
      { text: paginas.length > 1 ? `Extrae los datos de esta factura (${paginas.length} páginas, en orden).` : "Extrae los datos de esta factura." },
    ] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: ESQUEMA, temperature: 0 },
  };
  let partes;
  try {
    partes = await llamar(c, peticion, false, MODELO_FACTURAS, 40000);
  } catch (e) {
    // Saturado, sin cuota o tarda demasiado: se intenta con el modelo ligero
    if (e instanceof ErrorProveedor && e.estado < 429 && e.estado !== 404) throw e;
    partes = await llamar(c, peticion, true, c.env.LLM_MODEL || MODELO, 60000);
  }
  const textoJson = partes.map((p) => p.text ?? "").join("");
  try { return JSON.parse(textoJson) as Leido; } catch { throw fallo(503, "No se ha podido leer la factura. Prueba con otra foto."); }
}

const num = (v: unknown, max = 1e7) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < max ? v : null);

facturas.post("/compras/leer-factura", soloAdmin, async (c) => {
  if (!c.env.GOOGLE_API_KEY) throw fallo(503, "Leer facturas necesita el asistente configurado (falta la clave del proveedor)");
  const d = await cuerpo(c);
  // Una o varias páginas de la misma factura
  const paginas: Datos[] = Array.isArray(d.paginas) ? d.paginas : [d];
  if (!paginas.length || paginas.length > 5) throw fallo(400, "Manda entre 1 y 5 fotos de la misma factura");
  let tamaño = 0;
  for (const p of paginas) {
    if (!TIPOS.includes(String(p?.tipo ?? ""))) throw fallo(400, "Manda fotos (JPG, PNG, WEBP, HEIC) o un PDF");
    if (typeof p.datos !== "string" || !p.datos || !/^[A-Za-z0-9+/=]+$/.test(p.datos.slice(0, 200))) throw fallo(400, "La foto no se ha podido enviar");
    tamaño += p.datos.length;
  }
  if (tamaño > MAX_BASE64) throw fallo(400, "Las fotos pesan demasiado: prueba con menos páginas");

  let leido: Leido;
  try { leido = await leer(c, paginas.map((p) => ({ tipo: String(p.tipo), datos: String(p.datos) }))); } catch (e) {
    if (e instanceof ErrorProveedor) {
      throw fallo(503, e.estado === 429 ? "El lector de facturas está saturado: espera un minuto y vuelve a probar" : "No se ha podido leer la factura ahora mismo. Prueba en un rato.");
    }
    if (e instanceof Error && e.name === "TimeoutError") throw fallo(503, "La factura ha tardado demasiado en leerse. Prueba con una foto más nítida o de una sola página.");
    throw e;
  }
  if (!leido.es_factura || !Array.isArray(leido.lineas)) throw fallo(400, "No parece una factura ni un albarán. Haz la foto de frente y con buena luz.");

  // Proveedor: por nombre, quitando "S.L.", "Distribuciones"…
  const proveedores = await filas<{ id: number; nombre: string }>(c, "SELECT id, nombre FROM proveedores WHERE activo = 1");
  const nombreProv = String(leido.proveedor ?? "").slice(0, 80).trim();
  let proveedorId: number | null = null;
  if (nombreProv) {
    const leidas = palabras(nombreProv);
    const exacto = proveedores.find((p) => normalizar(p.nombre) === normalizar(nombreProv));
    const parecidos = proveedores.filter((p) => { const w = palabras(p.nombre); return w.length > 0 && w.every((x) => leidas.includes(x)); });
    proveedorId = exacto?.id ?? (parecidos.length === 1 ? parecidos[0]!.id : null);
  }

  // Catálogo y lo aprendido de este proveedor
  const productos = await filas<{ id: number; nombre: string; codigo_barras: string | null }>(c, "SELECT id, nombre, codigo_barras FROM productos WHERE activo = 1");
  const alias = new Map((await filas<{ texto: string; producto_id: number }>(c,
    "SELECT texto, producto_id FROM alias_factura WHERE proveedor_id = ?", proveedorId ?? 0)).map((a) => [a.texto, a.producto_id]));
  const activos = new Set(productos.map((p) => p.id));

  const lineas = leido.lineas.slice(0, 150).map((l: LineaLeida) => {
    const descripcion = String(l.descripcion ?? "").trim().slice(0, 120);
    const codigo = /^\d{8,14}$/.test(String(l.codigo_barras ?? "").trim()) ? String(l.codigo_barras).trim() : null;
    let productoId: number | null = null, como: "aprendido" | "codigo" | "nombre" | null = null;
    const a = alias.get(claveAlias(descripcion));
    if (a && activos.has(a)) { productoId = a; como = "aprendido"; }
    if (!productoId && codigo) { const p = productos.find((x) => x.codigo_barras === codigo); if (p) { productoId = p.id; como = "codigo"; } }
    if (!productoId && l.es_producto !== false) {
      const mejor = productos.map((p) => ({ id: p.id, s: parecido(descripcion, p.nombre) })).sort((x, y) => y.s - x.s);
      if (mejor[0] && mejor[0].s >= 0.6 && (mejor[1]?.s ?? 0) < mejor[0].s) { productoId = mejor[0].id; como = "nombre"; }
    }
    return {
      descripcion, codigo_barras: codigo, es_producto: l.es_producto !== false,
      cantidad: num(l.cantidad, 1e6) ?? 0, por_kg: !!l.por_kg, unidades_por_bulto: num(l.unidades_por_bulto, 10000) ?? 1,
      coste_unitario: num(l.coste_unitario) ?? 0, iva: num(l.iva, 100), importe: num(l.importe),
      producto_id: productoId, como,
    };
  });

  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(leido.fecha ?? "")) ? leido.fecha : null;
  return c.json({
    proveedor: nombreProv || null, nif_proveedor: leido.nif_proveedor ? String(leido.nif_proveedor).slice(0, 20) : null, proveedor_id: proveedorId,
    numero_factura: leido.numero_factura ? String(leido.numero_factura).slice(0, 40) : null, fecha,
    total_sin_iva: num(leido.total_sin_iva), total_con_iva: num(leido.total_con_iva), lineas,
  } satisfies Datos);
});
