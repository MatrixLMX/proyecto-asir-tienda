/** Recuento de inventario e importación del catálogo desde Excel. */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { pasoCompra, pasoLineaCompra } from "./catalogo";
import { type C, type Ctx, type Datos, cent, cuerpo, dm, entero, escribir, fallo, fechaONula, filas, milli, normalizar, soloAdmin, texto } from "./comun";

export const inventario = new Hono<Ctx>();

// ---------------------------------------------------------------------
//  Recuento: se escribe lo que hay de verdad en la estantería.
// ---------------------------------------------------------------------
inventario.post("/inventario/recuento", soloAdmin, async (c) => {
  const d = await cuerpo(c);
  if (!Array.isArray(d.lineas) || !d.lineas.length) throw fallo(400, "No hay nada contado");
  const lineas = d.lineas.map((l: Datos) => ({
    id: entero(l?.producto_id, "el producto"),
    contado: milli(l?.contado, "lo contado"),
    caducidad: fechaONula(l?.fecha_caducidad, "la fecha de caducidad"),
  }));
  const ids = lineas.map((l) => l.id);
  if (new Set(ids).size !== ids.length) throw fallo(400, "Hay un producto repetido en el recuento");

  const productos = await filas<{ id: number; nombre: string; stock_milli: number; control_stock: number; controla_caducidad: number; vida_util_dias: number | null; unidad_medida: string }>(
    c, `SELECT id, nombre, stock_milli, control_stock, controla_caducidad, vida_util_dias, unidad_medida FROM productos WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
  if (productos.length !== ids.length) throw fallo(400, "Hace referencia a algo que no existe o está en uso.");

  const db = c.env.DB;
  const usuario = c.get("u").usuario;
  const resultado: { producto_id: number; producto: string; antes: number; contado: number }[] = [];
  const pasos: D1PreparedStatement[] = [];
  for (const l of lineas) {
    const p = productos.find((x) => x.id === l.id)!;
    if (!p.control_stock) throw fallo(400, `"${p.nombre}" no lleva control de stock`);
    if (p.unidad_medida === "unidad" && l.contado % 1000 !== 0) throw fallo(400, `"${p.nombre}" se cuenta por unidades, sin decimales`);
    if (l.contado > p.stock_milli && p.controla_caducidad && !l.caducidad && !p.vida_util_dias) {
      throw fallo(400, `"${p.nombre}" tiene más de lo apuntado y caduca: indica la fecha`);
    }
    resultado.push({ producto_id: p.id, producto: p.nombre, antes: p.stock_milli / 1000, contado: l.contado / 1000 });
    // Los dos pasos comparan con el stock en el momento de escribir: si entra
    // una venta mientras tanto, el resultado sigue siendo lo contado.
    pasos.push(
      db.prepare(`INSERT INTO mermas (producto_id, cantidad_milli, motivo, coste_unitario_dm, usuario, notas)
                  SELECT id, stock_milli - ?1, 'otro', coste_medio_dm, ?2, 'Diferencia de recuento'
                    FROM productos WHERE id = ?3 AND stock_milli > ?1`).bind(l.contado, usuario, l.id),
      db.prepare(`INSERT INTO ajustes_stock (producto_id, antes_milli, contado_milli, fecha_caducidad, usuario)
                  SELECT id, stock_milli, ?1,
                         CASE WHEN controla_caducidad THEN COALESCE(?2, date((SELECT hoy FROM v_ahora), '+' || vida_util_dias || ' days')) END, ?3
                    FROM productos WHERE id = ?4 AND stock_milli < ?1`).bind(l.contado, l.caducidad, usuario, l.id),
    );
  }
  await escribir(c, pasos);
  return c.json({ lineas: resultado });
});

// ---------------------------------------------------------------------
//  Importación. El navegador lee el Excel y manda las filas. Con "probar"
//  solo responde qué pasaría; lo que ya existe no se toca nunca.
// ---------------------------------------------------------------------
const MAX_FILAS = 200;

interface FilaValida {
  nombre: string; codigo: string | null; categoria: string; proveedor: string | null; iva_id: number; unidad: "unidad" | "kg";
  precio: number; coste: number; stock: number; minimo: number; caducidad: string | null; vida: number | null; controla: number;
  control: number;
}

function validarFila(f: Datos, ivas: { id: number; porcentaje: number }[]): FilaValida {
  const nombre = texto(f.nombre, "el nombre", 100, true)!;
  const unidad = String(f.unidad ?? "unidad").toLowerCase() || "unidad";
  if (unidad !== "unidad" && unidad !== "kg") throw fallo(400, "la unidad tiene que ser unidad o kg");
  if (typeof f.iva !== "number") throw fallo(400, "falta el IVA");
  const iva = ivas.find((i) => i.porcentaje === f.iva);
  if (!iva) throw fallo(400, `no existe el IVA del ${f.iva} %`);
  // Sin precio también entra: queda "sin precio" en Catálogo y no se vende hasta tenerlo
  const caducidad = fechaONula(f.caducidad, "la fecha de caducidad");
  const vida = f.vida_util_dias === undefined || f.vida_util_dias === null ? null : entero(f.vida_util_dias, "la vida útil", 36500) || null;
  const stock = milli(f.stock ?? 0, "el stock");
  const control = f.sin_control_stock === true ? 0 : 1;
  const controla = control && (caducidad || vida) ? 1 : 0;
  if (unidad === "unidad" && stock % 1000 !== 0) throw fallo(400, "el stock va sin decimales en productos por unidad");
  return {
    nombre, codigo: texto(f.codigo_barras, "el código de barras", 20), categoria: texto(f.categoria, "la categoría", 50, true)!,
    proveedor: texto(f.proveedor, "el proveedor", 80), iva_id: iva.id, unidad, precio: cent(f.precio ?? 0, "el precio"),
    coste: dm(f.coste ?? 0, "el coste"), stock: control ? stock : 0, minimo: milli(f.stock_minimo ?? 0, "el stock mínimo"),
    caducidad, vida, controla, control,
  };
}

inventario.post("/productos/importar", soloAdmin, async (c: C) => {
  const d = await cuerpo(c);
  if (!Array.isArray(d.filas) || !d.filas.length) throw fallo(400, "El fichero no tiene productos");
  if (d.filas.length > MAX_FILAS) throw fallo(400, `Máximo ${MAX_FILAS} filas de una vez`);

  const [ivas, actuales] = await Promise.all([
    filas<{ id: number; porcentaje: number }>(c, "SELECT id, porcentaje_cp / 100.0 AS porcentaje FROM tipos_iva"),
    filas<{ nombre: string; codigo_barras: string | null }>(c, "SELECT nombre, codigo_barras FROM productos"),
  ]);
  const nombres = new Set(actuales.map((p) => normalizar(p.nombre)));
  const codigos = new Set(actuales.map((p) => p.codigo_barras).filter(Boolean));

  const validas: FilaValida[] = [];
  const informe: { fila: number; nombre: string; estado: "nuevo" | "existe" | "error"; detalle?: string }[] = [];
  for (const [i, f] of (d.filas as Datos[]).entries()) {
    const fila = i + 1;
    try {
      const v = validarFila(f, ivas);
      if (nombres.has(normalizar(v.nombre)) || (v.codigo && codigos.has(v.codigo))) {
        informe.push({ fila, nombre: v.nombre, estado: "existe" });
        continue;
      }
      if (v.controla && v.stock && !v.caducidad && !v.vida) throw fallo(400, "tiene stock y caduca: indica la fecha");
      nombres.add(normalizar(v.nombre));
      if (v.codigo) codigos.add(v.codigo);
      validas.push(v);
      informe.push({ fila, nombre: v.nombre, estado: "nuevo" });
    } catch (e) {
      if (!(e instanceof HTTPException)) throw e;
      const { detail } = await e.getResponse().json<{ detail: string }>();
      informe.push({ fila, nombre: String(f?.nombre ?? ""), estado: "error", detalle: detail });
    }
  }
  const nuevos = informe.filter((f) => f.estado === "nuevo").length;
  const errores = informe.filter((f) => f.estado === "error").length;

  // Con errores no se importa nada: así se corrige el fichero y se repite entero
  if (d.probar === true || errores) return c.json({ nuevos, errores, existentes: informe.length - nuevos - errores, importado: false, filas: informe });

  const db = c.env.DB;
  const pasos: D1PreparedStatement[] = [];
  for (const nombre of new Set(validas.map((v) => v.categoria))) pasos.push(db.prepare("INSERT OR IGNORE INTO categorias (nombre) VALUES (?)").bind(nombre));
  for (const nombre of new Set(validas.map((v) => v.proveedor).filter((p): p is string => !!p))) pasos.push(db.prepare("INSERT OR IGNORE INTO proveedores (nombre) VALUES (?)").bind(nombre));
  if (validas.some((v) => v.stock)) pasos.push(pasoCompra(c, null, null, "Importación del catálogo"));
  for (const v of validas) {
    pasos.push(db.prepare(
      `INSERT INTO productos (nombre, codigo_barras, categoria_id, proveedor_id, iva_id, unidad_medida, precio_venta_cent, coste_medio_dm,
                              stock_minimo_milli, controla_caducidad, vida_util_dias, control_stock)
       VALUES (?, ?, (SELECT id FROM categorias WHERE nombre = ?), (SELECT id FROM proveedores WHERE nombre = ?), ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(v.nombre, v.codigo, v.categoria, v.proveedor, v.iva_id, v.unidad, v.precio, v.coste, v.minimo, v.controla, v.vida, v.control));
    if (v.stock) pasos.push(pasoLineaCompra(c, "(SELECT MAX(id) FROM productos)", v.stock, v.coste, v.caducidad));
  }
  if (validas.length) {
    await escribir(c, [...pasos, db.prepare(
      `INSERT INTO auditoria (usuario, accion, tabla, detalle) VALUES (?, 'importar_catalogo', 'productos', ?)`,
    ).bind(c.get("u").usuario, `${validas.length} productos nuevos`)]);
  }
  return c.json({ nuevos, errores, existentes: informe.length - nuevos - errores, importado: validas.length > 0, filas: informe });
});
