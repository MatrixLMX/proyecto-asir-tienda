import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { euros } from "../api";
import { Cabecera, Insignia, useDatos } from "../ui";

interface Mes {
  mes: string; facturacion: number; base_imponible: number; coste: number; beneficio_bruto: number;
  perdidas_mermas: number; beneficio_neto: number; margen_pct: number; estimacion_15_pct: number;
}
interface Fila { producto?: string; categoria: string; facturacion: number; beneficio: number; margen_pct: number; unidades_vendidas?: number }

const nombreMes = (m: string) =>
  new Date(`${m}-01`).toLocaleDateString("es-ES", { month: "short", year: "2-digit" });

function Tabla({ titulo, filas, clave }: { titulo: string; filas: Fila[]; clave: "producto" | "categoria" }) {
  return (
    <div className="tarjeta overflow-hidden">
      <h2 className="border-b border-slate-100 px-5 py-4 font-semibold">{titulo}</h2>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {filas.map((f) => (
              <tr key={f[clave]}>
                <td className="px-5 py-2.5 font-medium">{f[clave]}</td>
                <td className="px-5 py-2.5 text-right text-slate-500">{euros(f.facturacion)}</td>
                <td className="px-5 py-2.5 text-right font-semibold">{euros(f.beneficio)}</td>
                <td className="px-5 py-2.5 text-right">
                  <Insignia color={f.margen_pct >= 25 ? "verde" : f.margen_pct >= 10 ? "ambar" : "rojo"}>{f.margen_pct} %</Insignia>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Informes() {
  const meses = useDatos<Mes[]>("/informes/mensual");
  const categorias = useDatos<Fila[]>("/informes/categorias");
  const productos = useDatos<Fila[]>("/informes/productos");

  return (
    <>
      <Cabecera titulo="Beneficios" subtitulo="Beneficio real = precio sin IVA − coste de compra − productos tirados" />

      <div className="tarjeta p-5">
        <h2 className="font-semibold">Beneficio real frente a la estimación del 15 %</h2>
        <p className="mb-4 text-sm text-slate-500">Lo que se apuntaba en la libreta comparado con lo que de verdad se gana.</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={meses.datos ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="mes" tickFormatter={nombreMes} fontSize={12} stroke="#94a3b8" />
              <YAxis fontSize={12} stroke="#94a3b8" tickFormatter={(v: number) => `${v} €`} />
              <Tooltip formatter={(v) => euros(Number(v))} labelFormatter={(m) => nombreMes(String(m))} />
              <Legend />
              <Bar dataKey="estimacion_15_pct" name="Estimación 15 %" fill="#cbd5e1" radius={[6, 6, 0, 0]} />
              <Bar dataKey="beneficio_neto" name="Beneficio real" fill="#059669" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="tarjeta mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              {["Mes", "Facturación", "Sin IVA", "Coste", "Mermas", "Beneficio", "Margen"].map((h, i) => (
                <th key={h} className={`px-5 py-3 font-medium ${i ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {meses.datos?.slice().reverse().map((m) => (
              <tr key={m.mes}>
                <td className="px-5 py-3 font-medium capitalize">{nombreMes(m.mes)}</td>
                <td className="px-5 py-3 text-right">{euros(m.facturacion)}</td>
                <td className="px-5 py-3 text-right">{euros(m.base_imponible)}</td>
                <td className="px-5 py-3 text-right">{euros(m.coste)}</td>
                <td className="px-5 py-3 text-right text-rose-600">{euros(m.perdidas_mermas)}</td>
                <td className="px-5 py-3 text-right font-semibold">{euros(m.beneficio_neto)}</td>
                <td className="px-5 py-3 text-right">{m.margen_pct} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Tabla titulo="Por categoría" filas={categorias.datos ?? []} clave="categoria" />
        <Tabla titulo="Por producto" filas={productos.datos ?? []} clave="producto" />
      </div>
    </>
  );
}
