/** Catálogo y compras. Lo que incluye costes es solo para el administrador. */
import { Hono } from "hono";
import {
  type C, type Campo, type Ctx, type Datos, actualizar, booleano, cambios, cent, cuerpo, dm, entero, enteroONulo,
  enteroUrl, escribir, fallo, fechaONula, filas, idRuta, lista, milli, normalizar, ordenar, soloAdmin, texto,
} from "./comun";
import { claveAlias } from "./facturas";
import { fotoDe, fotoValida } from "./fotos";

export const catalogo = new Hono<Ctx>();

// ---------------------------------------------------------------------
//  Lectura para todos los perfiles (sin costes)
// ---------------------------------------------------------------------
catalogo.get("/productos/mas-vendidos", async (c) => {
  const f = await filas<{ producto_id: number }>(
    c, "SELECT producto_id FROM v_mas_vendidos ORDER BY tickets DESC, producto_id LIMIT ?", enteroUrl(c, "limite", 12, 1, 48));
  return c.json(f.map((x) => x.producto_id));
});

catalogo.get("/productos/admin", soloAdmin, async (c) =>
  c.json(ordenar(await filas<{ nombre: string }>(c, "SELECT * FROM v_productos_admin"), "nombre")));

catalogo.get("/productos", async (c) => {
  const q = normalizar(c.req.query("q") ?? "");
  const productos = await filas<{ producto: string; categoria: string; codigo_barras: string | null }>(c, "SELECT * FROM v_stock");
  const hallados = q
    ? productos.filter((p) => normalizar(p.producto).includes(q) || normalizar(p.categoria).includes(q) || p.codigo_barras === q)
    : productos;
  return c.json(ordenar(hallados, "producto"));
});

catalogo.get("/categorias", async (c) =>
  c.json(ordenar(await filas<{ nombre: string }>(c, "SELECT id, nombre, iva_id FROM categorias WHERE activa"), "nombre")));

catalogo.get("/alertas/stock", (c) => lista(c, "SELECT * FROM v_alertas_stock ORDER BY stock_actual"));
catalogo.get("/alertas/caducidades", (c) => lista(c, "SELECT * FROM v_caducidades ORDER BY fecha_caducidad"));

// ---------------------------------------------------------------------
//  Categorías, proveedores e IVA
// ---------------------------------------------------------------------
catalogo.get("/categorias/todas", soloAdmin, async (c) => c.json(ordenar(await filas<{ nombre: string }>(c, `
  SELECT c.*, COUNT(p.id) AS productos FROM categorias c
    LEFT JOIN productos p ON p.categoria_id = c.id AND p.activo GROUP BY c.id`), "nombre")));

catalogo.post("/categorias", soloAdmin, async (c) => {
  const nombre = texto((await cuerpo(c)).nombre, "el nombre", 50, true);
  const [r] = await escribir(c, [c.env.DB.prepare("INSERT INTO categorias (nombre) VALUES (?)").bind(nombre)]);
  return c.json({ id: r!.meta.last_row_id, nombre });
});

// Lo que no admite null: si llega null, se deja como está (igual que FastAPI)
const sinNulos = (d: Datos, obligatorios: string[]) =>
  Object.fromEntries(Object.entries(d).filter(([k, v]) => v !== null || !obligatorios.includes(k)));

catalogo.patch("/categorias/:id", soloAdmin, async (c) =>
  actualizar(c, "categorias", idRuta(c), sinNulos(await cuerpo(c), ["nombre", "activa"]), {
    nombre: ["nombre", (v) => texto(v, "el nombre", 50, true)],
    activa: ["activa", (v) => booleano(v, "si está activa")],
  }));

catalogo.get("/proveedores", soloAdmin, async (c) => c.json(ordenar(await filas<{ nombre: string }>(
  c, `SELECT * FROM proveedores ${c.req.query("todos") === "true" ? "" : "WHERE activo"}`), "nombre")));

const CAMPOS_PROVEEDOR: Record<string, Campo> = {
  nombre: ["nombre", (v) => texto(v, "el nombre", 80, true)],
  contacto: ["contacto", (v) => texto(v, "el contacto", 80)],
  telefono: ["telefono", (v) => texto(v, "el teléfono", 20)],
  email: ["email", (v) => texto(v, "el correo", 120)],
  notas: ["notas", (v) => texto(v, "las notas", 255)],
};

catalogo.post("/proveedores", soloAdmin, async (c) => {
  const p = await cuerpo(c);
  const nombre = texto(p.nombre, "el nombre", 80, true);
  const [r] = await escribir(c, [c.env.DB.prepare(
    "INSERT INTO proveedores (nombre, contacto, telefono, email, notas) VALUES (?, ?, ?, ?, ?)",
  ).bind(nombre, CAMPOS_PROVEEDOR.contacto![1](p.contacto), CAMPOS_PROVEEDOR.telefono![1](p.telefono),
    CAMPOS_PROVEEDOR.email![1](p.email), CAMPOS_PROVEEDOR.notas![1](p.notas))]);
  return c.json({ id: r!.meta.last_row_id, nombre });
});

catalogo.patch("/proveedores/:id", soloAdmin, async (c) =>
  actualizar(c, "proveedores", idRuta(c), sinNulos(await cuerpo(c), ["nombre", "activo"]), {
    ...CAMPOS_PROVEEDOR,
    activo: ["activo", (v) => booleano(v, "si está activo")],
  }));

catalogo.get("/tipos-iva", soloAdmin, (c) =>
  lista(c, "SELECT id, nombre, porcentaje_cp / 100.0 AS porcentaje FROM tipos_iva ORDER BY porcentaje_cp"));

// ---------------------------------------------------------------------
//  Compras: una cabecera y sus líneas, con la misma regla de caducidad
//  también para el stock inicial de un producto nuevo.
// ---------------------------------------------------------------------
export const estaCompra = "(SELECT MAX(id) FROM compras)";

export const pasoLineaCompra = (c: C, productoSql: string, cantidad: number, coste: number, caducidad: string | null, ...idProducto: number[]) =>
  c.env.DB.prepare(
    `INSERT INTO lineas_compra (compra_id, producto_id, cantidad_milli, coste_unitario_dm, fecha_caducidad)
     SELECT ${estaCompra}, p.id, ?, ?,
            CASE WHEN p.controla_caducidad
                 THEN COALESCE(?, date((SELECT hoy FROM v_ahora), '+' || p.vida_util_dias || ' days')) END
       FROM productos p WHERE p.id = ${productoSql}`,
  ).bind(cantidad, coste, caducidad, ...idProducto);

export const pasoCompra = (c: C, proveedor: number | null, factura: string | null, notas: string | null) =>
  c.env.DB.prepare("INSERT INTO compras (proveedor_id, numero_factura, notas, usuario) VALUES (?, ?, ?, ?)")
    .bind(proveedor, factura, notas, c.get("u").usuario);

catalogo.post("/compras", soloAdmin, async (c) => {
  const d = await cuerpo(c);
  if (!Array.isArray(d.lineas) || !d.lineas.length) throw fallo(400, "La compra no tiene líneas");
  const lineas = d.lineas.map((l: Datos) => ({
    producto_id: entero(l?.producto_id, "el producto"),
    cantidad: milli(l?.cantidad, "la cantidad"),
    caducidad: fechaONula(l?.fecha_caducidad, "la fecha de caducidad"),
    // Sin precio (aún no ha llegado la factura): se usa el coste que ya tenía,
    // para no estropear el coste medio
    coste: l?.coste_unitario === null || l?.coste_unitario === undefined || l?.coste_unitario === "" ? null : dm(l.coste_unitario, "el coste"),
    // Descripción en la factura leída de una foto: se aprende para la próxima
    alias: claveAlias(texto(l?.texto_factura, "la descripción", 200) ?? ""),
  }));
  if (lineas.some((l) => !(l.cantidad > 0))) throw fallo(400, "Revisa la cantidad");

  // Un INSERT ... SELECT de un producto inexistente no daría error: no insertaría nada
  const ids = [...new Set(lineas.map((l) => l.producto_id))];
  const productos = await filas<{ id: number; nombre: string; controla_caducidad: number; vida_util_dias: number | null; coste_medio_dm: number }>(
    c, `SELECT id, nombre, controla_caducidad, vida_util_dias, coste_medio_dm FROM productos WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
  if (productos.length !== ids.length) throw fallo(400, "Hace referencia a algo que no existe o está en uso.");
  for (const l of lineas) {
    const p = productos.find((x) => x.id === l.producto_id)!;
    if (p.controla_caducidad && !l.caducidad && !p.vida_util_dias) {
      throw fallo(400, `"${p.nombre}" controla caducidad: indica la fecha o configura su vida útil`);
    }
  }

  const proveedor = enteroONulo(d.proveedor_id, "el proveedor");
  const r = await escribir(c, [
    pasoCompra(c, proveedor, texto(d.numero_factura, "la factura", 40), texto(d.notas, "las notas", 255)),
    ...lineas.map((l) => pasoLineaCompra(c, "?", l.cantidad, l.coste ?? productos.find((x) => x.id === l.producto_id)!.coste_medio_dm, l.caducidad, l.producto_id)),
    ...lineas.filter((l) => l.alias).map((l) => c.env.DB.prepare(
      `INSERT INTO alias_factura (proveedor_id, texto, producto_id) VALUES (?, ?, ?)
       ON CONFLICT (proveedor_id, texto) DO UPDATE SET producto_id = excluded.producto_id`,
    ).bind(proveedor ?? 0, l.alias, l.producto_id)),
    c.env.DB.prepare(`SELECT id, total_cent / 100.0 AS total_sin_iva FROM compras WHERE id = ${estaCompra}`),
  ]);
  return c.json(r.at(-1)!.results[0]);
});

catalogo.get("/compras", soloAdmin, (c) => lista(c, `
  SELECT c.id, c.fecha, c.numero_factura, c.total_cent / 100.0 AS total_sin_iva, c.usuario, c.notas,
         pr.nombre AS proveedor, COUNT(lc.id) AS lineas
    FROM compras c
    LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
    LEFT JOIN lineas_compra lc ON lc.compra_id = c.id
   WHERE c.fecha >= (SELECT date(hoy, '-' || ? || ' days') FROM v_ahora)
   GROUP BY c.id ORDER BY c.fecha DESC, c.id DESC`, enteroUrl(c, "dias", 90, 0, 36500)));

catalogo.get("/compras/:id", soloAdmin, async (c) => {
  const id = idRuta(c);
  const [compra] = await filas(c, `
    SELECT c.id, c.proveedor_id, c.fecha, c.numero_factura, c.total_cent / 100.0 AS total_sin_iva, c.usuario, c.notas,
           pr.nombre AS proveedor
      FROM compras c LEFT JOIN proveedores pr ON pr.id = c.proveedor_id WHERE c.id = ?`, id);
  if (!compra) throw fallo(404, "Compra no encontrada");
  const lineas = await filas(c, `
    SELECT lc.id, p.nombre AS producto, p.unidad_medida, lc.cantidad_milli / 1000.0 AS cantidad,
           lc.coste_unitario_dm / 10000.0 AS coste_unitario, lc.fecha_caducidad,
           ((lc.cantidad_milli * lc.coste_unitario_dm + 50000) / 100000) / 100.0 AS subtotal
      FROM lineas_compra lc JOIN productos p ON p.id = lc.producto_id WHERE lc.compra_id = ?`, id);
  return c.json({ ...compra, lineas });
});

catalogo.delete("/compras/:id", soloAdmin, async (c) => {
  const id = idRuta(c);
  if (!(await c.env.DB.prepare("SELECT id FROM compras WHERE id = ?").bind(id).first())) throw fallo(404, "Compra no encontrada");
  // Si parte de lo comprado ya se ha vendido, el stock quedaría en negativo:
  // se avisa en vez de borrar
  const vendidos = await filas<{ nombre: string }>(c, `
    SELECT p.nombre FROM lineas_compra lc JOIN productos p ON p.id = lc.producto_id
     WHERE lc.compra_id = ? AND p.control_stock = 1 GROUP BY p.id HAVING SUM(lc.cantidad_milli) > p.stock_milli`, id);
  if (vendidos.length) {
    throw fallo(400, `No se puede borrar: ya se ha vendido o retirado parte de ${vendidos.map((v) => v.nombre).join(", ")}. Corrige con una merma o una nueva compra.`);
  }
  await escribir(c, [c.env.DB.prepare("DELETE FROM compras WHERE id = ?").bind(id)]);
  return c.json({ ok: true });
});

catalogo.get("/pedido-sugerido", soloAdmin, (c) => lista(c, `
  SELECT a.*, p.proveedor_id, ROUND(p.coste_medio_dm / 100.0) / 100.0 AS coste_medio,
         ROUND(a.cantidad_sugerida * p.coste_medio_dm / 100.0) / 100.0 AS coste_estimado
    FROM v_alertas_stock a JOIN productos p ON p.id = a.id
   ORDER BY a.proveedor IS NULL, a.proveedor, a.producto`));

// ---------------------------------------------------------------------
//  Productos
// ---------------------------------------------------------------------
catalogo.post("/productos", soloAdmin, async (c) => {
  const p = await cuerpo(c);
  const nombre = texto(p.nombre, "el nombre", 100, true)!;
  const unidad = p.unidad_medida ?? "unidad";
  if (unidad !== "unidad" && unidad !== "kg") throw fallo(400, "Revisa la unidad de medida");
  const proveedor = enteroONulo(p.proveedor_id, "el proveedor");
  const coste = dm(p.coste_compra ?? 0, "el coste");
  // Sin control de stock no hay cantidades ni lotes de los que llevar la cuenta
  const controlStock = booleano(p.control_stock ?? true, "el control de stock");
  const precioLibre = booleano(p.precio_libre ?? false, "el precio libre");
  const stockInicial = controlStock ? milli(p.stock_inicial ?? 0, "el stock inicial") : 0;
  const caducidad = fechaONula(p.fecha_caducidad, "la fecha de caducidad");
  // Sin precio se puede dar de alta (alta rápida escaneando), pero no vender

  const db = c.env.DB;
  // El IVA solo sirve para el ticket de venta: si no se indica, el de la categoría
  const categoria = entero(p.categoria_id, "la categoría");
  const iva = p.iva_id === undefined || p.iva_id === null || p.iva_id === 0 || p.iva_id === ""
    ? (await db.prepare(`SELECT COALESCE(c.iva_id, (SELECT id FROM tipos_iva WHERE porcentaje_cp = 1000), (SELECT MIN(id) FROM tipos_iva)) AS iva
                           FROM categorias c WHERE c.id = ?`).bind(categoria).first<number>("iva")) ?? null
    : entero(p.iva_id, "el IVA");
  if (!iva) throw fallo(400, "Revisa la categoría");
  // Si se indica el stock que ya hay, se registra como una compra de "stock
  // inicial" (así entran el coste y, si caduca, el lote), en la misma transacción.
  const codigo = texto(p.codigo_barras, "el código de barras", 20);
  // Con código de barras, la foto se busca a la vez (si no hay internet, se
  // queda pendiente y se busca más tarde)
  const foto = codigo && /^\d{8,14}$/.test(codigo) ? await fotoDe(codigo) : "";
  const r = await escribir(c, [
    db.prepare(
      `INSERT INTO productos (nombre, codigo_barras, categoria_id, proveedor_id, iva_id, unidad_medida, precio_venta_cent,
                              stock_minimo_milli, controla_caducidad, vida_util_dias, dias_aviso_caducidad, coste_medio_dm,
                              control_stock, precio_libre, acceso_rapido, imagen_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      nombre, codigo, categoria, proveedor,
      iva, unidad, cent(p.precio_venta ?? 0, "el precio de venta"), controlStock ? milli(p.stock_minimo ?? 0, "el stock mínimo") : 0,
      controlStock ? booleano(p.controla_caducidad ?? false, "la caducidad") : 0, controlStock ? enteroONulo(p.vida_util_dias, "la vida útil") || null : null,
      entero(p.dias_aviso_caducidad ?? 5, "los días de aviso", 255), coste,
      controlStock, precioLibre, booleano(p.acceso_rapido ?? false, "el acceso rápido"), foto,
    ),
    ...(stockInicial ? [
      pasoCompra(c, proveedor, null, `Stock inicial al dar de alta: ${nombre}`),
      pasoLineaCompra(c, "(SELECT MAX(id) FROM productos)", stockInicial, coste, caducidad),
    ] : []),
    db.prepare(`SELECT (SELECT MAX(id) FROM productos) AS id, ${stockInicial ? estaCompra : "NULL"} AS compra_id`),
  ]);
  return c.json(r.at(-1)!.results[0]);
});

const CAMPOS_PRODUCTO: Record<string, Campo> = {
  nombre: ["nombre", (v) => texto(v, "el nombre", 100, true)],
  codigo_barras: ["codigo_barras", (v) => texto(v, "el código de barras", 20)],
  categoria_id: ["categoria_id", (v) => entero(v, "la categoría")],
  proveedor_id: ["proveedor_id", (v) => enteroONulo(v, "el proveedor")],
  iva_id: ["iva_id", (v) => entero(v, "el IVA")],
  precio_venta: ["precio_venta_cent", (v) => cent(v, "el precio de venta")],
  stock_minimo: ["stock_minimo_milli", (v) => milli(v, "el stock mínimo")],
  controla_caducidad: ["controla_caducidad", (v) => booleano(v, "la caducidad")],
  vida_util_dias: ["vida_util_dias", (v) => enteroONulo(v, "la vida útil") || null],
  dias_aviso_caducidad: ["dias_aviso_caducidad", (v) => entero(v, "los días de aviso", 255)],
  coste_medio: ["coste_medio_dm", (v) => dm(v, "el coste")],
  activo: ["activo", (v) => booleano(v, "si está activo")],
  control_stock: ["control_stock", (v) => booleano(v, "el control de stock")],
  precio_libre: ["precio_libre", (v) => booleano(v, "el precio libre")],
  acceso_rapido: ["acceso_rapido", (v) => booleano(v, "el acceso rápido")],
  // Solo para quitar una foto que no es ("") o poner otra de Open Food Facts
  imagen_url: ["imagen_url", (v) => {
    if (v === null || v === "" || fotoValida(v)) return v;
    throw fallo(400, "Revisa la foto");
  }],
};

catalogo.patch("/productos/:id", soloAdmin, async (c) => {
  const id = idRuta(c);
  // Lo que no se envía no se toca; lo que se envía como null se borra (quitar
  // el proveedor o el código), salvo los campos obligatorios, que se ignoran.
  const datos = sinNulos(await cuerpo(c), ["nombre", "categoria_id", "iva_id", "precio_venta", "stock_minimo",
    "controla_caducidad", "dias_aviso_caducidad", "activo", "coste_medio", "control_stock", "precio_libre", "acceso_rapido"]);
  if (datos.control_stock === false || datos.control_stock === 0) datos.controla_caducidad = false;
  // Si cambia el código de barras, la foto se vuelve a buscar
  if ("codigo_barras" in datos && !("imagen_url" in datos)) {
    const antes = await c.env.DB.prepare("SELECT codigo_barras FROM productos WHERE id = ?").bind(id).first<string | null>("codigo_barras");
    if ((antes ?? null) !== (datos.codigo_barras || null)) datos.imagen_url = null;
  }
  const { sets, valores } = cambios(datos, CAMPOS_PRODUCTO);
  if (!sets) return c.json({ ok: true });
  const db = c.env.DB;
  if (!(await db.prepare("SELECT id FROM productos WHERE id = ?").bind(id).first())) throw fallo(404, "No encontrado");
  await escribir(c, [
    db.prepare(`UPDATE productos SET ${sets} WHERE id = ?`).bind(...valores, id),
    // El coste medio lo recalculan las compras; si se corrige a mano se apunta
    // (las ventas ya hechas guardan su coste y no cambian)
    ...("coste_medio" in datos ? [db.prepare(
      `INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
       SELECT ?, 'cambiar_coste', 'productos', id,
              nombre || ': coste ' || replace(printf('%.2f', coste_medio_dm / 10000.0), '.', ',') || ' €'
         FROM productos WHERE id = ?`,
    ).bind(c.get("u").usuario, id)] : []),
  ]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------
//  Código de barras: qué se sabe de él. Precio, coste, IVA, stock y caducidad
//  no salen nunca del código: los pone la tienda.
// ---------------------------------------------------------------------
async function buscarOpenFoodFacts(codigo: string) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${codigo}.json`
    + "?fields=product_name_es,product_name,generic_name_es,brands,quantity,categories";
  try {
    const r = await fetch(url, { headers: { "User-Agent": "TiendaASIR/1.0 (proyecto educativo)" }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const datos = await r.json<{ status?: number; product?: Record<string, string | undefined> }>();
    if (datos.status !== 1) return null;
    const p = datos.product ?? {};
    return {
      nombre: (p.product_name_es || p.product_name || p.generic_name_es || "").trim(),
      // "KELLOGG ESPAÑA S.L." -> "KELLOGG ESPAÑA"
      marca: (p.brands ?? "").split(",")[0]!.trim().replace(/[\s,]+S\.?\s?[AL]\.?(U\.?)?$/i, ""),
      cantidad: (p.quantity ?? "").trim(),
      categorias: (p.categories ?? "").trim(),
    };
  } catch {
    return null; // sin conexión, tiempo agotado...
  }
}

catalogo.get("/codigo/:codigo", soloAdmin, async (c) => {
  const codigo = c.req.param("codigo")!.trim();
  if (!/^\d{6,14}$/.test(codigo)) throw fallo(400, "El código debe tener entre 6 y 14 números");
  const [existe] = await filas(c, "SELECT id, nombre, activo FROM productos WHERE codigo_barras = ?", codigo);
  if (existe) return c.json({ codigo, en_catalogo: existe, externo: null });
  return c.json({ codigo, en_catalogo: null, externo: await buscarOpenFoodFacts(codigo) });
});
