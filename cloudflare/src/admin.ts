/** Informes, usuarios de la web y auditoría: solo el administrador. */
import { Hono } from "hono";
import { hashPassword } from "./claves";
import {
  type Ctx, actualizar, booleano, cuerpo, enteroUrl, escribir, fallo, filas, idRuta, lista, ordenar, soloAdmin, texto,
} from "./comun";

export const admin = new Hono<Ctx>();
admin.use("/informes/*", soloAdmin);
admin.use("/usuarios/*", soloAdmin);
admin.use("/usuarios", soloAdmin);
admin.use("/auditoria", soloAdmin);

admin.get("/informes/mensual", (c) => lista(c, "SELECT * FROM v_beneficio_mensual ORDER BY mes"));
admin.get("/informes/categorias", (c) => lista(c, "SELECT * FROM v_beneficio_categoria ORDER BY beneficio DESC"));
admin.get("/informes/productos", (c) => lista(c, "SELECT * FROM v_beneficio_producto ORDER BY beneficio DESC"));
admin.get("/informes/diario", (c) => lista(
  c, "SELECT * FROM v_ventas_diarias WHERE dia >= (SELECT date(hoy, '-' || ? || ' days') FROM v_ahora) ORDER BY dia",
  enteroUrl(c, "dias", 30, 0, 36500)));
admin.get("/informes/parados", (c) => lista(
  c, "SELECT * FROM v_productos_parados WHERE dias_sin_vender >= ? ORDER BY dias_sin_vender DESC",
  enteroUrl(c, "dias", 30, 0, 36500)));

admin.get("/auditoria", (c) => lista(
  c, "SELECT id, fecha, usuario, accion, tabla, registro_id, detalle FROM auditoria ORDER BY fecha DESC, id DESC LIMIT ?",
  enteroUrl(c, "limite", 200, 1, 1000)));

// ---------------------------------------------------------------------
//  Usuarios
// ---------------------------------------------------------------------
type FilaUsuario = { id: number; usuario: string; nombre: string; rol: string; activo: number; creado_en: string };

admin.get("/usuarios", async (c) => {
  const u = await filas<FilaUsuario>(c, "SELECT id, usuario, nombre, rol, activo, creado_en FROM usuarios_app");
  return c.json(ordenar(u, "nombre").sort((a, b) => b.activo - a.activo));
});

const rol = (v: unknown) => {
  if (v !== "admin" && v !== "dependiente") throw fallo(400, "Revisa el perfil");
  return v;
};

export const claveValida = (v: unknown) => {
  if (typeof v !== "string" || v.length < 8 || v.length > 72) throw fallo(400, "La contraseña debe tener entre 8 y 72 caracteres");
  return v;
};

admin.post("/usuarios", async (c) => {
  const n = await cuerpo(c);
  const usuario = n.usuario;
  if (typeof usuario !== "string" || !/^[a-zA-Z0-9._-]{3,40}$/.test(usuario)) {
    throw fallo(400, "El usuario debe tener de 3 a 40 letras, números, puntos o guiones");
  }
  const nombre = texto(n.nombre, "el nombre", 80, true);
  const perfil = rol(n.rol);
  const clave = claveValida(n.password);
  const db = c.env.DB;
  if (await db.prepare("SELECT id FROM usuarios_app WHERE usuario = ?").bind(usuario).first()) {
    throw fallo(409, `Ya existe el usuario '${usuario}'`);
  }
  const [r] = await escribir(c, [db.prepare(
    "INSERT INTO usuarios_app (usuario, nombre, password_hash, rol) VALUES (?, ?, ?, ?)",
  ).bind(usuario, nombre, await hashPassword(clave), perfil)]);
  return c.json({ id: r!.meta.last_row_id });
});

admin.patch("/usuarios/:id", async (c) => {
  const id = idRuta(c);
  const datos = Object.fromEntries(Object.entries(await cuerpo(c)).filter(([, v]) => v !== null));
  const [objetivo] = await filas<{ usuario: string }>(c, "SELECT usuario FROM usuarios_app WHERE id = ?", id);
  if (!objetivo) throw fallo(404, "Usuario no encontrado");
  // Para no quedarse sin administrador por error
  if (objetivo.usuario === c.get("u").usuario && (datos.activo === false || datos.activo === 0 || datos.rol === "dependiente")) {
    throw fallo(400, "No puedes desactivarte ni quitarte el perfil de administrador a ti mismo");
  }
  if ("password" in datos) datos.password = await hashPassword(claveValida(datos.password));
  return actualizar(c, "usuarios_app", id, datos, {
    nombre: ["nombre", (v) => texto(v, "el nombre", 80, true)],
    rol: ["rol", rol],
    activo: ["activo", (v) => booleano(v, "si está activo")],
    password: ["password_hash", (v) => v],
  });
});
