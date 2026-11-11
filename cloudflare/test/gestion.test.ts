import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAVE, contar, db, entrar, pedir, reiniciar, stock, tokenDe } from "./ayuda";

let jefe = "";
let dep = "";

const como = (token: string) => (ruta: string, metodo = "GET", datos?: unknown) =>
  pedir(ruta, { method: metodo, headers: { Authorization: `Bearer ${token}` }, ...(datos === undefined ? {} : { body: JSON.stringify(datos) }) });
const admin = (r: string, m?: string, d?: unknown) => como(jefe)(r, m, d);
const dependiente = (r: string, m?: string, d?: unknown) => como(dep)(r, m, d);
const json = async <T = Record<string, any>>(r: Response | Promise<Response>) => (await (await r).json()) as T;

const lotes = async () => Object.fromEntries((await db.prepare("SELECT id, restante_milli FROM lotes").all<{ id: number; restante_milli: number }>()).results.map((l) => [l.id, l.restante_milli]));
const ultimaAuditoria = () => db.prepare("SELECT * FROM auditoria ORDER BY id DESC LIMIT 1").first<Record<string, any>>();
const vender = (d: unknown, quien = dependiente) => json(quien("/ventas", "POST", d));

beforeEach(async () => {
  await reiniciar();
  jefe = await tokenDe("jefe");
  dep = await tokenDe("dep");
});
afterEach(() => { vi.restoreAllMocks(); });

describe("hora de España", () => {
  // Se comprueba la regla del horario de verano de la vista contra la base de
  // datos de zonas horarias, en las fechas difíciles: los cambios de hora.
  it("v_ahora coincide con Europe/Madrid todo el año", async () => {
    const definicion = (await db.prepare("SELECT sql FROM sqlite_master WHERE name = 'v_ahora'").first<string>("sql"))!;
    const consulta = definicion.slice(definicion.indexOf("SELECT"));
    const formato = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "medium" });
    const momentos = [
      "2026-03-29T00:59:59Z", "2026-03-29T01:00:00Z", "2026-10-25T00:59:59Z", "2026-10-25T01:00:00Z",
      "2027-03-28T00:59:59Z", "2027-03-28T01:00:00Z", "2027-10-31T00:59:59Z", "2027-10-31T01:00:00Z",
      "2029-04-01T00:30:00Z", "2030-03-31T01:00:00Z", "2030-03-31T00:59:00Z", "2026-12-31T23:30:00Z", "2026-07-15T22:30:00Z",
    ];
    for (const m of momentos) {
      const utc = m.slice(0, 19).replace("T", " ");
      const fila = await db.prepare(consulta.replace("datetime('now')", `'${utc}'`)).first<{ ahora: string; hoy: string }>();
      const esperado = formato.format(new Date(m)).replace(" ", "T");
      expect(fila!.ahora, m).toBe(esperado);
      expect(fila!.hoy, m).toBe(esperado.slice(0, 10));
    }
  });

  it("la venta se guarda en hora española y con el formato que espera la web", async () => {
    const v = await vender({ lineas: [{ producto_id: 1, cantidad: 1 }] });
    const ahora = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", dateStyle: "short" }).format(new Date());
    expect(v.fecha).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(v.fecha.slice(0, 10)).toBe(ahora);
  });
});

describe("permisos", () => {
  it("el dependiente no entra en lo del administrador", async () => {
    const rutas: [string, string?][] = [
      ["/informes/mensual"], ["/informes/categorias"], ["/informes/productos"], ["/informes/diario"], ["/informes/parados"],
      ["/compras"], ["/compras/1"], ["/mermas"], ["/usuarios"], ["/auditoria"], ["/productos/admin"], ["/proveedores"],
      ["/categorias/todas"], ["/tipos-iva"], ["/pedido-sugerido"], ["/codigo/8410000000000"],
      ["/ventas/1", "DELETE"], ["/compras/1", "DELETE"], ["/compras", "POST"], ["/productos", "POST"], ["/productos/1", "PATCH"],
      ["/categorias", "POST"], ["/categorias/1", "PATCH"], ["/proveedores", "POST"], ["/proveedores/1", "PATCH"],
      ["/usuarios", "POST"], ["/usuarios/1", "PATCH"],
    ];
    for (const [ruta, metodo] of rutas) {
      expect((await dependiente(ruta, metodo, metodo && metodo !== "DELETE" ? {} : undefined)).status, `${metodo ?? "GET"} ${ruta}`).toBe(403);
    }
  });

  it("ninguna respuesta del dependiente lleva costes ni beneficios", async () => {
    const venta = await vender({ lineas: [{ producto_id: 3, cantidad: 2 }] });
    await dependiente("/mermas", "POST", { producto_id: 1, cantidad: 1, motivo: "roto" });
    for (const ruta of ["/productos", "/categorias", "/alertas/stock", "/alertas/caducidades", "/resumen/hoy", "/ventas", `/ventas/${venta.id}`, "/caja", "/caja/cierres", "/auth/yo"]) {
      const r = await dependiente(ruta);
      expect(r.status, ruta).toBe(200);
      expect(await r.text(), ruta).not.toMatch(/coste|beneficio|margen|perdida/i);
    }
  });

  it("desactivar a alguien corta su sesión al momento, y quitarle el perfil también", async () => {
    await admin("/usuarios/2", "PATCH", { activo: false });
    expect((await dependiente("/productos")).status).toBe(401);
    await admin("/usuarios/2", "PATCH", { activo: true, rol: "admin" });
    expect((await dependiente("/usuarios")).status).toBe(200);
    await admin("/usuarios/2", "PATCH", { rol: "dependiente" });
    expect((await dependiente("/usuarios")).status).toBe(403);
  });
});

describe("anular ventas", () => {
  it("devuelve el stock y cada parte a su lote, y queda en la auditoría", async () => {
    const antes = await lotes();
    const v = await vender({ metodo_pago: "tarjeta", lineas: [{ producto_id: 3, cantidad: 5 }, { producto_id: 1, cantidad: 2 }] });
    expect(await stock(3)).toBe(7000);
    expect(await lotes()).not.toEqual(antes);

    const detalle = await json(dependiente(`/ventas/${v.id}`));
    expect(detalle.total).toBe(14.9);
    expect(detalle.lineas[0]).toMatchObject({ producto: "Yogur", unidad_medida: "unidad", cantidad: 5, precio_unitario: 2.5, iva_porcentaje: 10, importe: 12.5, devuelto: 0 });

    expect((await admin(`/ventas/${v.id}`, "DELETE")).status).toBe(200);
    expect(await stock(3)).toBe(12000);
    expect(await stock(1)).toBe(20000);
    expect(await lotes()).toEqual(antes);
    expect(await contar("lineas_venta")).toBe(0);
    expect(await contar("lotes_consumidos")).toBe(0);
    expect(await ultimaAuditoria()).toMatchObject({ accion: "anular_venta", usuario: "jefe", registro_id: v.id });
    expect((await ultimaAuditoria())!.detalle).toContain("14,90 € en tarjeta, vendido por dep");
    expect(await contar("contexto_app")).toBe(0);
  });

  it("un ticket que no existe da 404", async () => {
    expect((await admin("/ventas/99999", "DELETE")).status).toBe(404);
    expect((await admin("/ventas/99999")).status).toBe(404);
    expect((await admin("/ventas/abc")).status).toBe(404);
  });
});

describe("historial y resumen", () => {
  it("filtra por día y por forma de pago, también en pagos mixtos", async () => {
    await vender({ metodo_pago: "efectivo", lineas: [{ producto_id: 1, cantidad: 1 }] });
    await vender({ metodo_pago: "bizum", lineas: [{ producto_id: 1, cantidad: 1 }] });
    await vender({ metodo_pago: "mixto", pago_tarjeta: 1, lineas: [{ producto_id: 1, cantidad: 2 }] });

    const todas = await json(dependiente("/ventas"));
    expect(todas).toMatchObject({ tickets: 3, total: 4.8, pagina: 1, por_pagina: 50 });
    expect(todas.ventas[0]).toMatchObject({ metodo_pago: "mixto", pago_tarjeta: 1, pago_bizum: 0, total: 2.4, usuario: "dep", lineas: 1 });
    const cuantos = async (m: string) => (await json(dependiente(`/ventas?metodo=${m}`))).tickets;
    expect([await cuantos("efectivo"), await cuantos("tarjeta"), await cuantos("bizum"), await cuantos("mixto")]).toEqual([2, 1, 1, 1]);
    expect((await json(dependiente("/ventas?desde=2020-01-01&hasta=2020-01-02"))).tickets).toBe(0);
    expect((await dependiente("/ventas?desde=ayer")).status).toBe(400);
    expect((await dependiente("/ventas?metodo=cheque")).status).toBe(400);
  });

  it("el resumen separa hoy de ayer hasta la misma hora", async () => {
    await vender({ lineas: [{ producto_id: 1, cantidad: 1 }] });
    const { hoy, ahora } = (await db.prepare("SELECT hoy, ahora FROM v_ahora").first<{ hoy: string; ahora: string }>())!;
    const ayerAntes = (await db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%S', ?, '-1 day', '-1 minute') AS f").bind(ahora).first<string>("f"))!;
    const ayerDespues = (await db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%S', ?, '-1 day', '+1 minute') AS f").bind(ahora).first<string>("f"))!;
    await db.batch([
      db.prepare("INSERT INTO ventas (fecha, total_cent) VALUES (?, 500)").bind(ayerAntes),
      db.prepare("INSERT INTO ventas (fecha, total_cent) VALUES (?, 900)").bind(ayerDespues),
    ]);
    const r = await json(admin("/resumen/hoy"));
    expect(hoy).toBeTruthy();
    // ayerAntes cuenta como "ayer a esta hora"; ayerDespues puede caer en hoy solo si es medianoche
    expect(r.tickets_ayer).toBe(1);
    expect(r.facturado_ayer).toBe(5);
    expect(r.tickets).toBeGreaterThanOrEqual(1);
  });

  it("sin ventas devuelve ceros, no nulos", async () => {
    expect(await json(admin("/resumen/hoy"))).toEqual({ tickets: 0, facturado: 0, tickets_ayer: 0, facturado_ayer: 0 });
  });
});

describe("caja", () => {
  it("reparte el pago mixto por forma de pago", async () => {
    await vender({ metodo_pago: "mixto", pago_tarjeta: 1, lineas: [{ producto_id: 1, cantidad: 4 }] });
    await vender({ metodo_pago: "bizum", lineas: [{ producto_id: 1, cantidad: 1 }] });
    expect(await json(dependiente("/caja"))).toMatchObject({ tickets: 2, total_efectivo: 3.8, total_tarjeta: 1, total_bizum: 1.2, total: 6, cierre: null });
  });

  it("un día sin ventas da ceros y se puede cerrar", async () => {
    const dia = "2020-05-05";
    expect(await json(dependiente(`/caja?dia=${dia}`))).toEqual({ dia, tickets: 0, total_efectivo: 0, total_tarjeta: 0, total_bizum: 0, total_fiado: 0, total: 0, cobros_fiado: 0, cierre: null });
    const r = await dependiente("/caja/cierre", "POST", { fecha: dia, fondo_inicial: 50, efectivo_contado: 49.5 });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ fecha: dia, diferencia: -0.5, usuario: "dep", fondo_inicial: 50 });
    const repetido = await dependiente("/caja/cierre", "POST", { fecha: dia, efectivo_contado: 0 });
    expect(repetido.status).toBe(409);
    expect((await json(dependiente(`/caja?dia=${dia}`))).cierre.diferencia).toBe(-0.5);
  });

  it("calcula el descuadre con las ventas del día y no cierra días futuros", async () => {
    await vender({ metodo_pago: "efectivo", lineas: [{ producto_id: 1, cantidad: 10 }] });
    const cierre = await json(dependiente("/caja/cierre", "POST", { fondo_inicial: 20, efectivo_contado: 32.5 }));
    expect(cierre).toMatchObject({ tickets: 1, total_efectivo: 12, diferencia: 0.5 });
    expect((await json<unknown[]>(dependiente("/caja/cierres"))).length).toBe(1);
    expect((await dependiente("/caja/cierre", "POST", { fecha: "2099-01-01", efectivo_contado: 0 })).status).toBe(400);
    expect((await dependiente("/caja/cierre", "POST", { efectivo_contado: -1 })).status).toBe(400);
  });
});

describe("mermas", () => {
  it("resta stock, gasta el lote que caduca antes, guarda el coste y lo audita", async () => {
    const r = await dependiente("/mermas", "POST", { producto_id: 3, cantidad: 4, motivo: "roto", notas: "se cayó" });
    expect(r.status).toBe(200);
    expect(await stock(3)).toBe(8000);
    expect(await lotes()).toEqual({ 10: 4000, 11: 0, 12: 4000 });
    expect(await ultimaAuditoria()).toMatchObject({ accion: "merma", usuario: "dep", detalle: "4 u de Yogur (roto): se cayó" });

    const lista = await json<Record<string, unknown>[]>(admin("/mermas"));
    expect(lista[0]).toMatchObject({ producto: "Yogur", cantidad: 4, motivo: "roto", perdida: 4, usuario: "dep" });
  });

  it("con lote indicado solo gasta ese lote", async () => {
    await dependiente("/mermas", "POST", { producto_id: 3, cantidad: 2, motivo: "caducado", lote_id: 12 });
    expect(await lotes()).toEqual({ 10: 4000, 11: 3000, 12: 3000 });
  });

  it("a peso, con decimales", async () => {
    await dependiente("/mermas", "POST", { producto_id: 2, cantidad: 1.25, motivo: "consumo_propio" });
    expect(await stock(2)).toBe(8750);
    expect((await ultimaAuditoria())!.detalle).toBe("1,25 kg de Patatas (consumo propio)");
  });

  it("rechaza lo que no cuadra sin guardar nada", async () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ producto_id: 1, cantidad: 999, motivo: "roto" }, "mayor que el stock"],
      [{ producto_id: 1, cantidad: 1, motivo: "roto", lote_id: 10 }, "no corresponde"],
      [{ producto_id: 1, cantidad: 1, motivo: "aburrimiento" }, "motivo"],
      [{ producto_id: 999, cantidad: 1, motivo: "roto" }, "no existe"],
      [{ producto_id: 1, cantidad: 0, motivo: "roto" }, "cantidad"],
    ];
    for (const [datos, texto] of casos) {
      const r = await dependiente("/mermas", "POST", datos);
      expect(r.status, JSON.stringify(datos)).toBe(400);
      expect((await json(r)).detail).toContain(texto);
    }
    expect(await contar("mermas")).toBe(0);
    expect(await stock(1)).toBe(20000);
  });
});

describe("compras", () => {
  it("suma stock, recalcula el coste medio ponderado y calcula el total", async () => {
    // Agua: 20 u a 0,50 + 10 u a 0,80 = (10 + 8) / 30 = 0,60
    const r = await admin("/compras", "POST", { numero_factura: "F-1", proveedor_id: 1, lineas: [{ producto_id: 1, cantidad: 10, coste_unitario: 0.8 }] });
    expect(r.status).toBe(200);
    const c = await json(r);
    expect(c.total_sin_iva).toBe(8);
    expect(await stock(1)).toBe(30000);
    expect(await db.prepare("SELECT coste_medio_dm FROM productos WHERE id = 1").first<number>("coste_medio_dm")).toBe(6000);

    const detalle = await json(admin(`/compras/${c.id}`));
    expect(detalle).toMatchObject({ numero_factura: "F-1", proveedor: "Coca-Cola", total_sin_iva: 8, usuario: "jefe" });
    expect(detalle.lineas).toEqual([expect.objectContaining({ producto: "Agua", cantidad: 10, coste_unitario: 0.8, subtotal: 8, fecha_caducidad: null })]);
    expect(await json(admin("/compras"))).toEqual([expect.objectContaining({ id: c.id, lineas: 1, proveedor: "Coca-Cola" })]);
  });

  it("sin stock previo, el coste es el de la compra", async () => {
    await vender({ lineas: [{ producto_id: 5, cantidad: 5 }] });
    await admin("/compras", "POST", { lineas: [{ producto_id: 5, cantidad: 2, coste_unitario: 1.2345 }] });
    expect(await db.prepare("SELECT coste_medio_dm FROM productos WHERE id = 5").first<number>("coste_medio_dm")).toBe(12345);
  });

  it("borrar deshace stock y lotes y queda en la auditoría", async () => {
    await db.prepare("UPDATE productos SET controla_caducidad = 1, vida_util_dias = 10 WHERE id = 1").run();
    const { id } = await json(admin("/compras", "POST", { numero_factura: "F-2", lineas: [{ producto_id: 1, cantidad: 6, coste_unitario: 0.3 }] }));
    const lote = await db.prepare("SELECT * FROM lotes WHERE producto_id = 1").first<Record<string, any>>();
    expect(lote).toMatchObject({ inicial_milli: 6000, restante_milli: 6000 });
    const hoy = (await db.prepare("SELECT hoy FROM v_ahora").first<string>("hoy"))!;
    expect(lote!.fecha_entrada).toBe(hoy);
    expect(lote!.fecha_caducidad).toBe(await db.prepare("SELECT date(?, '+10 days') AS f").bind(hoy).first<string>("f"));

    expect((await admin(`/compras/${id}`, "DELETE")).status).toBe(200);
    expect(await stock(1)).toBe(20000);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM lotes WHERE producto_id = 1").first<number>("n")).toBe(0);
    expect(await contar("lineas_compra")).toBe(0);
    const aud = await ultimaAuditoria();
    expect(aud).toMatchObject({ accion: "borrar_compra", usuario: "jefe" });
    expect(aud!.detalle).toContain("1,80 € sin IVA, factura F-2");
  });

  it("no borra una compra ya vendida", async () => {
    const { id } = await json(admin("/compras", "POST", { lineas: [{ producto_id: 5, cantidad: 1, coste_unitario: 1 }] }));
    await vender({ lineas: [{ producto_id: 5, cantidad: 6 }] });
    const r = await admin(`/compras/${id}`, "DELETE");
    expect(r.status).toBe(400);
    expect((await json(r)).detail).toContain("Escaso");
    expect(await contar("compras")).toBe(1);
  });

  it("exige fecha si el producto caduca y no sabe calcularla, sin guardar nada", async () => {
    await db.prepare("UPDATE productos SET controla_caducidad = 1, vida_util_dias = NULL WHERE id = 1").run();
    const r = await admin("/compras", "POST", { lineas: [
      { producto_id: 2, cantidad: 1, coste_unitario: 1 }, { producto_id: 1, cantidad: 1, coste_unitario: 1 }] });
    expect(r.status).toBe(400);
    expect((await json(r)).detail).toContain('"Agua" controla caducidad');
    expect(await contar("compras")).toBe(0);
    expect(await stock(2)).toBe(10000);
  });

  it("el trigger protege aunque se salte la API", async () => {
    await db.prepare("UPDATE productos SET controla_caducidad = 1 WHERE id = 1").run();
    await db.prepare("INSERT INTO compras (id) VALUES (70)").run();
    await expect(db.prepare("INSERT INTO lineas_compra (compra_id, producto_id, cantidad_milli, coste_unitario_dm) VALUES (70, 1, 1000, 1)").run())
      .rejects.toThrow(/CADUCIDAD_SIN_FECHA/);
  });

  it("producto o proveedor inexistentes no guardan nada", async () => {
    expect((await admin("/compras", "POST", { lineas: [{ producto_id: 999, cantidad: 1, coste_unitario: 1 }] })).status).toBe(400);
    expect((await admin("/compras", "POST", { proveedor_id: 999, lineas: [{ producto_id: 1, cantidad: 1, coste_unitario: 1 }] })).status).toBe(400);
    expect((await admin("/compras", "POST", { lineas: [] })).status).toBe(400);
    expect(await contar("compras")).toBe(0);
    expect(await stock(1)).toBe(20000);
  });

  it("el pedido sugerido estima el coste", async () => {
    const pedido = await json<Record<string, unknown>[]>(admin("/pedido-sugerido"));
    expect(pedido).toEqual([expect.objectContaining({ producto: "Escaso", cantidad_sugerida: 15, coste_estimado: 0 })]);
    await db.prepare("UPDATE productos SET coste_medio_dm = 2500 WHERE id = 5").run();
    expect((await json<Record<string, unknown>[]>(admin("/pedido-sugerido")))[0]).toMatchObject({ coste_medio: 0.25, coste_estimado: 3.75 });
  });
});

describe("catálogo", () => {
  const alta = { nombre: "Yogur griego", codigo_barras: " 9990000000017 ", categoria_id: 1, iva_id: 2, precio_venta: 1.5 };

  it("alta con stock inicial: crea compra, lote y coste, todo a la vez", async () => {
    const r = await admin("/productos", "POST", { ...alta, controla_caducidad: true, coste_compra: 0.8, stock_inicial: 12, fecha_caducidad: "2031-05-01" });
    expect(r.status).toBe(200);
    const { id, compra_id } = await json(r);
    expect(compra_id).toBeGreaterThan(0);
    const p = (await json<Record<string, any>[]>(admin("/productos/admin"))).find((x) => x.id === id)!;
    expect(p).toMatchObject({ nombre: "Yogur griego", codigo_barras: "9990000000017", stock_actual: 12, coste_medio: 0.8, precio_venta: 1.5, iva: 10, categoria: "Alimentación" });
    expect(await db.prepare("SELECT fecha_caducidad, restante_milli FROM lotes WHERE producto_id = ?").bind(id).first()).toEqual({ fecha_caducidad: "2031-05-01", restante_milli: 12000 });

    const repetido = await admin("/productos", "POST", { ...alta, nombre: "Otro" });
    expect(repetido.status).toBe(409);
    expect((await json(repetido)).detail).toContain("código de barras");
    expect((await json(admin("/codigo/9990000000017"))).en_catalogo.id).toBe(id);
  });

  it("alta de un producto que caduca, sin fecha: no guarda nada", async () => {
    const antes = await contar("productos");
    const r = await admin("/productos", "POST", { nombre: "Sin fecha", categoria_id: 1, iva_id: 2, precio_venta: 1, controla_caducidad: true, stock_inicial: 3 });
    expect(r.status).toBe(400);
    expect(await contar("productos")).toBe(antes);
    expect(await contar("compras")).toBe(0);
  });

  it("alta sin stock no crea compra, y rechaza datos malos", async () => {
    const r = await json(admin("/productos", "POST", { nombre: "Simple", categoria_id: 1, iva_id: 2, precio_venta: 1 }));
    expect(r.compra_id).toBeNull();
    for (const malo of [{ nombre: "", categoria_id: 1, iva_id: 2, precio_venta: 1 }, { nombre: "X", categoria_id: 999, iva_id: 2, precio_venta: 1 },
      { nombre: "X", categoria_id: 1, iva_id: 2, precio_venta: -1 }, { nombre: "X", categoria_id: 1, iva_id: 2, precio_venta: 1, unidad_medida: "litro" }]) {
      expect((await admin("/productos", "POST", malo)).status, JSON.stringify(malo)).toBe(400);
    }
  });

  it("editar: auditoría de precio, coste y baja; null borra lo opcional e ignora lo obligatorio", async () => {
    await db.prepare("UPDATE productos SET proveedor_id = 1 WHERE id = 1").run();
    const r = await admin("/productos/1", "PATCH", { nombre: "Agua 2", precio_venta: 9.99, proveedor_id: null, codigo_barras: null, categoria_id: null });
    expect(r.status).toBe(200);
    const fila = await db.prepare("SELECT nombre, precio_venta_cent, proveedor_id, codigo_barras, categoria_id FROM productos WHERE id = 1").first();
    expect(fila).toEqual({ nombre: "Agua 2", precio_venta_cent: 999, proveedor_id: null, codigo_barras: null, categoria_id: 2 });
    expect(await ultimaAuditoria()).toMatchObject({ accion: "cambiar_precio", usuario: "jefe", detalle: "Agua 2: 1,20 € → 9,99 €" });

    await admin("/productos/1", "PATCH", { coste_medio: 0.75 });
    expect(await ultimaAuditoria()).toMatchObject({ accion: "cambiar_coste", detalle: "Agua 2: coste 0,75 €" });
    await admin("/productos/1", "PATCH", { activo: false });
    expect(await ultimaAuditoria()).toMatchObject({ accion: "baja_producto" });
    expect((await admin("/productos/9999", "PATCH", { nombre: "x" })).status).toBe(404);
  });

  it("editar no permite tocar el stock ni columnas desconocidas", async () => {
    await admin("/productos/1", "PATCH", { stock_actual: 9999, stock_milli: 1, "activo = 0, nombre": "x" });
    expect(await stock(1)).toBe(20000);
    expect(await db.prepare("SELECT activo FROM productos WHERE id = 1").first<number>("activo")).toBe(1);
  });

  it("busca sin distinguir acentos y ordena en español", async () => {
    await db.batch([
      db.prepare("INSERT INTO productos (id, nombre, categoria_id, iva_id, precio_venta_cent) VALUES (20, 'Limón', 1, 2, 10)"),
      db.prepare("INSERT INTO productos (id, nombre, categoria_id, iva_id, precio_venta_cent) VALUES (21, 'Ácido', 1, 2, 10)"),
      db.prepare("INSERT INTO productos (id, nombre, categoria_id, iva_id, precio_venta_cent) VALUES (22, 'Zumo', 1, 2, 10)"),
    ]);
    expect((await json<{ producto: string }[]>(dependiente("/productos?q=limon"))).map((p) => p.producto)).toEqual(["Limón"]);
    const nombres = (await json<{ producto: string }[]>(dependiente("/productos"))).map((p) => p.producto);
    expect(nombres.indexOf("Ácido")).toBe(0);
    expect(nombres.at(-1)).toBe("Zumo");
  });

  it("categorías y proveedores", async () => {
    const cat = await json(admin("/categorias", "POST", { nombre: " Mascotas " }));
    expect(cat.nombre).toBe("Mascotas");
    expect((await admin("/categorias", "POST", { nombre: "mascotas" })).status).toBe(409);
    await admin(`/categorias/${cat.id}`, "PATCH", { activa: false });
    expect((await json<{ nombre: string }[]>(dependiente("/categorias"))).some((x) => x.nombre === "Mascotas")).toBe(false);
    expect((await json<Record<string, any>[]>(admin("/categorias/todas"))).find((x) => x.nombre === "Bebidas")).toMatchObject({ productos: 1 });

    const pr = await json(admin("/proveedores", "POST", { nombre: "Nuevo", telefono: " 600 ", email: "" }));
    const fila = (await json<Record<string, any>[]>(admin("/proveedores"))).find((x) => x.id === pr.id);
    expect(fila).toMatchObject({ telefono: "600", email: null });
    await admin(`/proveedores/${pr.id}`, "PATCH", { activo: false, notas: "x" });
    expect((await json<{ id: number }[]>(admin("/proveedores"))).some((x) => x.id === pr.id)).toBe(false);
    expect((await json<{ id: number }[]>(admin("/proveedores?todos=true"))).some((x) => x.id === pr.id)).toBe(true);
    expect((await json<Record<string, any>[]>(admin("/tipos-iva")))[0]).toEqual({ id: 4, nombre: "Exento", porcentaje: 0 });
  });

  it("código de barras: valida y consulta Open Food Facts sin enviar datos personales", async () => {
    expect((await admin("/codigo/abc")).status).toBe(400);
    const espia = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({
      status: 1, product: { product_name_es: " Galletas ", brands: "KELLOGG ESPAÑA S.L., Otra", quantity: "500 g", categories: "Dulces" },
    }));
    const r = await json(admin("/codigo/8410000000000"));
    expect(r).toEqual({ codigo: "8410000000000", en_catalogo: null, externo: { nombre: "Galletas", marca: "KELLOGG ESPAÑA", cantidad: "500 g", categorias: "Dulces" } });
    const [url, init] = espia.mock.calls[0]!;
    expect(String(url)).toContain("/product/8410000000000.json");
    expect((init!.headers as Record<string, string>)["User-Agent"]).toBe("TiendaASIR/1.0 (proyecto educativo)");

    espia.mockRejectedValue(new Error("sin red"));
    expect((await json(admin("/codigo/8410000000001"))).externo).toBeNull();
  });
});

describe("informes", () => {
  it("calcula el beneficio real sin IVA, con mermas y al céntimo", async () => {
    // 10 aguas a 1,20 con 10 % de IVA: 12,00 €, base 10,91, coste 5,00, beneficio 5,91
    await vender({ lineas: [{ producto_id: 1, cantidad: 10 }] }, admin);
    await admin("/mermas", "POST", { producto_id: 1, cantidad: 2, motivo: "roto" });

    const [mes] = await json<Record<string, any>[]>(admin("/informes/mensual"));
    expect(mes).toMatchObject({ facturacion: 12, base_imponible: 10.91, coste: 5, beneficio_bruto: 5.91, perdidas_mermas: 1, beneficio_neto: 4.91, margen_pct: 45, estimacion_15_pct: 1.8 });

    const [prod] = await json<Record<string, any>[]>(admin("/informes/productos"));
    expect(prod).toMatchObject({ producto_id: 1, producto: "Agua", categoria: "Bebidas", unidades_vendidas: 10, facturacion: 12, beneficio: 5.91, margen_pct: 54.2 });
    const [cat] = await json<Record<string, any>[]>(admin("/informes/categorias"));
    expect(cat).toMatchObject({ categoria: "Bebidas", facturacion: 12, beneficio: 5.91 });

    const dias = await json<Record<string, any>[]>(admin("/informes/diario"));
    expect(dias).toEqual([expect.objectContaining({ num_ventas: 1, facturacion: 12, ticket_medio: 12 })]);
  });

  it("detecta productos parados", async () => {
    await db.prepare("UPDATE productos SET creado_en = '2020-01-01T10:00:00' WHERE id IN (1, 5)").run();
    await vender({ lineas: [{ producto_id: 1, cantidad: 1 }] });
    const parados = await json<Record<string, any>[]>(admin("/informes/parados?dias=30"));
    expect(parados.map((p) => p.producto)).toEqual(["Escaso"]);
    expect(parados[0]!.dias_sin_vender).toBeGreaterThan(1000);
    expect(parados[0]!.ultima_venta).toBeNull();
  });
});

describe("alta sin precio", () => {
  it("se puede dar de alta sin precio, pero no vender hasta ponérselo", async () => {
    const r = await admin("/productos", "POST", { nombre: "Escaneado", codigo_barras: "8400000000017", categoria_id: 1, iva_id: 2, stock_inicial: 6 });
    expect(r.status).toBe(200);
    const { id } = await json(r);
    expect(await stock(id)).toBe(6000);
    const v = await dependiente("/ventas", "POST", { lineas: [{ producto_id: id, cantidad: 1 }] });
    expect(v.status).toBe(400);
    expect((await json(v)).detail).toContain("todavía no tiene precio");
    await admin(`/productos/${id}`, "PATCH", { precio_venta: 1.5 });
    expect((await dependiente("/ventas", "POST", { lineas: [{ producto_id: id, cantidad: 1 }] })).status).toBe(200);
  });
});

describe("estadísticas", () => {
  it("resume el periodo, lo compara con el anterior y reparte por producto, pago y mes", async () => {
    // Venta de hace 40 días (periodo anterior) y venta de hoy con tarjeta; una merma hoy
    const vieja = await vender({ lineas: [{ producto_id: 1, cantidad: 5 }] }, admin);
    await db.prepare("UPDATE ventas SET fecha = (SELECT strftime('%Y-%m-%dT10:00:00', hoy, '-40 days') FROM v_ahora) WHERE id = ?").bind(vieja.id).run();
    await vender({ lineas: [{ producto_id: 1, cantidad: 10 }], metodo_pago: "tarjeta" }, admin);
    await admin("/mermas", "POST", { producto_id: 1, cantidad: 2, motivo: "roto" });

    const e = await json(admin("/estadisticas"));
    expect(e).toMatchObject({ dias: 30, agrupado: "dia" });
    expect(e.actual).toMatchObject({
      ventas_brutas: 12, devoluciones: 0, ventas_netas: 12, sin_iva: 10.91, iva: 1.09, coste: 5, beneficio_bruto: 5.91,
      mermas: 1, beneficio: 4.91, margen: 45, tickets: 1, ticket_medio: 12, articulos_ticket: 10,
      pagos: { efectivo: 0, tarjeta: 12, bizum: 0, fiado: 0 },
    });
    expect(e.anterior).toMatchObject({ ventas_netas: 6, tickets: 1, mermas: 0 });
    expect(e.cambio).toMatchObject({ ventas_netas: 100, tickets: 0 });
    expect(e.serie).toHaveLength(30);
    expect(e.serie.at(-1)).toMatchObject({ facturacion: 12, beneficio: 4.91, tickets: 1 });
    expect(e.productos).toEqual([expect.objectContaining({ producto: "Agua", unidades: 10, facturacion: 12, beneficio: 5.91, margen: 54.2, tickets: 1, sin_coste: false })]);
    expect(e.categorias).toEqual([expect.objectContaining({ categoria: "Bebidas", facturacion: 12, peso: 100 })]);
    expect(e.semana.reduce((t: number, d: { tickets: number }) => t + d.tickets, 0)).toBe(1);
    expect(e.mensual).toHaveLength(12);
    expect(e.mensual.at(-1)).toMatchObject({ beneficio: 4.91 });

    // Un periodo largo se agrupa por meses
    const año = await json(admin("/estadisticas?desde=2026-01-01&hasta=2026-12-31"));
    expect(año).toMatchObject({ dias: 365, agrupado: "mes" });
    expect(año.serie).toHaveLength(12);

    // Comparar con lo que pida la pantalla: aquí, los mismos 30 días del año pasado
    const conAño = await json(admin(`/estadisticas?desde=${e.desde}&hasta=${e.hasta}&comparar_desde=${Number(e.desde.slice(0, 4)) - 1}${e.desde.slice(4)}&comparar_hasta=${Number(e.hasta.slice(0, 4)) - 1}${e.hasta.slice(4)}`));
    expect(conAño.anterior).toMatchObject({ tickets: 0, ventas_netas: 0 });
    expect(conAño.cambio.ventas_netas).toBeNull();
    expect((await admin(`/estadisticas?desde=${e.desde}&comparar_desde=${e.desde}&comparar_hasta=${e.hasta}`)).status).toBe(400);
  });

  it("las devoluciones restan y el dependiente no puede verlas", async () => {
    const v = await vender({ lineas: [{ producto_id: 1, cantidad: 4 }] }, admin);
    const t = await json(admin(`/ventas/${v.id}`));
    await admin(`/ventas/${v.id}/devolucion`, "POST", { metodo: "efectivo", lineas: [{ linea_id: t.lineas[0].linea_id, cantidad: 1, repuesto: true }] });
    const e = await json(admin("/estadisticas"));
    expect(e.actual).toMatchObject({ ventas_brutas: 4.8, devoluciones: 1.2, num_devoluciones: 1, ventas_netas: 3.6 });
    expect(e.productos[0]).toMatchObject({ unidades: 3, facturacion: 3.6 });

    expect((await dependiente("/estadisticas")).status).toBe(403);
    expect((await admin("/estadisticas?desde=2026-02-30")).status).toBe(400);
    expect((await admin("/estadisticas?desde=2026-05-02&hasta=2026-05-01")).status).toBe(400);
  });
});

describe("usuarios y contraseñas", () => {
  it("crea, cambia la contraseña y desactiva, y queda auditado", async () => {
    const r = await admin("/usuarios", "POST", { usuario: "prueba", nombre: " Prueba ", rol: "dependiente", password: "prueba1234" });
    expect(r.status).toBe(200);
    const { id } = await json(r);
    expect(await ultimaAuditoria()).toMatchObject({ accion: "crear_usuario", usuario: "jefe", detalle: "prueba (dependiente)" });
    const lista = await json<Record<string, unknown>[]>(admin("/usuarios"));
    expect(JSON.stringify(lista)).not.toContain("password");
    expect(lista.find((u) => u.id === id)).toMatchObject({ nombre: "Prueba", activo: 1 });

    const t = await tokenDe("prueba", "prueba1234");
    const yo = como(t);
    expect((await yo("/auth/cambiar-password", "POST", { actual: "mala", nueva: "otra12345" })).status).toBe(400);
    expect((await yo("/auth/cambiar-password", "POST", { actual: "prueba1234", nueva: "corta" })).status).toBe(400);
    expect((await yo("/auth/cambiar-password", "POST", { actual: "prueba1234", nueva: "otra12345" })).status).toBe(200);
    expect(await ultimaAuditoria()).toMatchObject({ accion: "cambiar_contraseña", usuario: "prueba" });
    expect((await entrar("prueba", "otra12345", "7.7.7.7")).status).toBe(200);
    expect((await entrar("prueba", "prueba1234", "7.7.7.8")).status).toBe(401);

    await admin(`/usuarios/${id}`, "PATCH", { activo: false });
    expect(await ultimaAuditoria()).toMatchObject({ accion: "modificar_usuario", detalle: "prueba: perfil dependiente, desactivado" });
    expect((await entrar("prueba", "otra12345", "7.7.7.9")).status).toBe(401);
  });

  it("el administrador cambia la contraseña de otro", async () => {
    expect((await admin("/usuarios/2", "PATCH", { password: "nueva-clave-1" })).status).toBe(200);
    expect((await entrar("dep", "nueva-clave-1", "6.6.6.6")).status).toBe(200);
    expect((await entrar("dep", CLAVE, "6.6.6.7")).status).toBe(401);
  });

  it("valida los datos y no deja quitarse a uno mismo", async () => {
    expect((await admin("/usuarios/1", "PATCH", { activo: false })).status).toBe(400);
    expect((await admin("/usuarios/1", "PATCH", { rol: "dependiente" })).status).toBe(400);
    expect((await admin("/usuarios/999", "PATCH", { nombre: "x" })).status).toBe(404);
    expect((await admin("/usuarios", "POST", { usuario: "jefe", nombre: "x", rol: "admin", password: "12345678" })).status).toBe(409);
    for (const malo of [{ usuario: "a b", nombre: "x", rol: "admin", password: "12345678" }, { usuario: "bueno", nombre: "x", rol: "rey", password: "12345678" }, { usuario: "bueno", nombre: "x", rol: "admin", password: "corta" }]) {
      expect((await admin("/usuarios", "POST", malo)).status).toBe(400);
    }
    const r = await admin("/auditoria?limite=1");
    expect(r.status).toBe(200);
  });
});

describe("asistente", () => {
  const respuestaGemini = (...parts: unknown[]) => Response.json({ candidates: [{ content: { parts } }] });
  const herramientasEnviadas = (cuerpo: { tools: { functionDeclarations: { name: string }[] }[] }) =>
    cuerpo.tools[0]!.functionDeclarations.map((d) => d.name);

  it("consulta los datos con una herramienta y responde, y recuerda la conversación", async () => {
    const peticiones: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      const cuerpo = JSON.parse(String(init!.body));
      peticiones.push(cuerpo);
      if (peticiones.length === 1) return respuestaGemini({ functionCall: { name: "buscar_productos", args: { texto: "agua" } }, thoughtSignature: "firma" });
      return respuestaGemini({ text: "Quedan 20 aguas." });
    });
    const r = await admin("/asistente", "POST", { mensaje: "¿Cuánta agua queda?", conversacion: "a" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ respuesta: "Quedan 20 aguas." });

    const segunda = peticiones[1];
    expect(segunda.contents[1].parts[0].thoughtSignature).toBe("firma");
    const resultado = segunda.contents[2].parts[0].functionResponse;
    expect(resultado.name).toBe("buscar_productos");
    expect(resultado.response.resultado).toContain('"stock_actual":20');

    // Otra pregunta: lleva la anterior, pero no los datos ya consultados
    await admin("/asistente", "POST", { mensaje: "¿Y yogures?", conversacion: "a" });
    const tercera = peticiones[2];
    expect(tercera.contents.map((m: any) => m.parts[0].text)).toEqual(["¿Cuánta agua queda?", "Quedan 20 aguas.", "¿Y yogures?"]);
    // Otra conversación empieza de cero
    await admin("/asistente", "POST", { mensaje: "Hola", conversacion: "b" });
    expect(peticiones[3].contents).toHaveLength(1);
  });

  it("todas las herramientas funcionan contra la base de datos real", async () => {
    await vender({ lineas: [{ producto_id: 1, cantidad: 1 }] });
    const llamadas = ["buscar_productos", "productos_con_stock_bajo", "productos_que_caducan", "ventas_de_hoy", "productos_sin_vender", "caja_por_forma_de_pago", "clientes_con_fiado", "ofertas_activas",
      "resumen_mensual", "beneficio_por_categoria", "ranking_productos", "beneficio_de_producto", "ventas_por_dia", "mermas_recientes", "pedido_sugerido", "cambios_recientes"];
    let ultima: any;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      ultima = JSON.parse(String(init!.body));
      if (ultima.contents.length === 1) {
        return respuestaGemini(...llamadas.map((name) => ({ functionCall: { name, args: name.includes("buscar") || name === "beneficio_de_producto" ? { texto: "agua" } : {} } })));
      }
      return respuestaGemini({ text: "Listo" });
    });
    expect((await admin("/asistente", "POST", { mensaje: "todo" })).status).toBe(200);
    expect(herramientasEnviadas(ultima).sort()).toEqual([...llamadas].sort());
    const resultados = ultima.contents.at(-1).parts.map((p: any) => p.functionResponse);
    expect(resultados).toHaveLength(16);
    for (const { name, response } of resultados) expect(response.resultado, name).not.toBe("Herramienta no disponible.");
  });

  it("el dependiente no recibe ni puede ejecutar herramientas de costes", async () => {
    let ultima: any;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      ultima = JSON.parse(String(init!.body));
      if (ultima.contents.length === 1) return respuestaGemini({ functionCall: { name: "resumen_mensual", args: {} } });
      return respuestaGemini({ text: "Eso solo lo ve el administrador." });
    });
    expect((await dependiente("/asistente", "POST", { mensaje: "¿Cuánto gano?" })).status).toBe(200);
    expect(herramientasEnviadas(ultima).sort()).toEqual(["buscar_productos", "caja_por_forma_de_pago", "clientes_con_fiado", "ofertas_activas", "productos_con_stock_bajo", "productos_que_caducan", "productos_sin_vender", "ventas_de_hoy"]);
    expect(ultima.contents.at(-1).parts[0].functionResponse.response.resultado).toBe("Herramienta no disponible.");
    expect(ultima.systemInstruction.parts[0].text).toContain("DEPENDIENTE");
  });

  it("la clave no va en la URL y los fallos del proveedor dan un mensaje claro", async () => {
    const espia = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 400 }));
    const r = await admin("/asistente", "POST", { mensaje: "hola" });
    expect(r.status).toBe(503);
    expect(String(espia.mock.calls[0]![0])).not.toContain("clave-falsa");
    expect((espia.mock.calls[0]![1]!.headers as Record<string, string>)["x-goog-api-key"]).toBe("clave-falsa");
    expect(await r.text()).not.toContain("clave-falsa");
    expect(await contar("conversaciones")).toBe(0);

    espia.mockImplementation(async () => new Response("{}", { status: 429 }));
    expect((await admin("/asistente", "POST", { mensaje: "hola" })).status).toBe(429);
    expect((await admin("/asistente", "POST", { mensaje: "" })).status).toBe(400);
  });

  it("no da vueltas sin fin", async () => {
    const espia = vi.spyOn(globalThis, "fetch").mockImplementation(async () => respuestaGemini({ functionCall: { name: "ventas_de_hoy", args: {} } }));
    expect((await admin("/asistente", "POST", { mensaje: "hola" })).status).toBe(503);
    expect(espia).toHaveBeenCalledTimes(6);
  });

  it("/auth/yo dice si hay asistente", async () => {
    expect((await json(admin("/auth/yo"))).asistente).toBe(true);
  });
});

describe("eficiencia", () => {
  it("la caja de un día usa el índice en vez de recorrer todas las ventas", async () => {
    const plan = await db.prepare("EXPLAIN QUERY PLAN SELECT * FROM v_caja_diaria WHERE dia = '2026-01-01'").all<{ detail: string }>();
    expect(plan.results.map((f) => f.detail).join(" | ")).toContain("idx_venta_dia");
  });
});

describe("notas", () => {
  it("guarda la fecha y el autor sin que los indique nadie, y las más nuevas salen primero", async () => {
    const r = await dependiente("/notas", "POST", { texto: "  Llamar a Coca-Cola  ", usuario: "jefe", autor: "Otro", fecha: "2000-01-01T00:00:00" });
    expect(r.status).toBe(200);
    const n = await json(r);
    const hoy = (await db.prepare("SELECT hoy FROM v_ahora").first<string>("hoy"))!;
    expect(n).toMatchObject({ texto: "Llamar a Coca-Cola", usuario: "dep", autor: "Dependiente" });
    expect(n.fecha.slice(0, 10)).toBe(hoy);
    await admin("/notas", "POST", { texto: "Segunda" });
    expect((await json<{ texto: string }[]>(dependiente("/notas"))).map((x) => x.texto)).toEqual(["Segunda", "Llamar a Coca-Cola"]);
  });

  it("cada cual borra las suyas y el administrador cualquiera", async () => {
    const delJefe = await json(admin("/notas", "POST", { texto: "Del jefe" }));
    const delDep = await json(dependiente("/notas", "POST", { texto: "Del dependiente" }));
    const otraDelDep = await json(dependiente("/notas", "POST", { texto: "Otra" }));
    expect((await dependiente(`/notas/${delJefe.id}`, "DELETE")).status).toBe(403);
    expect((await dependiente(`/notas/${delDep.id}`, "DELETE")).status).toBe(200);
    expect((await admin(`/notas/${otraDelDep.id}`, "DELETE")).status).toBe(200);
    expect((await admin("/notas/99999", "DELETE")).status).toBe(404);
    expect(await contar("notas")).toBe(1);
  });

  it("rechaza notas vacías o demasiado largas, y pide sesión", async () => {
    for (const texto of ["", "   ", "x".repeat(1001), 5]) expect((await dependiente("/notas", "POST", { texto })).status).toBe(400);
    expect(await contar("notas")).toBe(0);
    expect((await pedir("/notas")).status).toBe(401);
  });
});

describe("rutas desconocidas", () => {
  it("con sesión dan 404, sin sesión 401", async () => {
    expect((await admin("/no-existe")).status).toBe(404);
    expect((await pedir("/no-existe")).status).toBe(401);
  });
});

describe("leer factura con foto", () => {
  const gemini = (leido: unknown) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(leido) }] } }] });
  const foto = { tipo: "image/jpeg", datos: "QUJDRA==" };
  const factura = (lineas: unknown[]) => ({
    es_factura: true, proveedor: "Distribuciones Bebidas Norte S.L.", numero_factura: "F-77", fecha: "2026-11-10", total_sin_iva: 30, lineas,
  });
  const linea = (descripcion: string, extra: Record<string, unknown> = {}) =>
    ({ descripcion, es_producto: true, cantidad: 24, unidades_por_bulto: 24, por_kg: false, coste_unitario: 0.45, iva: 10, ...extra });

  it("empareja por código y por nombre, y aprende la descripción al guardar la compra", async () => {
    const prov = await json(admin("/proveedores", "POST", { nombre: "Bebidas Norte" }));
    const espia = vi.spyOn(globalThis, "fetch").mockImplementation(async () => gemini(factura([
      linea("AGUA MINERAL 1,5L", { codigo_barras: "111" }), // el código 111 no es un EAN válido: va por nombre
      linea("YOGUR NATURAL 125G"),
      linea("REFRESCO COLA LATA"),
      linea("PORTES", { es_producto: false, cantidad: 1, coste_unitario: 5 }),
    ])));
    const r = await json(admin("/compras/leer-factura", "POST", foto));
    expect(espia.mock.calls[0]![0]).toContain("gemini-flash-latest");
    expect(r.proveedor_id).toBe(prov.id);
    expect(r.numero_factura).toBe("F-77");
    expect(r.lineas.map((l: any) => [l.producto_id, l.como])).toEqual([[1, "nombre"], [3, "nombre"], [null, null], [null, null]]);
    expect(r.lineas[3].es_producto).toBe(false);

    // Se guarda la compra diciendo que "REFRESCO COLA LATA" es el agua (producto 1)
    await admin("/compras", "POST", { proveedor_id: prov.id, lineas: [{ producto_id: 1, cantidad: 24, coste_unitario: 0.45, texto_factura: "REFRESCO COLA LATA" }] });
    expect(await stock(1)).toBe(44000);
    const otra = await json(admin("/compras/leer-factura", "POST", foto));
    expect(otra.lineas[2]).toMatchObject({ producto_id: 1, como: "aprendido" });
  });

  it("si el modelo bueno está saturado usa el ligero", async () => {
    const espia = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => new Response("{}", { status: 503 }))
      .mockImplementation(async () => gemini(factura([linea("Patatas", { por_kg: true, cantidad: 10, coste_unitario: 0.6 })])));
    const r = await json(admin("/compras/leer-factura", "POST", foto));
    expect(espia.mock.calls[1]![0]).toContain("gemini-flash-lite-latest");
    expect(r.lineas[0]).toMatchObject({ producto_id: 2, por_kg: true, cantidad: 10 });
  });

  it("rechaza lo que no es una factura, ficheros raros y al dependiente", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => gemini({ es_factura: false, lineas: [] }));
    expect((await admin("/compras/leer-factura", "POST", foto)).status).toBe(400);
    expect((await admin("/compras/leer-factura", "POST", { tipo: "text/html", datos: "QUJD" })).status).toBe(400);
    expect((await admin("/compras/leer-factura", "POST", { tipo: "image/jpeg", datos: "<script>" })).status).toBe(400);
    expect((await dependiente("/compras/leer-factura", "POST", foto)).status).toBe(403);
    expect((await admin("/compras/leer-factura", "POST", { paginas: Array(6).fill(foto) })).status).toBe(400);
  });

  it("acepta varias páginas en una sola petición", async () => {
    const espia = vi.spyOn(globalThis, "fetch").mockImplementation(async () => gemini(factura([linea("Agua")])));
    expect((await admin("/compras/leer-factura", "POST", { paginas: [foto, { tipo: "application/pdf", datos: "QUJD" }] })).status).toBe(200);
    const partes = JSON.parse(String(espia.mock.calls[0]![1]!.body)).contents[0].parts;
    expect(partes.map((p: any) => p.inlineData?.mimeType ?? "texto")).toEqual(["image/jpeg", "application/pdf", "texto"]);
  });
});
