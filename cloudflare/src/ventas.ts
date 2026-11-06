/** Ventas, caja y mermas: el trabajo diario, abierto a todos los perfiles. */
import { Hono } from "hono";
import {
  type Ctx, type Datos, cent, cuerpo, enteroONulo, enteroUrl, escribir, fallo, fechaONula, filas, hoy, idRuta, lista,
  milli, soloAdmin, texto,
} from "./comun";

export const ventas = new Hono<Ctx>();

const METODOS = ["efectivo", "tarjeta", "bizum", "mixto", "fiado"];

// "Pagado (en todo o en parte) con..." para filtrar el historial
const FILTRO_METODO: Record<string, string> = {
  efectivo: "(metodo_pago = 'efectivo' OR (metodo_pago = 'mixto' AND total_cent > pago_tarjeta_cent + pago_bizum_cent + pago_fiado_cent))",
  tarjeta: "(metodo_pago = 'tarjeta' OR pago_tarjeta_cent > 0)",
  bizum: "(metodo_pago = 'bizum' OR pago_bizum_cent > 0)",
  mixto: "metodo_pago = 'mixto'",
  fiado: "pago_fiado_cent > 0",
};

const numeroCrudo = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : NaN);

ventas.get("/resumen/hoy", async (c) => {
  // Ayer solo hasta la misma hora, para comparar de forma justa. Las devoluciones
  // restan el día en que se hacen.
  const [r] = await filas(c, `
    SELECT COALESCE(SUM(CASE WHEN v.fecha >= a.hoy THEN v.n END), 0) AS tickets,
           COALESCE(SUM(CASE WHEN v.fecha >= a.hoy THEN v.importe END), 0) / 100.0 AS facturado,
           COALESCE(SUM(CASE WHEN v.fecha < strftime('%Y-%m-%dT%H:%M:%S', a.ahora, '-1 day') THEN v.n END), 0) AS tickets_ayer,
           COALESCE(SUM(CASE WHEN v.fecha < strftime('%Y-%m-%dT%H:%M:%S', a.ahora, '-1 day') THEN v.importe END), 0) / 100.0 AS facturado_ayer
      FROM v_ahora a LEFT JOIN (
        SELECT fecha, 1 AS n, total_cent AS importe FROM ventas
        UNION ALL SELECT fecha, 0, -importe_cent FROM devoluciones
      ) v ON v.fecha >= date(a.hoy, '-1 day')`);
  return c.json(r);
});

ventas.post("/ventas", async (c) => {
  const v = await cuerpo(c);
  const metodo = String(v.metodo_pago ?? "efectivo");
  const entrada = v.lineas;
  if (!METODOS.includes(metodo)) throw fallo(400, "Forma de pago no válida");
  if (!Array.isArray(entrada) || !entrada.length) throw fallo(400, "El ticket está vacío");

  const lineas = entrada.map((l: Datos) => ({
    producto_id: numeroCrudo(l?.producto_id),
    milli: Math.round(numeroCrudo(l?.cantidad) * 1000),
    precio: Number.isFinite(l?.precio) ? Math.round((l.precio as number) * 100) : null,
  }));
  if (lineas.some((l) => !Number.isInteger(l.producto_id) || !(l.milli > 0) || l.milli > 1e9)) {
    throw fallo(400, "Revisa los productos y las cantidades del ticket");
  }
  const mixto = metodo === "mixto";
  const tarjeta = mixto ? Math.round(numeroCrudo(v.pago_tarjeta ?? 0) * 100) : 0;
  const bizum = mixto ? Math.round(numeroCrudo(v.pago_bizum ?? 0) * 100) : 0;
  const fiadoParte = mixto ? Math.round(numeroCrudo(v.pago_fiado ?? 0) * 100) : 0;
  if (!(tarjeta >= 0) || !(bizum >= 0) || !(fiadoParte >= 0)) throw fallo(400, "Importe de pago no válido");
  const hayFiado = metodo === "fiado" || fiadoParte > 0;
  const cliente = hayFiado ? numeroCrudo(v.cliente_id) : null;
  if (hayFiado && !Number.isInteger(cliente)) throw fallo(400, "Para fiar hay que elegir un cliente");

  const db = c.env.DB;

  // Comprobación previa solo para dar un mensaje con nombre y cantidad. La
  // garantía real son los triggers, dentro de la transacción.
  const pedido = new Map<number, number>();
  for (const l of lineas) pedido.set(l.producto_id, (pedido.get(l.producto_id) ?? 0) + l.milli);
  const ids = [...pedido.keys()];
  const productos = await filas<{ id: number; nombre: string; stock_milli: number; control_stock: number; precio_libre: number }>(
    c, `SELECT id, nombre, stock_milli, control_stock, precio_libre FROM productos WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
  if (productos.length !== ids.length) throw fallo(400, "Hay un producto que no existe en el ticket");
  for (const p of productos) {
    if (p.control_stock && p.stock_milli < pedido.get(p.id)!) {
      throw fallo(400, `Stock insuficiente de "${p.nombre}": quedan ${p.stock_milli / 1000}`);
    }
    if (p.precio_libre && lineas.some((l) => l.producto_id === p.id && !(l.precio! > 0 && l.precio! <= 1e7))) {
      throw fallo(400, `Escribe el importe de "${p.nombre}"`);
    }
  }
  if (hayFiado && !(await db.prepare("SELECT id FROM clientes WHERE id = ? AND activo").bind(cliente).first())) {
    throw fallo(400, "Ese cliente no existe o está desactivado");
  }

  // D1 ejecuta el batch como una transacción: si algo falla, no se guarda nada.
  // Dentro de ella nadie más escribe, así que MAX(id) es la venta recién creada.
  const estaVenta = "(SELECT MAX(id) FROM ventas)";
  const r = await escribir(c, [
    db.prepare("INSERT INTO ventas (metodo_pago, pago_tarjeta_cent, pago_bizum_cent, pago_fiado_cent, cliente_id, usuario) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(metodo, tarjeta, bizum, fiadoParte, cliente, c.get("u").usuario),
    // El precio lo decide el servidor: el escrito si el producto es de precio libre
    // y, si no, el de la mejor oferta a la que llega la cantidad total del ticket.
    ...lineas.map((l) => db.prepare(
      `INSERT INTO lineas_venta (venta_id, producto_id, cantidad_milli, precio_unitario_cent, iva_cp, coste_unitario_dm)
       SELECT ${estaVenta}, p.id, ?1,
              CASE WHEN p.precio_libre THEN ?2
                   ELSE MIN(p.precio_venta_cent, COALESCE((SELECT MIN(o.precio_cent) FROM ofertas o
                          WHERE o.producto_id = p.id AND o.activa AND o.cantidad_minima_milli <= ?3), p.precio_venta_cent)) END,
              i.porcentaje_cp, p.coste_medio_dm
         FROM productos p JOIN tipos_iva i ON i.id = p.iva_id WHERE p.id = ?4`,
    ).bind(l.milli, l.precio, pedido.get(l.producto_id)!, l.producto_id)),
    db.prepare(`UPDATE ventas SET cerrada = 1, pago_fiado_cent = CASE WHEN metodo_pago = 'fiado' THEN total_cent ELSE pago_fiado_cent END WHERE id = ${estaVenta}`),
    db.prepare(`SELECT id, fecha, total_cent FROM ventas WHERE id = ${estaVenta}`),
  ]);
  const fila = r.at(-1)!.results[0] as { id: number; fecha: string; total_cent: number };
  return c.json({ id: fila.id, fecha: fila.fecha, total: fila.total_cent / 100 });
});

ventas.get("/ventas", async (c) => {
  const dia = await hoy(c);
  const desde = fechaONula(c.req.query("desde"), "desde") ?? dia;
  const hasta = fechaONula(c.req.query("hasta"), "hasta") ?? dia;
  const metodo = c.req.query("metodo");
  if (metodo && !METODOS.includes(metodo)) throw fallo(400, "Forma de pago no válida");
  const pagina = enteroUrl(c, "pagina", 1, 1, 1_000_000);
  const porPagina = enteroUrl(c, "por_pagina", 50, 1, 200);

  const filtro = `fecha >= ? AND fecha < date(?, '+1 day')${metodo ? ` AND ${FILTRO_METODO[metodo]}` : ""}`;
  const [resumen, ventasPagina] = await Promise.all([
    filas(c, `SELECT COUNT(*) AS tickets, COALESCE(SUM(total_cent), 0) / 100.0 AS total FROM ventas WHERE ${filtro}`, desde, hasta),
    filas(c, `SELECT id, fecha, metodo_pago, pago_tarjeta_cent / 100.0 AS pago_tarjeta, pago_bizum_cent / 100.0 AS pago_bizum,
                     pago_fiado_cent / 100.0 AS pago_fiado, total_cent / 100.0 AS total, usuario,
                     (SELECT nombre FROM clientes k WHERE k.id = cliente_id) AS cliente,
                     COALESCE((SELECT SUM(d.importe_cent) FROM devoluciones d WHERE d.venta_id = ventas.id), 0) / 100.0 AS devuelto,
                     (SELECT COUNT(*) FROM lineas_venta l WHERE l.venta_id = ventas.id) AS lineas
                FROM ventas WHERE ${filtro} ORDER BY fecha DESC, id DESC LIMIT ? OFFSET ?`,
      desde, hasta, porPagina, (pagina - 1) * porPagina),
  ]);
  return c.json({ ...resumen[0], pagina, por_pagina: porPagina, ventas: ventasPagina });
});

ventas.get("/ventas/:id", async (c) => {
  const id = idRuta(c);
  const [venta] = await filas(c, "SELECT * FROM v_ventas WHERE id = ?", id);
  if (!venta) throw fallo(404, "Ticket no encontrado");
  const lineas = await filas(c, `SELECT linea_id, producto, unidad_medida, cantidad, precio_unitario, iva_porcentaje, importe, devuelto
                                   FROM v_lineas_ticket WHERE venta_id = ?`, id);
  return c.json({ ...venta, lineas });
});

// Los triggers devuelven el stock y los lotes, y lo apuntan en la auditoría
ventas.delete("/ventas/:id", soloAdmin, async (c) => {
  const id = idRuta(c);
  if (!(await c.env.DB.prepare("SELECT id FROM ventas WHERE id = ?").bind(id).first())) throw fallo(404, "Ticket no encontrado");
  await escribir(c, [c.env.DB.prepare("DELETE FROM ventas WHERE id = ?").bind(id)]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------
//  Devolver parte de un ticket. Se hace en el mostrador, así que vale para
//  todos los perfiles, y queda en la auditoría.
// ---------------------------------------------------------------------
ventas.post("/ventas/:id/devolucion", async (c) => {
  const id = idRuta(c);
  const d = await cuerpo(c);
  if (!Array.isArray(d.lineas) || !d.lineas.length) throw fallo(400, "Elige qué se devuelve");
  const [venta] = await filas<{ pago_fiado_cent: number }>(c, "SELECT pago_fiado_cent FROM ventas WHERE id = ?", id);
  if (!venta) throw fallo(404, "Ticket no encontrado");

  const metodo = String(d.metodo ?? "efectivo");
  if (!["efectivo", "tarjeta", "bizum", "fiado"].includes(metodo)) throw fallo(400, "Forma de devolución no válida");
  if (metodo === "fiado" && !venta.pago_fiado_cent) throw fallo(400, "Este ticket no se vendió a fiado");

  const lineas = d.lineas.map((l: Datos) => ({
    linea: numeroCrudo(l?.linea_id),
    milli: milli(l?.cantidad, "la cantidad"),
    repuesto: l?.repuesto === false ? 0 : 1,
  }));
  if (lineas.some((l) => !Number.isInteger(l.linea) || !(l.milli > 0))) throw fallo(400, "Revisa las cantidades");
  if (new Set(lineas.map((l) => l.linea)).size !== lineas.length) throw fallo(400, "Hay una línea repetida");
  const delTicket = await filas<{ id: number; unidad_medida: string }>(c, `
    SELECT lv.id, p.unidad_medida FROM lineas_venta lv JOIN productos p ON p.id = lv.producto_id WHERE lv.venta_id = ?`, id);
  for (const l of lineas) {
    const propia = delTicket.find((x) => x.id === l.linea);
    if (!propia) throw fallo(400, "Esa línea no es de este ticket");
    if (propia.unidad_medida === "unidad" && l.milli % 1000 !== 0) throw fallo(400, "Por unidades no se devuelven fracciones");
  }

  const db = c.env.DB;
  const u = c.get("u").usuario;
  const estaDevolucion = "(SELECT MAX(id) FROM devoluciones)";
  const r = await escribir(c, [
    db.prepare("INSERT INTO devoluciones (venta_id, metodo, usuario, notas) VALUES (?, ?, ?, ?)").bind(id, metodo, u, texto(d.notas, "las notas", 255)),
    // Sale de la diferencia entre lo devuelto antes y después, para que varias
    // devoluciones de la misma línea sumen justo el importe de la línea. Los números
    // llegan a SQLite como decimales: sin CAST, la división no sería entera.
    ...lineas.map((l) => db.prepare(
      `INSERT INTO lineas_devolucion (devolucion_id, linea_venta_id, cantidad_milli, importe_cent, repuesto)
       SELECT ${estaDevolucion}, lv.id, ?1,
              ((yd.milli + CAST(?1 AS INTEGER)) * lv.precio_unitario_cent + 500) / 1000 - (yd.milli * lv.precio_unitario_cent + 500) / 1000, ?2
         FROM lineas_venta lv,
              (SELECT COALESCE(SUM(cantidad_milli), 0) AS milli FROM lineas_devolucion WHERE linea_venta_id = ?3) yd
        WHERE lv.id = ?3`,
    ).bind(l.milli, l.repuesto, l.linea)),
    db.prepare(`INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
                SELECT ?, 'devolucion', 'devoluciones', id,
                       'Ticket nº ' || venta_id || ': ' || replace(printf('%.2f', importe_cent / 100.0), '.', ',') || ' € en ' || metodo
                  FROM devoluciones WHERE id = ${estaDevolucion}`).bind(u),
    db.prepare(`SELECT id, importe_cent / 100.0 AS importe, metodo FROM devoluciones WHERE id = ${estaDevolucion}`),
  ]);
  return c.json(r.at(-1)!.results[0]);
});

// ---------------------------------------------------------------------
//  Caja
// ---------------------------------------------------------------------
ventas.get("/caja", async (c) => {
  const dia = fechaONula(c.req.query("dia"), "el día") ?? await hoy(c);
  const [[caja], [cierre]] = await Promise.all([
    filas(c, "SELECT * FROM v_caja_diaria WHERE dia = ?", dia),
    filas(c, "SELECT * FROM v_cierres_caja WHERE fecha = ?", dia),
  ]);
  return c.json({
    ...(caja ?? { dia, tickets: 0, total_efectivo: 0, total_tarjeta: 0, total_bizum: 0, total_fiado: 0, total: 0, cobros_fiado: 0 }),
    cierre: cierre ?? null,
  });
});

ventas.post("/caja/cierre", async (c) => {
  const d = await cuerpo(c);
  const hoyEs = await hoy(c);
  const dia = fechaONula(d.fecha) ?? hoyEs;
  if (dia > hoyEs) throw fallo(400, "No se puede cerrar la caja de un día que aún no ha llegado");
  const fondo = cent(d.fondo_inicial ?? 0, "el fondo inicial");
  const contado = cent(d.efectivo_contado, "el efectivo contado");
  const notas = texto(d.notas, "las notas", 255);

  const db = c.env.DB;
  if (await db.prepare("SELECT id FROM cierres_caja WHERE fecha = ?").bind(dia).first()) {
    throw fallo(409, "La caja de ese día ya está cerrada");
  }
  // Los totales se leen dentro de la transacción, no antes: así una venta que
  // entre justo ahora no puede descuadrar el cierre.
  const r = await escribir(c, [
    db.prepare(
      `INSERT INTO cierres_caja (fecha, tickets, total_efectivo_cent, total_tarjeta_cent, total_bizum_cent,
                                 fondo_inicial_cent, efectivo_contado_cent, usuario, notas)
       SELECT d.fecha, COALESCE(x.tickets, 0), COALESCE(x.efectivo, 0), COALESCE(x.tarjeta, 0), COALESCE(x.bizum, 0), ?, ?, ?, ?
         FROM (SELECT ? AS fecha) d LEFT JOIN v_caja_cent x ON x.dia = d.fecha`,
    ).bind(fondo, contado, c.get("u").usuario, notas, dia),
    db.prepare("SELECT * FROM v_cierres_caja WHERE fecha = ?").bind(dia),
  ]);
  return c.json(r.at(-1)!.results[0]);
});

ventas.get("/caja/cierres", (c) => lista(c, "SELECT * FROM v_cierres_caja ORDER BY fecha DESC LIMIT 60"));

// ---------------------------------------------------------------------
//  Mermas: registrar, todos; consultar, el administrador
// ---------------------------------------------------------------------
const MOTIVOS = ["caducado", "roto", "robo", "consumo_propio", "otro"];

ventas.post("/mermas", async (c) => {
  const m = await cuerpo(c);
  const producto = numeroCrudo(m.producto_id);
  const cantidad = milli(m.cantidad, "la cantidad");
  if (!Number.isInteger(producto)) throw fallo(400, "Revisa el producto");
  if (!(cantidad > 0)) throw fallo(400, "Revisa la cantidad");
  if (!MOTIVOS.includes(String(m.motivo))) throw fallo(400, "Revisa el motivo");
  const lote = enteroONulo(m.lote_id, "el lote");
  const notas = texto(m.notas, "las notas", 255);

  const db = c.env.DB;
  if (!(await db.prepare("SELECT id FROM productos WHERE id = ?").bind(producto).first())) {
    throw fallo(400, "Hace referencia a algo que no existe o está en uso.");
  }
  await escribir(c, [db.prepare(
    `INSERT INTO mermas (producto_id, lote_id, cantidad_milli, motivo, coste_unitario_dm, usuario, notas)
     SELECT id, ?, ?, ?, coste_medio_dm, ?, ? FROM productos WHERE id = ?`,
  ).bind(lote, cantidad, m.motivo, c.get("u").usuario, notas, producto)]);
  return c.json({ ok: true });
});

ventas.get("/mermas", soloAdmin, (c) => lista(c, `
  SELECT m.id, m.fecha, p.nombre AS producto, p.unidad_medida, m.cantidad_milli / 1000.0 AS cantidad, m.motivo,
         m.usuario, m.notas, ROUND(m.cantidad_milli * m.coste_unitario_dm / 100000.0) / 100.0 AS perdida
    FROM mermas m JOIN productos p ON p.id = m.producto_id
   WHERE m.fecha >= (SELECT date(hoy, '-' || ? || ' days') FROM v_ahora) ORDER BY m.fecha DESC`,
  enteroUrl(c, "dias", 30, 0, 36500)));
