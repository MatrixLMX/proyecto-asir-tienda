import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { aB64, avisoDiario, cifrar, componerResumen, deB64, firmaVapid } from "../src/avisos";
import { contar, db, pedir, reiniciar, stock, tokenDe } from "./ayuda";

let jefe = "";
let dep = "";
const como = (token: string) => (ruta: string, metodo = "GET", datos?: unknown) =>
  pedir(ruta, { method: metodo, headers: { Authorization: `Bearer ${token}` }, ...(datos === undefined ? {} : { body: JSON.stringify(datos) }) });
const admin = (r: string, m?: string, d?: unknown) => como(jefe)(r, m, d);
const dependiente = (r: string, m?: string, d?: unknown) => como(dep)(r, m, d);
const json = async <T = Record<string, any>>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const vender = (d: unknown) => json(dependiente("/ventas", "POST", d));
const lotes = async () => Object.fromEntries((await db.prepare("SELECT id, restante_milli FROM lotes").all<{ id: number; restante_milli: number }>()).results.map((l) => [l.id, l.restante_milli]));
const ultimaAuditoria = () => db.prepare("SELECT * FROM auditoria ORDER BY id DESC LIMIT 1").first<Record<string, any>>();
const precioLinea = (venta: number) => db.prepare("SELECT precio_unitario_cent FROM lineas_venta WHERE venta_id = ?").bind(venta).first<number>("precio_unitario_cent");

beforeEach(async () => {
  await reiniciar();
  jefe = await tokenDe("jefe");
  dep = await tokenDe("dep");
});
afterEach(() => { vi.restoreAllMocks(); });

describe("productos sin control de stock", () => {
  beforeEach(async () => {
    await db.prepare("INSERT INTO productos (id, nombre, categoria_id, iva_id, precio_venta_cent, control_stock, acceso_rapido) VALUES (30, 'Barra de pan', 1, 2, 90, 0, 1)").run();
    await db.prepare("INSERT INTO productos (id, nombre, categoria_id, iva_id, precio_venta_cent, control_stock, precio_libre, acceso_rapido) VALUES (31, 'Chuches', 1, 3, 0, 0, 1, 1)").run();
  });

  it("se venden sin stock, sin avisos de agotado y sin tocar cantidades", async () => {
    const v = await vender({ lineas: [{ producto_id: 30, cantidad: 7 }] });
    expect(v.total).toBe(6.3);
    expect(await stock(30)).toBe(0);
    const pan = (await json<Record<string, any>[]>(dependiente("/productos"))).find((p) => p.id === 30)!;
    expect(pan).toMatchObject({ estado: "OK", control_stock: 0, acceso_rapido: 1 });
    expect((await json<{ id: number }[]>(dependiente("/alertas/stock"))).some((a) => a.id === 30)).toBe(false);
    expect((await admin(`/ventas/${v.id}`, "DELETE")).status).toBe(200);
    expect(await stock(30)).toBe(0);
  });

  it("precio libre: usa el importe escrito, y lo exige", async () => {
    const v = await vender({ lineas: [{ producto_id: 31, cantidad: 1, precio: 1.35 }] });
    expect(v.total).toBe(1.35);
    for (const precio of [undefined, 0, -1, "x"]) {
      expect((await dependiente("/ventas", "POST", { lineas: [{ producto_id: 31, cantidad: 1, precio }] })).status, String(precio)).toBe(400);
    }
  });

  it("nadie puede cambiar el precio de un producto normal desde el ticket", async () => {
    expect((await vender({ lineas: [{ producto_id: 1, cantidad: 1, precio: 0.01 }] })).total).toBe(1.2);
  });

  it("compra: guarda el coste pero no suma stock; merma: no resta", async () => {
    await admin("/compras", "POST", { lineas: [{ producto_id: 30, cantidad: 50, coste_unitario: 0.4 }] });
    expect(await db.prepare("SELECT stock_milli s, coste_medio_dm c FROM productos WHERE id = 30").first()).toEqual({ s: 0, c: 4000 });
    expect((await dependiente("/mermas", "POST", { producto_id: 30, cantidad: 3, motivo: "otro" })).status).toBe(200);
    expect(await stock(30)).toBe(0);
    const [compra] = await json<{ id: number }[]>(admin("/compras"));
    expect((await admin(`/compras/${compra!.id}`, "DELETE")).status).toBe(200);
  });

  it("el alta y la edición guardan las opciones", async () => {
    const { id } = await json(admin("/productos", "POST", { nombre: "Palmera", categoria_id: 1, iva_id: 2, precio_venta: 1, control_stock: false, acceso_rapido: true, stock_inicial: 9, controla_caducidad: true }));
    const p = (await json<Record<string, any>[]>(admin("/productos/admin"))).find((x) => x.id === id)!;
    expect(p).toMatchObject({ control_stock: 0, acceso_rapido: 1, stock_actual: 0, controla_caducidad: 0 });
    await admin(`/productos/${id}`, "PATCH", { acceso_rapido: false, precio_libre: true });
    expect((await json<Record<string, any>[]>(admin("/productos/admin"))).find((x) => x.id === id)).toMatchObject({ acceso_rapido: 0, precio_libre: 1 });
    expect((await json(admin("/productos", "POST", { nombre: "Granel", categoria_id: 1, iva_id: 2, precio_libre: true, control_stock: false }))).id).toBeGreaterThan(0);
  });

  it("al dejar de controlar el stock, sus lotes dejan de avisar", async () => {
    await db.prepare("INSERT INTO lotes (producto_id, fecha_entrada, fecha_caducidad, inicial_milli, restante_milli) VALUES (1, '2020-01-01', '2020-01-02', 1000, 1000)").run();
    expect((await json<unknown[]>(dependiente("/alertas/caducidades"))).length).toBe(1);
    await admin("/productos/1", "PATCH", { control_stock: false });
    expect((await json<unknown[]>(dependiente("/alertas/caducidades"))).length).toBe(0);
  });
});

describe("ofertas por cantidad", () => {
  beforeEach(async () => { await admin("/ofertas", "POST", { producto_id: 1, cantidad_minima: 3, precio: 1 }); });

  it("por debajo de la cantidad, precio normal; al llegar, todas las unidades a precio de oferta", async () => {
    expect((await vender({ lineas: [{ producto_id: 1, cantidad: 2 }] })).total).toBe(2.4);
    const v = await vender({ lineas: [{ producto_id: 1, cantidad: 3 }] });
    expect(v.total).toBe(3);
    expect(await precioLinea(v.id)).toBe(100);
    expect((await json(dependiente(`/ventas/${v.id}`))).lineas[0].precio_unitario).toBe(1);
  });

  it("cuenta el total del ticket aunque venga en varias líneas, y elige la mejor", async () => {
    await admin("/ofertas", "POST", { producto_id: 1, cantidad_minima: 6, precio: 0.8 });
    expect((await vender({ lineas: [{ producto_id: 1, cantidad: 2 }, { producto_id: 1, cantidad: 2 }] })).total).toBe(4);
    expect((await vender({ lineas: [{ producto_id: 1, cantidad: 6 }] })).total).toBe(4.8);
  });

  it("no aplica la oferta desactivada ni a otros productos, y se puede borrar", async () => {
    const [o] = await json<{ id: number; precio_normal: number; producto: string }[]>(dependiente("/ofertas"));
    expect(o).toMatchObject({ producto: "Agua", precio_normal: 1.2 });
    await admin(`/ofertas/${o!.id}`, "PATCH", { activa: false });
    expect((await vender({ lineas: [{ producto_id: 1, cantidad: 3 }] })).total).toBe(3.6);
    expect((await vender({ lineas: [{ producto_id: 3, cantidad: 3 }] })).total).toBe(7.5);
    expect((await admin(`/ofertas/${o!.id}`, "DELETE")).status).toBe(200);
    expect(await contar("ofertas")).toBe(0);
    expect(await ultimaAuditoria()).toMatchObject({ accion: "borrar_oferta", usuario: "jefe" });
  });

  it("si el precio normal baja de la oferta, se cobra el normal", async () => {
    await admin("/productos/1", "PATCH", { precio_venta: 0.9 });
    expect((await vender({ lineas: [{ producto_id: 1, cantidad: 3 }] })).total).toBe(2.7);
  });

  it("el beneficio se calcula con el precio de oferta", async () => {
    await vender({ lineas: [{ producto_id: 1, cantidad: 10 }] });
    const [m] = await json<Record<string, number>[]>(admin("/informes/mensual"));
    expect(m).toMatchObject({ facturacion: 10, base_imponible: 9.09, coste: 5, beneficio_bruto: 5 });
  });

  it("valida la oferta y solo la toca el administrador", async () => {
    for (const malo of [{ producto_id: 1, cantidad_minima: 1, precio: 1 }, { producto_id: 1, cantidad_minima: 5, precio: 1.2 }, { producto_id: 999, cantidad_minima: 5, precio: 1 }]) {
      expect((await admin("/ofertas", "POST", malo)).status, JSON.stringify(malo)).toBe(400);
    }
    expect((await admin("/ofertas", "POST", { producto_id: 1, cantidad_minima: 3, precio: 0.5 })).status).toBe(409);
    expect((await dependiente("/ofertas", "POST", { producto_id: 1, cantidad_minima: 5, precio: 1 })).status).toBe(403);
  });
});

describe("fiado", () => {
  let juan = 0;
  beforeEach(async () => { juan = (await json(dependiente("/clientes", "POST", { nombre: "Juan", telefono: "600" }))).id; });
  const deuda = async (id = juan) => (await json(dependiente(`/clientes/${id}`))).deuda;

  it("apunta la venta, no mete dinero en caja y cuenta al cobrar", async () => {
    const v = await vender({ metodo_pago: "fiado", cliente_id: juan, lineas: [{ producto_id: 1, cantidad: 5 }] });
    expect(v.total).toBe(6);
    expect(await deuda()).toBe(6);
    expect(await json(dependiente("/caja"))).toMatchObject({ tickets: 1, total_efectivo: 0, total_fiado: 6, total: 6, cobros_fiado: 0 });
    expect(await json(dependiente(`/ventas/${v.id}`))).toMatchObject({ metodo_pago: "fiado", pago_fiado: 6, cliente: "Juan" });
    expect((await json(dependiente("/ventas?metodo=fiado"))).tickets).toBe(1);

    expect((await dependiente(`/clientes/${juan}/pagos`, "POST", { importe: 4, metodo: "bizum" })).status).toBe(200);
    expect(await deuda()).toBe(2);
    expect(await ultimaAuditoria()).toMatchObject({ accion: "cobro_fiado", usuario: "dep", detalle: "Juan: 4,00 € en bizum" });
    expect(await json(dependiente("/caja"))).toMatchObject({ total_bizum: 4, cobros_fiado: 4, total: 6, total_efectivo: 0 });

    const r = await dependiente(`/clientes/${juan}/pagos`, "POST", { importe: 2.01 });
    expect(r.status).toBe(400);
    expect((await json(r)).detail).toContain("más de lo que debe");
    await dependiente(`/clientes/${juan}/pagos`, "POST", { importe: 2 });
    expect(await deuda()).toBe(0);
    const c = await json(dependiente(`/clientes/${juan}`));
    expect(c.movimientos.map((m: any) => m.tipo).sort()).toEqual(["pago", "pago", "venta"]);
  });

  it("pago mixto: una parte en efectivo y el resto a fiado", async () => {
    await vender({ metodo_pago: "mixto", pago_fiado: 3, cliente_id: juan, lineas: [{ producto_id: 1, cantidad: 5 }] });
    expect(await deuda()).toBe(3);
    expect(await json(dependiente("/caja"))).toMatchObject({ total_efectivo: 3, total_fiado: 3 });
  });

  it("fiar sin cliente o a un cliente desactivado no guarda nada", async () => {
    await admin(`/clientes/${juan}`, "PATCH", { activo: false });
    for (const d of [{ metodo_pago: "fiado" }, { metodo_pago: "fiado", cliente_id: juan }, { metodo_pago: "fiado", cliente_id: 999 }, { metodo_pago: "mixto", pago_fiado: 1 }]) {
      expect((await dependiente("/ventas", "POST", { ...d, lineas: [{ producto_id: 1, cantidad: 5 }] })).status, JSON.stringify(d)).toBe(400);
    }
    expect(await contar("ventas")).toBe(0);
    expect(await stock(1)).toBe(20000);
  });

  it("anular un ticket fiado borra la deuda; no se desactiva a quien debe; borrar un cobro lo devuelve", async () => {
    const v = await vender({ metodo_pago: "fiado", cliente_id: juan, lineas: [{ producto_id: 1, cantidad: 1 }] });
    expect((await admin(`/clientes/${juan}`, "PATCH", { activo: false })).status).toBe(400);
    await dependiente(`/clientes/${juan}/pagos`, "POST", { importe: 1 });

    // Ya ha pagado parte: anular le dejaría saldo a favor
    const r = await admin(`/ventas/${v.id}`, "DELETE");
    expect(r.status).toBe(400);
    expect((await json(r)).detail).toContain("ya ha pagado");
    expect(await stock(1)).toBe(19000);

    const pago = (await json(dependiente(`/clientes/${juan}`))).movimientos.find((m: any) => m.tipo === "pago");
    expect((await dependiente(`/pagos-fiado/${pago.id}`, "DELETE")).status).toBe(403);
    expect((await admin(`/pagos-fiado/${pago.id}`, "DELETE")).status).toBe(200);
    expect(await deuda()).toBe(1.2);
    expect((await admin(`/ventas/${v.id}`, "DELETE")).status).toBe(200);
    expect(await deuda()).toBe(0);
  });

  it("nombres únicos y lista ordenada", async () => {
    expect((await dependiente("/clientes", "POST", { nombre: "juan" })).status).toBe(409);
    expect((await dependiente("/clientes", "POST", { nombre: "" })).status).toBe(400);
    await dependiente("/clientes", "POST", { nombre: "Ángel" });
    expect((await json<{ nombre: string }[]>(dependiente("/clientes"))).map((c) => c.nombre)).toEqual(["Ángel", "Juan"]);
    expect((await dependiente(`/clientes/${juan}`, "PATCH", { nombre: "x" })).status).toBe(403);
  });
});

describe("devoluciones parciales", () => {
  it("devuelve parte: stock, lotes, caja y beneficio, y lo audita", async () => {
    const antes = await lotes();
    const v = await vender({ lineas: [{ producto_id: 3, cantidad: 5 }] });
    const { lineas } = await json(dependiente(`/ventas/${v.id}`));
    const r = await dependiente(`/ventas/${v.id}/devolucion`, "POST", { metodo: "efectivo", lineas: [{ linea_id: lineas[0].linea_id, cantidad: 2 }] });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ importe: 5, metodo: "efectivo" });
    expect(await stock(3)).toBe(9000);
    // Se vendieron 3 del lote 11 y 2 del 12: vuelven al que caduca más tarde
    expect(await lotes()).toEqual({ ...antes, 11: 0, 12: 5000 });
    expect(await json(dependiente("/caja"))).toMatchObject({ total_efectivo: 7.5, total: 7.5, tickets: 1 });
    expect(await json(dependiente("/resumen/hoy"))).toMatchObject({ facturado: 7.5, tickets: 1 });
    expect(await json(dependiente(`/ventas/${v.id}`))).toMatchObject({ devuelto: 5, total: 12.5 });
    expect((await json(dependiente(`/ventas/${v.id}`))).lineas[0].devuelto).toBe(2);
    expect(await ultimaAuditoria()).toMatchObject({ accion: "devolucion", usuario: "dep", detalle: `Ticket nº ${v.id}: 5,00 € en efectivo` });
    const [m] = await json<Record<string, number>[]>(admin("/informes/mensual"));
    // 3 yogures a 2,50 con el 10 % de IVA y 1,00 de coste; los céntimos de base salen de restar venta y devolución.
    // El beneficio es lo cobrado menos el coste (los dos con IVA)
    expect(m).toMatchObject({ facturacion: 7.5, coste: 3, base_imponible: 6.81, beneficio_bruto: 4.5 });
  });

  it("devolver todo por partes suma justo el ticket, también a peso", async () => {
    const v = await vender({ lineas: [{ producto_id: 2, cantidad: 1.25 }] }); // 4,99
    const id = (await json(dependiente(`/ventas/${v.id}`))).lineas[0].linea_id;
    const devolver = (cantidad: number) => dependiente(`/ventas/${v.id}/devolucion`, "POST", { lineas: [{ linea_id: id, cantidad }] });
    expect((await devolver(0.125)).status).toBe(200);
    expect((await devolver(0.125)).status).toBe(200);
    expect((await devolver(1)).status).toBe(200);
    expect((await json(dependiente(`/ventas/${v.id}`))).devuelto).toBe(4.99);
    expect(await stock(2)).toBe(10000);
    const r = await devolver(0.001);
    expect(r.status).toBe(400);
    expect((await json(r)).detail).toContain("más de lo que se vendió");
  });

  it("si estaba roto no vuelve al stock, y su coste sigue contando", async () => {
    const v = await vender({ lineas: [{ producto_id: 1, cantidad: 2 }] });
    const id = (await json(dependiente(`/ventas/${v.id}`))).lineas[0].linea_id;
    await dependiente(`/ventas/${v.id}/devolucion`, "POST", { lineas: [{ linea_id: id, cantidad: 2, repuesto: false }] });
    expect(await stock(1)).toBe(18000);
    const [m] = await json<Record<string, number>[]>(admin("/informes/mensual"));
    expect(m).toMatchObject({ facturacion: 0, coste: 1, beneficio_bruto: -1 });
  });

  it("en un ticket fiado rebaja la deuda, sin pasarse, y solo ahí se puede devolver a fiado", async () => {
    const juan = (await json(dependiente("/clientes", "POST", { nombre: "Juan" }))).id;
    const f = await vender({ metodo_pago: "fiado", cliente_id: juan, lineas: [{ producto_id: 1, cantidad: 3 }] });
    const lf = (await json(dependiente(`/ventas/${f.id}`))).lineas[0].linea_id;
    await dependiente(`/ventas/${f.id}/devolucion`, "POST", { metodo: "fiado", lineas: [{ linea_id: lf, cantidad: 1 }] });
    expect((await json(dependiente(`/clientes/${juan}`))).deuda).toBe(2.4);
    expect(await json(dependiente("/caja"))).toMatchObject({ total_fiado: 2.4, total_efectivo: 0 });

    // Si ya ha pagado, ya no hay deuda que rebajar: se le devuelve dinero
    await dependiente(`/clientes/${juan}/pagos`, "POST", { importe: 2.4 });
    const r = await dependiente(`/ventas/${f.id}/devolucion`, "POST", { metodo: "fiado", lineas: [{ linea_id: lf, cantidad: 1 }] });
    expect(r.status).toBe(400);
    expect((await json(r)).detail).toContain("debe menos");
    expect((await dependiente(`/ventas/${f.id}/devolucion`, "POST", { metodo: "efectivo", lineas: [{ linea_id: lf, cantidad: 1 }] })).status).toBe(200);

    const n = await vender({ lineas: [{ producto_id: 1, cantidad: 1 }] });
    const ln = (await json(dependiente(`/ventas/${n.id}`))).lineas[0].linea_id;
    expect((await dependiente(`/ventas/${n.id}/devolucion`, "POST", { metodo: "fiado", lineas: [{ linea_id: ln, cantidad: 1 }] })).status).toBe(400);
  });

  it("con devoluciones no se puede anular, y valida lo que llega", async () => {
    const v = await vender({ lineas: [{ producto_id: 1, cantidad: 3 }] });
    const otra = await vender({ lineas: [{ producto_id: 3, cantidad: 1 }] });
    const id = (await json(dependiente(`/ventas/${v.id}`))).lineas[0].linea_id;
    const ajena = (await json(dependiente(`/ventas/${otra.id}`))).lineas[0].linea_id;
    const dev = (l: unknown[], t = v.id) => dependiente(`/ventas/${t}/devolucion`, "POST", { lineas: l });
    expect((await dev([{ linea_id: ajena, cantidad: 1 }])).status).toBe(400);
    expect((await dev([{ linea_id: id, cantidad: 0.5 }])).status).toBe(400);
    expect((await dev([{ linea_id: id, cantidad: 9 }])).status).toBe(400);
    expect((await dev([{ linea_id: id, cantidad: 1 }], 9999)).status).toBe(404);
    expect(await contar("devoluciones")).toBe(0);
    expect((await dev([{ linea_id: id, cantidad: 1 }])).status).toBe(200);
    const r = await admin(`/ventas/${v.id}`, "DELETE");
    expect(r.status).toBe(400);
    expect((await json(r)).detail).toContain("ya tiene devoluciones");
    expect(await stock(1)).toBe(18000);
  });
});

describe("recuento de inventario", () => {
  it("si falta, lo registra como merma y gasta lotes; si sobra, lo suma; igual, nada", async () => {
    const r = await admin("/inventario/recuento", "POST", { lineas: [
      { producto_id: 3, contado: 10 }, { producto_id: 1, contado: 25 }, { producto_id: 5, contado: 5 },
    ] });
    expect(r.status).toBe(200);
    expect((await json(r)).lineas[0]).toEqual({ producto_id: 3, producto: "Yogur", antes: 12, contado: 10 });
    expect([await stock(3), await stock(1), await stock(5)]).toEqual([10000, 25000, 5000]);
    expect((await lotes())[11]).toBe(1000);
    expect(await db.prepare("SELECT cantidad_milli c, motivo m, notas n FROM mermas").first()).toEqual({ c: 2000, m: "otro", n: "Diferencia de recuento" });
    expect(await contar("ajustes_stock")).toBe(1);
    expect(await ultimaAuditoria()).toMatchObject({ accion: "recuento", detalle: "Agua: apuntado 20, contado 25" });
  });

  it("lo que sobra de un producto que caduca crea su lote", async () => {
    await db.prepare("UPDATE productos SET controla_caducidad = 1 WHERE id = 3").run();
    expect((await admin("/inventario/recuento", "POST", { lineas: [{ producto_id: 3, contado: 15 }] })).status).toBe(400);
    expect((await admin("/inventario/recuento", "POST", { lineas: [{ producto_id: 3, contado: 15, fecha_caducidad: "2031-01-01" }] })).status).toBe(200);
    expect(await db.prepare("SELECT restante_milli r FROM lotes WHERE fecha_caducidad = '2031-01-01'").first()).toEqual({ r: 3000 });
  });

  it("valida y es solo para el administrador", async () => {
    await db.prepare("UPDATE productos SET control_stock = 0 WHERE id = 5").run();
    for (const l of [{ producto_id: 1, contado: 1.5 }, { producto_id: 999, contado: 1 }, { producto_id: 1, contado: -1 }, { producto_id: 5, contado: 1 }]) {
      expect((await admin("/inventario/recuento", "POST", { lineas: [l] })).status, JSON.stringify(l)).toBe(400);
    }
    expect((await admin("/inventario/recuento", "POST", { lineas: [{ producto_id: 1, contado: 1 }, { producto_id: 1, contado: 2 }] })).status).toBe(400);
    expect((await dependiente("/inventario/recuento", "POST", { lineas: [{ producto_id: 1, contado: 1 }] })).status).toBe(403);
  });
});

describe("importar catálogo", () => {
  const fila = { nombre: "Galletas", codigo_barras: "8400000000001", categoria: "Bebidas", iva: 10, precio: 1.5, coste: 0.7, stock: 12, stock_minimo: 2 };

  it("probar no guarda nada; importar crea productos, categorías, proveedores y stock", async () => {
    const filas = [fila, { ...fila, nombre: "Queso", codigo_barras: "", categoria: "Lácteos nuevos", proveedor: "Prov Nuevo", unidad: "kg", stock: 1.5, caducidad: "2031-02-02" },
      { nombre: "Pan a granel", categoria: "Bebidas", iva: 4, precio: 0.9, sin_control_stock: true, stock: 99 }];
    const prueba = await json(admin("/productos/importar", "POST", { probar: true, filas }));
    expect(prueba).toMatchObject({ nuevos: 3, errores: 0, existentes: 0, importado: false });
    expect(await db.prepare("SELECT COUNT(*) n FROM productos WHERE nombre = 'Queso'").first<number>("n")).toBe(0);

    expect(await json(admin("/productos/importar", "POST", { filas }))).toMatchObject({ nuevos: 3, importado: true });
    const lista = await json<Record<string, any>[]>(admin("/productos/admin"));
    expect(lista.find((p) => p.nombre === "Galletas")).toMatchObject({ stock_actual: 12, coste_medio: 0.7, precio_venta: 1.5, iva: 10 });
    expect(lista.find((p) => p.nombre === "Queso")).toMatchObject({ categoria: "Lácteos nuevos", proveedor: "Prov Nuevo", unidad_medida: "kg", stock_actual: 1.5, controla_caducidad: 1 });
    expect(lista.find((p) => p.nombre === "Pan a granel")).toMatchObject({ control_stock: 0, stock_actual: 0 });
    expect(await db.prepare("SELECT COUNT(*) n FROM lotes WHERE fecha_caducidad = '2031-02-02'").first<number>("n")).toBe(1);
    expect(await contar("compras")).toBe(1);
    expect(await ultimaAuditoria()).toMatchObject({ accion: "importar_catalogo", usuario: "jefe" });
  });

  it("lo que ya existe no se toca: ni por nombre ni por código, ni repetido en el fichero", async () => {
    const r = await json(admin("/productos/importar", "POST", { filas: [
      { ...fila, nombre: "agua", codigo_barras: "" }, { ...fila, nombre: "Otro", codigo_barras: "111" }, fila, { ...fila, nombre: "galletas", codigo_barras: "" },
    ] }));
    expect(r).toMatchObject({ nuevos: 1, existentes: 3 });
    expect(await db.prepare("SELECT precio_venta_cent p FROM productos WHERE id = 1").first<number>("p")).toBe(120);
  });

  it("con un error no importa nada y dice qué fila es", async () => {
    const r = await json(admin("/productos/importar", "POST", { filas: [fila, { ...fila, nombre: "Malo", codigo_barras: "", iva: 7 }, { ...fila, nombre: "", codigo_barras: "" }, { ...fila, nombre: "Sin precio", codigo_barras: "", precio: null }] }));
    // La fila sin precio es válida: queda "sin precio" en el catálogo
    expect(r).toMatchObject({ errores: 2, nuevos: 2, importado: false });
    expect(r.filas[1]).toMatchObject({ fila: 2, estado: "error", detalle: "no existe el IVA del 7 %" });
    expect(await db.prepare("SELECT COUNT(*) n FROM productos WHERE nombre = 'Galletas'").first<number>("n")).toBe(0);
    expect((await admin("/productos/importar", "POST", { filas: Array.from({ length: 201 }, () => fila) })).status).toBe(400);
    expect((await dependiente("/productos/importar", "POST", { filas: [fila] })).status).toBe(403);
  });
});

describe("notas: fijar y hecha", () => {
  it("las fijadas arriba y las hechas abajo", async () => {
    const a = await json(dependiente("/notas", "POST", { texto: "A" }));
    await dependiente("/notas", "POST", { texto: "B" });
    const c = await json(dependiente("/notas", "POST", { texto: "C" }));
    await dependiente(`/notas/${a.id}`, "PATCH", { fijada: true });
    await admin(`/notas/${c.id}`, "PATCH", { hecha: true });
    const orden = await json<{ texto: string; fijada: number; hecha: number }[]>(dependiente("/notas"));
    expect(orden.map((n) => n.texto)).toEqual(["A", "B", "C"]);
    expect(orden[0]).toMatchObject({ fijada: 1, hecha: 0 });
    expect((await dependiente("/notas/999", "PATCH", { hecha: true })).status).toBe(404);
  });
});

describe("avisos al móvil", () => {
  const texto = new TextDecoder();

  // Hace lo que hace el navegador al recibirlo (RFC 8291), para comprobar el cifrado
  async function descifrar(cuerpo: Uint8Array, par: CryptoKeyPair, auth: Uint8Array) {
    const hkdf = async (sal: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) => new Uint8Array(await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: sal, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
    const enc = new TextEncoder();
    const sal = cuerpo.slice(0, 16);
    expect(new DataView(cuerpo.buffer, cuerpo.byteOffset).getUint32(16)).toBe(4096);
    const largo = cuerpo[20]!;
    expect(largo).toBe(65);
    const publicaAS = cuerpo.slice(21, 21 + largo);
    const cifrado = cuerpo.slice(21 + largo);
    const publicaUA = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey) as ArrayBuffer);
    const clave = await crypto.subtle.importKey("raw", publicaAS, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const secreto = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clave } as never, par.privateKey, 256));
    const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...publicaUA, ...publicaAS]);
    const ikm = await hkdf(auth, secreto, info, 32);
    const cek = await hkdf(sal, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
    const nonce = await hkdf(sal, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
    const plano = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), cifrado));
    expect(plano.at(-1)).toBe(2);
    return texto.decode(plano.slice(0, -1));
  }

  const nuevoNavegador = async () => {
    const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    const auth = crypto.getRandomValues(new Uint8Array(16));
    return { par, auth, p256dh: aB64(await crypto.subtle.exportKey("raw", par.publicKey) as ArrayBuffer), authB64: aB64(auth) };
  };
  const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";

  it("el cifrado se puede descifrar como lo hace un navegador, y solo ese navegador", async () => {
    const n = await nuevoNavegador();
    const cuerpo = await cifrar("Retirar yogur €", n.p256dh, n.authB64);
    expect(await descifrar(cuerpo, n.par, n.auth)).toBe("Retirar yogur €");
    const otro = await nuevoNavegador();
    await expect(descifrar(cuerpo, otro.par, otro.auth)).rejects.toThrow();
  });

  it("la firma VAPID es válida para ese servicio y no lleva datos personales", async () => {
    const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", par.privateKey) as JsonWebKey;
    const cab = await firmaVapid(ENDPOINT, jwk);
    const [, t, k] = cab.match(/^vapid t=([^,]+), k=(.+)$/)!;
    const [h, d, f] = t!.split(".");
    const datos = JSON.parse(texto.decode(deB64(d!)));
    expect(datos.aud).toBe("https://fcm.googleapis.com");
    expect(datos.sub).toBe("https://tienda.matrixvlogsgg.workers.dev");
    expect(datos.exp).toBeGreaterThan(Date.now() / 1000);
    const publica = await crypto.subtle.importKey("raw", deB64(k!), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publica, deB64(f!), new TextEncoder().encode(`${h}.${d}`))).toBe(true);
  });

  it("el resumen dice lo urgente, y no molesta si no hay nada", async () => {
    await db.prepare("DELETE FROM lotes").run();
    await db.prepare("UPDATE productos SET stock_minimo_milli = 0").run();
    expect(await componerResumen(db)).toBeNull();
    await db.prepare("UPDATE productos SET stock_minimo_milli = 99000 WHERE id = 1").run();
    expect((await componerResumen(db))!.cuerpo).toBe("1 por pedir");
    await db.prepare(`INSERT INTO lotes (producto_id, fecha_entrada, fecha_caducidad, inicial_milli, restante_milli) VALUES
      (3, '2020-01-01', '2020-01-02', 1000, 1000), (1, '2020-01-01', (SELECT date(hoy, '+2 days') FROM v_ahora), 1000, 1000)`).run();
    const r = (await componerResumen(db))!;
    expect(r.cuerpo).toBe("Retirar ya: Yogur · 1 lote caduca pronto · 1 por pedir");
    expect(r.url).toBe("/#caducidades");
  });

  it("solo admite servicios de push reales", async () => {
    const n = await nuevoNavegador();
    for (const endpoint of ["https://evil.example/x", "http://fcm.googleapis.com/x", "https://localhost/x", "basura", "https://fcm.googleapis.com.evil.example/x"]) {
      expect((await dependiente("/avisos/suscribir", "POST", { endpoint, keys: { p256dh: n.p256dh, auth: n.authB64 } })).status, endpoint).toBe(400);
    }
    expect((await dependiente("/avisos/suscribir", "POST", { endpoint: ENDPOINT, keys: {} })).status).toBe(400);
    expect(await contar("suscripciones_push")).toBe(0);
  });

  it("envía a cada suscripción cifrado, borra las caducadas y quitar solo afecta a las propias", async () => {
    const n = await nuevoNavegador();
    await dependiente("/avisos/suscribir", "POST", { endpoint: ENDPOINT, keys: { p256dh: n.p256dh, auth: n.authB64 } });
    await admin("/avisos/suscribir", "POST", { endpoint: `${ENDPOINT}-vieja`, keys: { p256dh: n.p256dh, auth: n.authB64 } });
    await db.prepare("UPDATE productos SET stock_minimo_milli = 99000 WHERE id = 1").run();

    const recibidos: { url: string; cuerpo: Uint8Array; cabeceras: Record<string, string> }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u, init) => {
      recibidos.push({ url: String(u), cuerpo: init!.body as Uint8Array, cabeceras: init!.headers as Record<string, string> });
      return new Response(null, { status: String(u).endsWith("vieja") ? 410 : 201 });
    });
    expect(await avisoDiario(env as never)).toBe(1);
    expect(await contar("suscripciones_push")).toBe(1);
    const buena = recibidos.find((r) => !r.url.endsWith("vieja"))!;
    expect(buena.cabeceras["Content-Encoding"]).toBe("aes128gcm");
    expect(JSON.parse(await descifrar(buena.cuerpo, n.par, n.auth)).titulo).toBe("Revisión de la tienda");

    await admin("/avisos/quitar", "POST", { endpoint: ENDPOINT });
    expect(await contar("suscripciones_push")).toBe(1);
    await dependiente("/avisos/quitar", "POST", { endpoint: ENDPOINT });
    expect(await contar("suscripciones_push")).toBe(0);
  });

  it("probar exige estar suscrito; la clave que se entrega es solo la pública", async () => {
    expect((await dependiente("/avisos/probar", "POST", {})).status).toBe(400);
    const { clave } = await json(dependiente("/avisos/clave"));
    expect(deB64(clave)).toHaveLength(65);
  });
});
