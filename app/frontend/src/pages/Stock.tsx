import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cantidad, euros, type ProductoStock } from "../api";
import { Cabecera, Insignia, Vacio, useDatos } from "../ui";

const FILTROS = ["Todos", "BAJO", "AGOTADO"] as const;

export default function Stock() {
  const { datos } = useDatos<ProductoStock[]>("/productos");
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]>("Todos");

  const filas = useMemo(
    () =>
      (datos ?? []).filter(
        (p) =>
          (filtro === "Todos" || p.estado === filtro) &&
          (p.producto.toLowerCase().includes(q.toLowerCase()) || p.categoria.toLowerCase().includes(q.toLowerCase())),
      ),
    [datos, q, filtro],
  );

  return (
    <>
      <Cabecera titulo="Stock" subtitulo="Se actualiza solo con cada compra, venta o merma" />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input className="campo pl-10" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex rounded-xl border border-slate-200 bg-white p-1">
          {FILTROS.map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${filtro === f ? "bg-slate-900 text-white" : "text-slate-500"}`}
            >
              {f.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-5 py-3 font-medium">Producto</th>
              <th className="px-5 py-3 font-medium">Categoría</th>
              <th className="px-5 py-3 text-right font-medium">PVP</th>
              <th className="px-5 py-3 text-right font-medium">Stock</th>
              <th className="px-5 py-3 text-right font-medium">Mínimo</th>
              <th className="px-5 py-3 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50/60">
                <td className="px-5 py-3 font-medium">{p.producto}</td>
                <td className="px-5 py-3 text-slate-500">{p.categoria}</td>
                <td className="px-5 py-3 text-right">{euros(p.precio_venta)}</td>
                <td className="px-5 py-3 text-right font-semibold">{cantidad(p.stock_actual, p.unidad_medida)}</td>
                <td className="px-5 py-3 text-right text-slate-500">{cantidad(p.stock_minimo, p.unidad_medida)}</td>
                <td className="px-5 py-3">
                  <Insignia color={p.estado === "OK" ? "verde" : p.estado === "BAJO" ? "ambar" : "rojo"}>{p.estado.toLowerCase()}</Insignia>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {datos && !filas.length && <Vacio>Sin resultados</Vacio>}
      </div>
    </>
  );
}
