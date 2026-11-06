import { beforeEach, describe, expect, it } from "vitest";
import { comprobarPassword, hashPassword } from "../src/claves";
import { CLAVE, contar, db, entrar, pedir, reiniciar, stock } from "./ayuda";

let token = "";
const conToken = (ruta: string, init: RequestInit = {}) =>
  pedir(ruta, { ...init, headers: { Authorization: `Bearer ${token}` } });
const vender = (datos: unknown) => conToken("/ventas", { method: "POST", body: JSON.stringify(datos) });

beforeEach(async () => {
  await reiniciar();
  const r = await entrar("jefe", CLAVE);
  token = ((await r.json()) as { token: string }).token;
});

describe("rutas públicas", () => {
  // Si pidieran sesión, la pantalla de login se recargaría sin parar
  it("responden sin sesión, con los campos que espera el frontend", async () => {
    expect((await pedir("/salud")).status).toBe(200);
    const r = await pedir("/tienda");
    expect(r.status).toBe(200);
    expect(Object.keys((await r.json()) as object).sort()).toEqual(["direccion", "nif", "nombre"]);
  });
});

describe("login", () => {
  it("devuelve token y usuario, como FastAPI", async () => {
    const r = await entrar("jefe", CLAVE, "2.2.2.2");
    expect(r.status).toBe(200);
    const j = (await r.json()) as { token: string; usuario: unknown };
    expect(j.usuario).toEqual({ usuario: "jefe", nombre: "Jefe", rol: "admin" });
    expect(j.token.split(".")).toHaveLength(3);
  });

  it("rechaza contraseña o usuario incorrectos", async () => {
    expect((await entrar("jefe", "mala", "3.3.3.3")).status).toBe(401);
    expect((await entrar("nadie", "mala", "3.3.3.3")).status).toBe(401);
  });

  it("bloquea por IP tras 5 fallos, y no afecta a otras IP", async () => {
    for (let i = 0; i < 5; i++) expect((await entrar("jefe", "mala", "4.4.4.4")).status).toBe(401);
    expect((await entrar("jefe", CLAVE, "4.4.4.4")).status).toBe(429);
    expect((await entrar("jefe", CLAVE, "5.5.5.5")).status).toBe(200);
  });

  it("exige sesión válida", async () => {
    expect((await pedir("/productos")).status).toBe(401);
    expect((await pedir("/productos", { headers: { Authorization: "Bearer falso" } })).status).toBe(401);
    expect((await conToken("/auth/yo")).status).toBe(200);
  });

  it("un hash manipulado no da acceso", async () => {
    expect(await comprobarPassword(CLAVE, await hashPassword(CLAVE, 1000))).toBe(true);
    expect(await comprobarPassword("otra", await hashPassword(CLAVE, 1000))).toBe(false);
    expect(await comprobarPassword(CLAVE, "basura")).toBe(false);
  });
});

describe("productos", () => {
  it("lista solo activos, en euros y kilos", async () => {
    const lista = (await (await conToken("/productos")).json()) as Record<string, unknown>[];
    expect(lista.map((p) => p.producto)).toEqual(["Agua", "Escaso", "Patatas", "Yogur"]);
    expect(lista[0]).toEqual({
      id: 1, codigo_barras: "111", producto: "Agua", categoria: "Bebidas", unidad_medida: "unidad",
      precio_venta: 1.2, stock_actual: 20, stock_minimo: 5, estado: "OK", control_stock: 1, precio_libre: 0, acceso_rapido: 0,
    });
  });

  it("busca por nombre y por código", async () => {
    const por = async (q: string) => ((await (await conToken(`/productos?q=${q}`)).json()) as unknown[]).length;
    expect(await por("agua")).toBe(1);
    expect(await por("111")).toBe(1);
    expect(await por("zzz")).toBe(0);
  });

  it("no enseña costes y avisa de stock bajo", async () => {
    expect(JSON.stringify(await (await conToken("/productos")).json())).not.toContain("coste");
    const alertas = (await (await conToken("/alertas/stock")).json()) as { producto: string; cantidad_sugerida: number }[];
    expect(alertas).toEqual([expect.objectContaining({ producto: "Escaso", cantidad_sugerida: 15 })]);
  });
});

describe("venta", () => {
  it("resta stock, copia precio, IVA y coste, y calcula el total", async () => {
    const r = await vender({ metodo_pago: "efectivo", lineas: [{ producto_id: 1, cantidad: 3 }] });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { id: number; total: number; fecha: string };
    expect(j.total).toBe(3.6);
    expect(new Date(j.fecha).getTime()).not.toBeNaN();
    expect(await stock(1)).toBe(17000);
    const l = await db.prepare("SELECT * FROM lineas_venta WHERE venta_id = ?").bind(j.id).first();
    expect(l).toMatchObject({ precio_unitario_cent: 120, iva_cp: 1000, coste_unitario_dm: 5000 });
    const v = await db.prepare("SELECT usuario, cerrada FROM ventas WHERE id = ?").bind(j.id).first();
    expect(v).toEqual({ usuario: "jefe", cerrada: 1 });
  });

  it("redondea al céntimo la venta a peso y no arrastra decimales", async () => {
    // 1,25 kg x 3,99 = 4,9875 -> 4,99 ; 0,1 kg -> 0,40 ; 0,2 kg -> 0,80
    const r = await vender({ lineas: [
      { producto_id: 2, cantidad: 1.25 }, { producto_id: 2, cantidad: 0.1 }, { producto_id: 2, cantidad: 0.2 },
    ] });
    expect(((await r.json()) as { total: number }).total).toBe(6.19);
    expect(await stock(2)).toBe(10000 - 1250 - 100 - 200);
  });

  it("gasta primero el lote que caduca antes y apunta de cuál salió", async () => {
    const r = await vender({ lineas: [{ producto_id: 3, cantidad: 5 }] });
    expect(r.status).toBe(200);
    const lotes = (await db.prepare("SELECT id, restante_milli FROM lotes ORDER BY id").all()).results;
    expect(lotes).toEqual([
      { id: 10, restante_milli: 4000 }, { id: 11, restante_milli: 0 }, { id: 12, restante_milli: 3000 },
    ]);
    const usados = (await db.prepare("SELECT lote_id, cantidad_milli FROM lotes_consumidos ORDER BY lote_id").all()).results;
    expect(usados).toEqual([{ lote_id: 11, cantidad_milli: 3000 }, { lote_id: 12, cantidad_milli: 2000 }]);
  });

  it("gasta bien varias líneas del mismo producto y lotes justos", async () => {
    const r = await vender({ lineas: [{ producto_id: 3, cantidad: 3 }, { producto_id: 3, cantidad: 9 }] });
    expect(r.status).toBe(200);
    expect(await stock(3)).toBe(0);
    expect(await db.prepare("SELECT SUM(restante_milli) AS s FROM lotes").first<number>("s")).toBe(0);
  });

  it("sin stock no guarda nada, ni las líneas que sí cabían", async () => {
    const r = await vender({ lineas: [{ producto_id: 1, cantidad: 2 }, { producto_id: 5, cantidad: 6 }] });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { detail: string }).detail).toBe('Stock insuficiente de "Escaso": quedan 5');
    expect(await stock(1)).toBe(20000);
    expect(await contar("ventas")).toBe(0);
    expect(await contar("lineas_venta")).toBe(0);
  });

  it("varias líneas que juntas superan el stock tampoco pasan", async () => {
    const r = await vender({ lineas: [{ producto_id: 5, cantidad: 3 }, { producto_id: 5, cantidad: 3 }] });
    expect(r.status).toBe(400);
    expect(await stock(5)).toBe(5000);
  });

  it("rechaza fracciones en productos por unidad, bajas y datos malos, sin guardar", async () => {
    const casos: [unknown, string][] = [
      [{ lineas: [{ producto_id: 1, cantidad: 1.5 }] }, "por unidades"],
      [{ lineas: [{ producto_id: 4, cantidad: 1 }] }, "dado de baja"],
      [{ lineas: [{ producto_id: 999, cantidad: 1 }] }, "no existe"],
      [{ lineas: [{ producto_id: 1, cantidad: -1 }] }, "cantidades"],
      [{ lineas: [{ producto_id: 1, cantidad: "x" }] }, "cantidades"],
      [{ lineas: [] }, "vacío"],
      [{ metodo_pago: "cheque", lineas: [{ producto_id: 1, cantidad: 1 }] }, "Forma de pago"],
    ];
    for (const [datos, texto] of casos) {
      const r = await vender(datos);
      expect(r.status, JSON.stringify(datos)).toBe(400);
      expect(((await r.json()) as { detail: string }).detail).toContain(texto);
    }
    expect(await contar("ventas")).toBe(0);
    expect(await stock(1)).toBe(20000);
  });

  it("pago mixto: guarda las partes", async () => {
    const r = await vender({ metodo_pago: "mixto", pago_tarjeta: 1, pago_bizum: 0.5, lineas: [{ producto_id: 1, cantidad: 2 }] });
    expect(r.status).toBe(200);
    const v = await db.prepare("SELECT pago_tarjeta_cent t, pago_bizum_cent b, total_cent x FROM ventas").first();
    expect(v).toEqual({ t: 100, b: 50, x: 240 });
  });

  it("pago mixto que no cuadra: no guarda nada", async () => {
    for (const pagos of [{ pago_tarjeta: 500 }, { pago_tarjeta: 0, pago_bizum: 0 }, { pago_tarjeta: 2.4 }]) {
      const r = await vender({ metodo_pago: "mixto", ...pagos, lineas: [{ producto_id: 1, cantidad: 2 }] });
      expect(r.status, JSON.stringify(pagos)).toBe(400);
    }
    expect(await stock(1)).toBe(20000);
    expect(await contar("ventas")).toBe(0);
  });

  it("los importes mixtos se ignoran en un pago normal", async () => {
    await vender({ metodo_pago: "tarjeta", pago_tarjeta: 500, lineas: [{ producto_id: 1, cantidad: 1 }] });
    expect(await db.prepare("SELECT pago_tarjeta_cent FROM ventas").first<number>("pago_tarjeta_cent")).toBe(0);
  });

  it("ventas simultáneas nunca dejan el stock en negativo", async () => {
    const rs = await Promise.all(Array.from({ length: 12 }, () => vender({ lineas: [{ producto_id: 5, cantidad: 1 }] })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(5);
    expect(rs.filter((r) => r.status === 400)).toHaveLength(7);
    expect(await stock(5)).toBe(0);
    expect(await contar("ventas")).toBe(5);
  });

  it("los triggers protegen aunque se salte la API", async () => {
    await db.prepare("INSERT INTO ventas (id) VALUES (500)").run();
    const directo = (producto: number, milli: number) => db.prepare(
      "INSERT INTO lineas_venta (venta_id, producto_id, cantidad_milli, precio_unitario_cent, iva_cp, coste_unitario_dm) VALUES (500, ?, ?, 1, 0, 0)",
    ).bind(producto, milli).run();
    await expect(directo(5, 6000)).rejects.toThrow(/STOCK_INSUFICIENTE/);
    await expect(directo(4, 1000)).rejects.toThrow(/PRODUCTO_BAJA/);
    await expect(directo(1, 1500)).rejects.toThrow(/SOLO_UNIDADES/);
  });

  it("más vendidos ordena por tickets", async () => {
    await vender({ lineas: [{ producto_id: 3, cantidad: 1 }] });
    await vender({ lineas: [{ producto_id: 3, cantidad: 1 }, { producto_id: 1, cantidad: 1 }] });
    expect(await (await conToken("/productos/mas-vendidos")).json()).toEqual([3, 1]);
  });
});
