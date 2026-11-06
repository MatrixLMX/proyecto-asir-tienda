/** Ofertas por cantidad: "si compra 3, la unidad le sale a 1,00 €". */
import { Hono } from "hono";
import { type Ctx, booleano, cent, cuerpo, entero, escribir, fallo, filas, idRuta, lista, milli, soloAdmin } from "./comun";

export const ofertas = new Hono<Ctx>();

// La lista la necesita la pantalla de vender, con cualquier perfil
ofertas.get("/ofertas", (c) => lista(c, "SELECT * FROM v_ofertas ORDER BY producto, cantidad_minima"));

const auditar = (c: Parameters<typeof escribir>[0], id: string, accion: string) => c.env.DB.prepare(
  `INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
   SELECT ?, ?, 'ofertas', o.id,
          p.nombre || ': desde ' || replace(rtrim(rtrim(printf('%.3f', o.cantidad_minima_milli / 1000.0), '0'), '.'), '.', ',')
          || ' a ' || replace(printf('%.2f', o.precio_cent / 100.0), '.', ',') || ' €'
     FROM ofertas o JOIN productos p ON p.id = o.producto_id WHERE o.id = ${id}`,
).bind(c.get("u").usuario, accion);

function comprobar(cantidad: number, precio: number, normal: number) {
  if (cantidad <= 1000) throw fallo(400, "La oferta tiene que ser para más de 1 unidad");
  if (precio >= normal) throw fallo(400, "El precio de oferta tiene que ser menor que el precio normal");
}

ofertas.post("/ofertas", soloAdmin, async (c) => {
  const d = await cuerpo(c);
  const producto = entero(d.producto_id, "el producto");
  const cantidad = milli(d.cantidad_minima, "la cantidad mínima");
  const precio = cent(d.precio, "el precio de oferta");
  const [p] = await filas<{ precio_venta_cent: number; precio_libre: number }>(
    c, "SELECT precio_venta_cent, precio_libre FROM productos WHERE id = ?", producto);
  if (!p) throw fallo(400, "Hace referencia a algo que no existe o está en uso.");
  if (p.precio_libre) throw fallo(400, "Un producto de precio libre no puede tener ofertas");
  comprobar(cantidad, precio, p.precio_venta_cent);
  const r = await escribir(c, [
    c.env.DB.prepare("INSERT INTO ofertas (producto_id, cantidad_minima_milli, precio_cent) VALUES (?, ?, ?)").bind(producto, cantidad, precio),
    auditar(c, "(SELECT MAX(id) FROM ofertas)", "crear_oferta"),
    c.env.DB.prepare("SELECT * FROM v_ofertas WHERE id = (SELECT MAX(id) FROM ofertas)"),
  ]);
  return c.json(r.at(-1)!.results[0]);
});

ofertas.patch("/ofertas/:id", soloAdmin, async (c) => {
  const id = idRuta(c);
  const d = await cuerpo(c);
  const [o] = await filas<{ cantidad_minima_milli: number; precio_cent: number; precio_venta_cent: number }>(c, `
    SELECT o.cantidad_minima_milli, o.precio_cent, p.precio_venta_cent
      FROM ofertas o JOIN productos p ON p.id = o.producto_id WHERE o.id = ?`, id);
  if (!o) throw fallo(404, "Oferta no encontrada");
  const cantidad = d.cantidad_minima === undefined ? o.cantidad_minima_milli : milli(d.cantidad_minima, "la cantidad mínima");
  const precio = d.precio === undefined ? o.precio_cent : cent(d.precio, "el precio de oferta");
  comprobar(cantidad, precio, o.precio_venta_cent);
  const activa = d.activa === undefined ? null : booleano(d.activa, "si está activa");
  await escribir(c, [
    c.env.DB.prepare("UPDATE ofertas SET cantidad_minima_milli = ?, precio_cent = ?, activa = COALESCE(?, activa) WHERE id = ?")
      .bind(cantidad, precio, activa, id),
    auditar(c, String(id), "cambiar_oferta"),
  ]);
  return c.json({ ok: true });
});

ofertas.delete("/ofertas/:id", soloAdmin, async (c) => {
  const id = idRuta(c);
  if (!(await c.env.DB.prepare("SELECT id FROM ofertas WHERE id = ?").bind(id).first())) throw fallo(404, "Oferta no encontrada");
  await escribir(c, [auditar(c, String(id), "borrar_oferta"), c.env.DB.prepare("DELETE FROM ofertas WHERE id = ?").bind(id)]);
  return c.json({ ok: true });
});
