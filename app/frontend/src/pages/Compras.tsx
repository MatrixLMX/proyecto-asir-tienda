import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { euros, post } from "../api";
import { Aviso, Cabecera, useDatos } from "../ui";

export interface ProductoAdmin {
  id: number;
  nombre: string;
  categoria: string;
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
interface Linea { producto_id: number; cantidad: number; coste_unitario: number; fecha_caducidad: string }

const lineaVacia = (): Linea => ({ producto_id: 0, cantidad: 1, coste_unitario: 0, fecha_caducidad: "" });

export default function Compras() {
  const productos = useDatos<ProductoAdmin[]>("/productos/admin");
  const proveedores = useDatos<Proveedor[]>("/proveedores");
  const [proveedor, setProveedor] = useState<number | "">("");
  const [factura, setFactura] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([lineaVacia()]);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const prod = (id: number) => productos.datos?.find((p) => p.id === id);
  const lista = (productos.datos ?? []).filter((p) => p.activo && (!proveedor || p.proveedor_id === proveedor || !p.proveedor_id));
  const total = lineas.reduce((s, l) => s + l.cantidad * l.coste_unitario, 0);
  const editar = (i: number, cambio: Partial<Linea>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambio } : l)));

  async function guardar() {
    setMensaje(null);
    try {
      const r = await post<{ id: number; total_sin_iva: number }>("/compras", {
        proveedor_id: proveedor || null,
        numero_factura: factura || null,
        lineas: lineas.filter((l) => l.producto_id).map((l) => ({ ...l, fecha_caducidad: l.fecha_caducidad || null })),
      });
      setMensaje({ tipo: "ok", texto: `Compra nº ${r.id} guardada (${euros(r.total_sin_iva)} sin IVA). El stock ya está actualizado.` });
      setLineas([lineaVacia()]);
      setFactura("");
      productos.recargar();
    } catch (e) {
      setMensaje({ tipo: "error", texto: (e as Error).message });
    }
  }

  return (
    <>
      <Cabecera titulo="Registrar compra" subtitulo="Introduce el albarán o factura del proveedor. Los costes van sin IVA." />
      <div className="tarjeta p-5">
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="etiqueta">Proveedor</label>
            <select className="campo" value={proveedor} onChange={(e) => setProveedor(e.target.value ? Number(e.target.value) : "")}>
              <option value="">— Sin proveedor —</option>
              {proveedores.datos?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="etiqueta">Nº de factura / albarán</label>
            <input className="campo" value={factura} onChange={(e) => setFactura(e.target.value)} />
          </div>
        </div>

        <div className="space-y-3">
          {lineas.map((l, i) => {
            const p = prod(l.producto_id);
            return (
              <div key={i} className="grid items-end gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                <div>
                  <label className="etiqueta">Producto</label>
                  <select className="campo" value={l.producto_id} onChange={(e) => {
                    const np = prod(Number(e.target.value));
                    editar(i, { producto_id: Number(e.target.value), coste_unitario: np ? Number(np.coste_medio.toFixed(2)) : 0 });
                  }}>
                    <option value={0}>Elige…</option>
                    {lista.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="etiqueta">Cantidad {p?.unidad_medida === "kg" ? "(kg)" : "(uds)"}</label>
                  <input className="campo" type="number" min="0" step={p?.unidad_medida === "kg" ? "0.001" : "1"} value={l.cantidad} onChange={(e) => editar(i, { cantidad: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="etiqueta">Coste unidad (sin IVA)</label>
                  <input className="campo" type="number" min="0" step="0.01" value={l.coste_unitario} onChange={(e) => editar(i, { coste_unitario: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="etiqueta">Caducidad</label>
                  <input
                    className="campo" type="date" value={l.fecha_caducidad} disabled={!p?.controla_caducidad}
                    placeholder={p?.vida_util_dias ? "auto" : ""}
                    onChange={(e) => editar(i, { fecha_caducidad: e.target.value })}
                  />
                </div>
                <button className="boton-sec p-2.5" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                {p?.controla_caducidad && !l.fecha_caducidad ? (
                  <p className="text-xs text-slate-500 sm:col-span-5">
                    {p.vida_util_dias ? `Si no pones fecha, se calcula sola: hoy + ${p.vida_util_dias} días.` : "Este producto necesita fecha de caducidad."}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <button className="boton-sec mt-3" onClick={() => setLineas((ls) => [...ls, lineaVacia()])}><Plus className="size-4" /> Añadir línea</button>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-5">
          <p className="text-sm text-slate-500">Total sin IVA <span className="ml-2 text-2xl font-bold text-slate-900">{euros(total)}</span></p>
          <button className="boton" disabled={!lineas.some((l) => l.producto_id)} onClick={guardar}>Guardar compra</button>
        </div>
        {mensaje && <div className="mt-4"><Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso></div>}
      </div>
    </>
  );
}
