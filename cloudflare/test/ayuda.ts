import { env, exports } from "cloudflare:workers";
import { hashPassword } from "../src/claves";

export const db = (env as unknown as { DB: D1Database }).DB;
export const CLAVE = "clave-de-prueba-1";

export const pedir = (ruta: string, init: RequestInit = {}, ip = "1.1.1.1") =>
  (exports as unknown as { default: { fetch: typeof fetch } }).default.fetch(`https://tienda.test/api${ruta}`, {
    ...init,
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...init.headers },
  });

export const entrar = (usuario: string, password: string, ip?: string) =>
  pedir("/auth/login", { method: "POST", body: JSON.stringify({ usuario, password }) }, ip);

export const tokenDe = async (usuario: string, password = CLAVE) =>
  ((await (await entrar(usuario, password, `9.9.9.${usuario.length}`)).json()) as { token: string }).token;

export const stock = async (id: number) =>
  (await db.prepare("SELECT stock_milli FROM productos WHERE id = ?").bind(id).first<number>("stock_milli"))!;
export const contar = async (tabla: string) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).first<number>("n"))!;

// Productos: 1 agua (20 u, 1,20 €), 2 patatas por kg (10 kg, 3,99 €),
// 3 yogur con tres lotes, 4 dado de baja, 5 con 5 unidades.
// Usuarios: jefe (administrador) y dep (dependiente).
export async function reiniciar() {
  const h = await hashPassword(CLAVE, 1000);
  await db.batch([
    // Con stock de sobra, para que los triggers de borrado no choquen con el CHECK
    db.prepare("UPDATE productos SET stock_milli = 1000000000"),
    ...["suscripciones_push", "ofertas", "ajustes_stock", "devoluciones_lotes", "lineas_devolucion", "devoluciones", "pagos_fiado", "notas", "conversaciones", "mermas_lotes", "mermas", "cierres_caja", "lotes_consumidos", "lineas_venta", "ventas",
      "lineas_compra", "compras", "lotes", "productos", "intentos_login", "clientes", "contexto_app", "usuarios_app", "auditoria"]
      .map((t) => db.prepare(`DELETE FROM ${t}`)),
    db.prepare(`INSERT INTO usuarios_app (id, usuario, nombre, password_hash, rol) VALUES
      (1, 'jefe', 'Jefe', ?1, 'admin'), (2, 'dep', 'Dependiente', ?1, 'dependiente')`).bind(h),
    db.prepare("DELETE FROM auditoria"),
    db.prepare(`INSERT INTO productos (id, codigo_barras, nombre, categoria_id, iva_id, unidad_medida, precio_venta_cent, coste_medio_dm, stock_milli, stock_minimo_milli, activo) VALUES
      (1, '111', 'Agua', 2, 2, 'unidad', 120, 5000, 20000, 5000, 1),
      (2, NULL, 'Patatas', 3, 1, 'kg', 399, 15000, 10000, 2000, 1),
      (3, NULL, 'Yogur', 1, 2, 'unidad', 250, 10000, 12000, 1000, 1),
      (4, NULL, 'Retirado', 1, 2, 'unidad', 100, 0, 50000, 0, 0),
      (5, NULL, 'Escaso', 1, 2, 'unidad', 100, 0, 5000, 10000, 1)`),
    db.prepare(`INSERT INTO lotes (id, producto_id, fecha_entrada, fecha_caducidad, inicial_milli, restante_milli) VALUES
      (10, 3, '2026-01-01', '2030-03-01', 4000, 4000),
      (11, 3, '2026-01-01', '2030-01-01', 3000, 3000),
      (12, 3, '2026-01-01', '2030-02-01', 5000, 5000)`),
  ]);
}
