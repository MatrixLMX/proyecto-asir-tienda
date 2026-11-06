/** Clientes con fiado: lo que deben, lo que han comprado y lo que han pagado.
 *  La deuda no se guarda: siempre se calcula de los movimientos (v_clientes). */
import { Hono } from "hono";
import { type Ctx, actualizar, booleano, cent, cuerpo, escribir, fallo, filas, idRuta, ordenar, soloAdmin, texto } from "./comun";

export const fiado = new Hono<Ctx>();

fiado.get("/clientes", async (c) => {
  const todos = c.req.query("todos") === "true";
  const clientes = await filas<{ nombre: string }>(c, `SELECT * FROM v_clientes ${todos ? "" : "WHERE activo"}`);
  return c.json(ordenar(clientes, "nombre"));
});

fiado.post("/clientes", async (c) => {
  const d = await cuerpo(c);
  const nombre = texto(d.nombre, "el nombre", 80, true);
  const [r] = await escribir(c, [c.env.DB.prepare("INSERT INTO clientes (nombre, telefono, notas) VALUES (?, ?, ?)")
    .bind(nombre, texto(d.telefono, "el teléfono", 20), texto(d.notas, "las notas", 255))]);
  return c.json({ id: r!.meta.last_row_id, nombre, telefono: texto(d.telefono, "el teléfono", 20), deuda: 0, activo: 1 });
});

fiado.patch("/clientes/:id", soloAdmin, async (c) => {
  const id = idRuta(c);
  const d = Object.fromEntries(Object.entries(await cuerpo(c)).filter(([k, v]) => v !== null || (k !== "nombre" && k !== "activo")));
  if (d.activo === false || d.activo === 0) {
    const [cl] = await filas<{ deuda: number }>(c, "SELECT deuda FROM v_clientes WHERE id = ?", id);
    if (cl && cl.deuda !== 0) throw fallo(400, "No se puede desactivar a un cliente con la cuenta pendiente");
  }
  return actualizar(c, "clientes", id, d, {
    nombre: ["nombre", (v) => texto(v, "el nombre", 80, true)],
    telefono: ["telefono", (v) => texto(v, "el teléfono", 20)],
    notas: ["notas", (v) => texto(v, "las notas", 255)],
    activo: ["activo", (v) => booleano(v, "si está activo")],
  });
});

fiado.get("/clientes/:id", async (c) => {
  const id = idRuta(c);
  const [cliente] = await filas(c, "SELECT * FROM v_clientes WHERE id = ?", id);
  if (!cliente) throw fallo(404, "Cliente no encontrado");
  const movimientos = await filas(c, `
    SELECT 'venta' AS tipo, id, fecha, pago_fiado_cent / 100.0 AS importe, id AS venta_id, usuario, NULL AS metodo, NULL AS notas
      FROM ventas WHERE cliente_id = ?1 AND pago_fiado_cent > 0
    UNION ALL
    SELECT 'devolucion', d.id, d.fecha, -d.importe_cent / 100.0, d.venta_id, d.usuario, d.metodo, d.notas
      FROM devoluciones d JOIN ventas v ON v.id = d.venta_id WHERE v.cliente_id = ?1 AND d.metodo = 'fiado'
    UNION ALL
    SELECT 'pago', id, fecha, -importe_cent / 100.0, NULL, usuario, metodo, notas
      FROM pagos_fiado WHERE cliente_id = ?1
    ORDER BY fecha DESC, id DESC LIMIT 200`, id);
  return c.json({ ...cliente, movimientos });
});

const METODOS = ["efectivo", "tarjeta", "bizum"];

fiado.post("/clientes/:id/pagos", async (c) => {
  const id = idRuta(c);
  const d = await cuerpo(c);
  const importe = cent(d.importe, "el importe");
  if (!(importe > 0)) throw fallo(400, "Revisa el importe");
  const metodo = String(d.metodo ?? "efectivo");
  if (!METODOS.includes(metodo)) throw fallo(400, "Forma de pago no válida");

  const [cl] = await filas<{ deuda: number; nombre: string }>(c, "SELECT deuda, nombre FROM v_clientes WHERE id = ?", id);
  if (!cl) throw fallo(404, "Cliente no encontrado");
  if (importe > Math.round(cl.deuda * 100)) throw fallo(400, `Es más de lo que debe ${cl.nombre}`);

  const db = c.env.DB;
  const usuario = c.get("u").usuario;
  await escribir(c, [
    db.prepare("INSERT INTO pagos_fiado (cliente_id, importe_cent, metodo, usuario, notas) VALUES (?, ?, ?, ?, ?)")
      .bind(id, importe, metodo, usuario, texto(d.notas, "las notas", 255)),
    db.prepare(`INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
                SELECT ?, 'cobro_fiado', 'pagos_fiado', (SELECT MAX(id) FROM pagos_fiado),
                       ? || ': ' || replace(printf('%.2f', ? / 100.0), '.', ',') || ' € en ' || ?`)
      .bind(usuario, cl.nombre, importe, metodo),
  ]);
  return c.json({ ok: true });
});

// Para corregir un cobro apuntado por error
fiado.delete("/pagos-fiado/:id", soloAdmin, async (c) => {
  const id = idRuta(c);
  const db = c.env.DB;
  if (!(await db.prepare("SELECT id FROM pagos_fiado WHERE id = ?").bind(id).first())) throw fallo(404, "Cobro no encontrado");
  await escribir(c, [
    db.prepare(`INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
                SELECT ?, 'borrar_cobro_fiado', 'pagos_fiado', p.id,
                       c.nombre || ': ' || replace(printf('%.2f', p.importe_cent / 100.0), '.', ',') || ' € en ' || p.metodo
                  FROM pagos_fiado p JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?`).bind(c.get("u").usuario, id),
    db.prepare("DELETE FROM pagos_fiado WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});
