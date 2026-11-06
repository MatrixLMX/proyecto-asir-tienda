/** Notas compartidas de la pantalla Inicio. La fecha y el autor los pone el
 *  servidor, para que nadie pueda firmar en nombre de otro. */
import { Hono } from "hono";
import { type Ctx, booleano, cuerpo, fallo, filas, idRuta, lista, texto } from "./comun";

export const notas = new Hono<Ctx>();

const LEER = `SELECT n.id, n.texto, n.fecha, n.usuario, n.fijada, n.hecha, COALESCE(u.nombre, n.usuario) AS autor
                FROM notas n LEFT JOIN usuarios_app u ON u.usuario = n.usuario`;

notas.get("/notas", (c) => lista(c, `${LEER} ORDER BY n.hecha, n.fijada DESC, n.fecha DESC, n.id DESC LIMIT 50`));

notas.post("/notas", async (c) => {
  const contenido = texto((await cuerpo(c)).texto, "el texto de la nota", 1000, true);
  const r = await c.env.DB.prepare("INSERT INTO notas (texto, usuario) VALUES (?, ?)").bind(contenido, c.get("u").usuario).run();
  const [nota] = await filas(c, `${LEER} WHERE n.id = ?`, r.meta.last_row_id);
  return c.json(nota);
});

// Fijarla arriba o marcarla como hecha: cualquiera que esté en la tienda
notas.patch("/notas/:id", async (c) => {
  const id = idRuta(c);
  const d = await cuerpo(c);
  const fijada = d.fijada === undefined ? null : booleano(d.fijada, "si está fijada");
  const hecha = d.hecha === undefined ? null : booleano(d.hecha, "si está hecha");
  if (!(await c.env.DB.prepare("SELECT id FROM notas WHERE id = ?").bind(id).first())) throw fallo(404, "Nota no encontrada");
  await c.env.DB.prepare("UPDATE notas SET fijada = COALESCE(?, fijada), hecha = COALESCE(?, hecha) WHERE id = ?").bind(fijada, hecha, id).run();
  return c.json({ ok: true });
});

// Cada cual borra las suyas; el administrador, cualquiera
notas.delete("/notas/:id", async (c) => {
  const id = idRuta(c);
  const u = c.get("u");
  const nota = await c.env.DB.prepare("SELECT usuario FROM notas WHERE id = ?").bind(id).first<{ usuario: string }>();
  if (!nota) throw fallo(404, "Nota no encontrada");
  if (u.rol !== "admin" && nota.usuario !== u.usuario) throw fallo(403, "Solo puedes borrar tus propias notas");
  await c.env.DB.prepare("DELETE FROM notas WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});
