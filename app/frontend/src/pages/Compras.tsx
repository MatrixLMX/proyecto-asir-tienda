import { useState } from "react";
import { CalendarClock, Plus, Trash2, Truck } from "lucide-react";
import { cantidad, euros, post } from "../api";
import { Cabecera, emitirCambio, useAviso, useDatos } from "../ui";

export interface ProductoAdmin {
  id: number;
  nombre: string;
  codigo_barras: string | null;
  categoria: string;
  categoria_id: number;
  proveedor: string | null;
  proveedor_id: number | null;
  unidad_medida: "unidad" | "kg";
  precio_venta: number;
  coste_medio: number;
  iva: number;
  stock_actual: number;
  stock_minimo: number;
  controla_caducidad: number;
  vida_util_dias: number | null;
  activo: number;
}
interface Proveedor { id: number; nombre: string }
interface Linea { clave: number; producto_id: number; cantidad: number; coste_unitario: number; fecha_caducidad: string }

let siguiente = 0;
const lineaVacia = (): Linea => ({ clave: siguiente++, producto_id: 0, cantidad: 1, coste_unitario: 0, fecha_caducidad: "" });

export default function Compras() {
  const productos = useDatos<ProductoAdmin[]>("/productos/admin");
  const proveedores = useDatos<Proveedor[]>("/proveedores");
  const avisar = useAviso();
  const [proveedor, setProveedor] = useState<number | "">("");
  const [factura, setFactura] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([lineaVacia()]);
  const [guardando, setGuardando] = useState(false);

  const prod = (id: number) => productos.datos?.find((p) => p.id === id);
  // Primero los productos de este proveedor, después el resto
  const lista = (productos.datos ?? [])
    .filter((p) => p.activo)
    .sort((a, b) => Number(b.proveedor_id === proveedor) - Number(a.proveedor_id === proveedor) || a.nombre.localeCompare(b.nombre, "es"));
  const validas = lineas.filter((l) => l.producto_id && l.cantidad > 0);
  const total = validas.reduce((s, l) => s + l.cantidad * l.coste_unitario, 0);
  const editar = (clave: number, cambio: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  async function guardar() {
    setGuardando(true);
    try {
      const r = await post<{ id: number; total_sin_iva: number }>("/compras", {
        proveedor_id: proveedor || null,
        numero_factura: factura || null,
        lineas: validas.map(({ clave: _, ...l }) => ({ ...l, fecha_caducidad: l.fecha_caducidad || null })),
      });
      avisar("ok", `Compra nº ${r.id} guardada (${euros(r.total_sin_iva)} sin IVA). Stock actualizado.`);
      setLineas([lineaVacia()]);
      setFactura("");
      emitirCambio();
    } catch (e) {
      avisar("error", (e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <Cabecera titulo="Registrar compra" subtitulo="Pasa el albarán o la factura del proveedor. Los costes van sin IVA." />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="tarjeta p-5">
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="etiqueta" htmlFor="proveedor">Proveedor</label>
              <select id="proveedor" className="campo" value={proveedor} onChange={(e) => setProveedor(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Sin proveedor</option>
                {proveedores.datos?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="factura">Nº de factura o albarán</label>
              <input id="factura" className="campo" value={factura} onChange={(e) => setFactura(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <div className="space-y-3">
            {lineas.map((l, i) => {
              const p = prod(l.producto_id);
              return (
                <div key={l.clave} className="animar-entrada rounded-2xl border border-borde bg-superficie-2/50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-tenue">LÍNEA {i + 1}</span>
                    {lineas.length > 1 && (
                      <button className="text-tenue hover:text-rose-500" onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))} aria-label="Quitar línea">
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
                    <div>
                      <label className="etiqueta">Producto</label>
                      <select className="campo" value={l.producto_id} onChange={(e) => {
                        const np = prod(Number(e.target.value));
                        editar(l.clave, { producto_id: Number(e.target.value), coste_unitario: np ? Number(np.coste_medio.toFixed(2)) : 0, fecha_caducidad: "" });
                      }}>
                        <option value={0}>Elige un producto…</option>
                        {lista.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="etiqueta">Cantidad {p?.unidad_medida === "kg" ? "(kg)" : "(uds.)"}</label>
                      <input className="campo" type="number" inputMode="decimal" min="0" step={p?.unidad_medida === "kg" ? "0.001" : "1"} value={l.cantidad} onChange={(e) => editar(l.clave, { cantidad: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label className="etiqueta">Coste/ud. sin IVA</label>
                      <input className="campo" type="number" inputMode="decimal" min="0" step="0.01" value={l.coste_unitario} onChange={(e) => editar(l.clave, { coste_unitario: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label className="etiqueta">Caducidad</label>
                      <input className="campo" type="date" value={l.fecha_caducidad} disabled={!p?.controla_caducidad} onChange={(e) => editar(l.clave, { fecha_caducidad: e.target.value })} />
                    </div>
                  </div>
                  {p && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tenue">
                      <span>Stock actual: <b className="text-suave">{cantidad(p.stock_actual, p.unidad_medida)}</b></span>
                      <span>Coste medio: <b className="text-suave">{euros(p.coste_medio)}</b></span>
                      <span>Subtotal: <b className="text-suave">{euros(l.cantidad * l.coste_unitario)}</b></span>
                      {p.controla_caducidad && !l.fecha_caducidad ? (
                        <span className={`flex items-center gap-1 ${p.vida_util_dias ? "" : "font-medium text-amber-600 dark:text-amber-400"}`}>
                          <CalendarClock className="size-3.5" />
                          {p.vida_util_dias ? `Sin fecha: se calcula sola (hoy + ${p.vida_util_dias} días)` : "Este producto necesita fecha de caducidad"}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button className="boton-sec mt-3 w-full border-dashed" onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>
            <Plus className="size-4" /> Añadir línea
          </button>
        </div>

        <aside className="tarjeta h-fit p-5 xl:sticky xl:top-8">
          <h2 className="mb-4 flex items-center gap-2 font-semibold"><Truck className="size-5 text-marca-500" /> Resumen</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-suave">Proveedor</dt><dd className="font-medium">{proveedores.datos?.find((p) => p.id === proveedor)?.nombre ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-suave">Líneas</dt><dd className="font-medium">{validas.length}</dd></div>
          </dl>
          <div className="my-4 flex items-baseline justify-between border-t border-borde pt-4">
            <span className="text-sm text-suave">Total sin IVA</span>
            <span className="text-2xl font-bold tabular-nums">{euros(total)}</span>
          </div>
          <button className="boton w-full py-3" disabled={!validas.length || guardando} onClick={guardar}>Guardar compra</button>
          <p className="mt-3 text-center text-xs text-tenue">El stock, el coste medio y los lotes se actualizan solos.</p>
        </aside>
      </div>
    </>
  );
}
