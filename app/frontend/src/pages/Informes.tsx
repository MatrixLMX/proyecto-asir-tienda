import { useState } from "react";
import { Euro, PiggyBank, Percent, Trash2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { euros } from "../api";
import { Cabecera, Esqueleto, Insignia, Kpi, Pestañas, useColoresGrafico, useDatos } from "../ui";

interface Mes {
  mes: string; facturacion: number; base_imponible: number; coste: number; beneficio_bruto: number;
  perdidas_mermas: number; beneficio_neto: number; margen_pct: number; estimacion_15_pct: number;
}
interface Fila { producto?: string; categoria: string; facturacion: number; beneficio: number; margen_pct: number; unidades_vendidas?: number }

const nombreMes = (m: string, largo = false) => {
  const t = new Date(`${m}-01T12:00`).toLocaleDateString("es-ES", largo ? { month: "long", year: "numeric" } : { month: "short", year: "2-digit" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const pct = (n: number) => `${(n ?? 0).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;
const colorMargen = (m: number) => (m >= 25 ? "verde" : m >= 10 ? "ambar" : "rojo");

export default function Informes() {
  const meses = useDatos<Mes[]>("/informes/mensual");
  const categorias = useDatos<Fila[]>("/informes/categorias");
  const productos = useDatos<Fila[]>("/informes/productos");
  const c = useColoresGrafico();
  const [vista, setVista] = useState<"categoria" | "producto">("categoria");

  const actual = meses.datos?.at(-1);
  const diferencia = actual ? actual.beneficio_neto - actual.estimacion_15_pct : 0;
  const filas = (vista === "categoria" ? categorias.datos : productos.datos) ?? [];
  const maxBeneficio = Math.max(...filas.map((f) => Math.abs(f.beneficio)), 1);

  return (
    <>
      <Cabecera titulo="Beneficios" subtitulo="Beneficio real = precio sin IVA − coste de compra − productos tirados" />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {actual ? (
          <>
            <Kpi titulo="Facturado este mes" valor={euros(actual.facturacion)} detalle={nombreMes(actual.mes, true)} icono={<Euro className="size-5" />} color="azul" />
            <Kpi titulo="Beneficio real" valor={euros(actual.beneficio_neto)} detalle={`${diferencia >= 0 ? "+" : ""}${euros(diferencia)} vs. el 15 %`} icono={<PiggyBank className="size-5" />} />
            <Kpi titulo="Margen real" valor={pct(actual.margen_pct)} detalle="sobre la venta sin IVA" icono={<Percent className="size-5" />} />
            <Kpi titulo="Pérdidas por mermas" valor={euros(actual.perdidas_mermas)} detalle="caducados, roturas…" icono={<Trash2 className="size-5" />} color="rojo" />
          </>
        ) : Array.from({ length: 4 }, (_, i) => <Esqueleto key={i} className="h-[132px]" />)}
      </div>

      <div className="tarjeta mt-6 p-5">
        <h2 className="font-semibold">Beneficio real frente a la estimación del 15 %</h2>
        <p className="mb-4 text-sm text-suave">Lo que se apuntaba en la libreta comparado con lo que de verdad se gana.</p>
        <div className="h-72">
          {meses.datos ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={meses.datos} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.rejilla} />
                <XAxis dataKey="mes" tickFormatter={(m: string) => nombreMes(m)} fontSize={12} stroke={c.ejes} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} stroke={c.ejes} tickFormatter={(v: number) => `${v} €`} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: c.rejilla, opacity: 0.4 }}
                  contentStyle={{ background: c.fondoTooltip, border: `1px solid ${c.bordeTooltip}`, borderRadius: 12, color: c.texto }}
                  formatter={(v) => euros(Number(v))}
                  labelFormatter={(m) => nombreMes(String(m), true)}
                />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Bar dataKey="estimacion_15_pct" name="Estimación 15 %" fill={c.secundario} radius={[6, 6, 0, 0]} />
                <Bar dataKey="beneficio_neto" name="Beneficio real" fill={c.linea} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Esqueleto className="h-full" />}
        </div>
      </div>

      <div className="tarjeta mt-6 overflow-x-auto">
        <table className="tabla w-full text-sm">
          <thead>
            <tr>
              <th>Mes</th>
              <th className="text-right">Facturación</th>
              <th className="hidden text-right sm:table-cell">Sin IVA</th>
              <th className="hidden text-right sm:table-cell">Coste</th>
              <th className="text-right">Mermas</th>
              <th className="text-right">Beneficio</th>
              <th className="text-right">Margen</th>
            </tr>
          </thead>
          <tbody>
            {meses.datos?.slice().reverse().map((m) => (
              <tr key={m.mes}>
                <td className="font-medium">{nombreMes(m.mes, true)}</td>
                <td className="text-right tabular-nums">{euros(m.facturacion)}</td>
                <td className="hidden text-right tabular-nums text-suave sm:table-cell">{euros(m.base_imponible)}</td>
                <td className="hidden text-right tabular-nums text-suave sm:table-cell">{euros(m.coste)}</td>
                <td className="text-right tabular-nums text-rose-600 dark:text-rose-400">{m.perdidas_mermas ? `−${euros(m.perdidas_mermas)}` : "—"}</td>
                <td className="text-right font-semibold tabular-nums">{euros(m.beneficio_neto)}</td>
                <td className="text-right"><Insignia color={colorMargen(m.margen_pct)}>{pct(m.margen_pct)}</Insignia></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tarjeta mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borde p-5">
          <h2 className="font-semibold">¿Dónde se gana el dinero?</h2>
          <Pestañas
            valor={vista}
            alCambiar={setVista}
            opciones={[{ id: "categoria", nombre: "Por categoría" }, { id: "producto", nombre: "Por producto" }]}
          />
        </div>
        <ul className="max-h-[480px] overflow-y-auto p-2">
          {filas.map((f) => {
            const nombre = vista === "categoria" ? f.categoria : f.producto!;
            return (
              <li key={nombre} className="rounded-xl px-3 py-2.5 hover:bg-superficie-2/60">
                <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{nombre}</span>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="hidden text-xs text-tenue sm:inline">vendido {euros(f.facturacion)}</span>
                    <span className="font-semibold tabular-nums">{euros(f.beneficio)}</span>
                    <Insignia color={colorMargen(f.margen_pct)}>{pct(f.margen_pct)}</Insignia>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-superficie-2">
                  <div className="h-full rounded-full bg-gradient-to-r from-marca-500 to-marca-400" style={{ width: `${(Math.abs(f.beneficio) / maxBeneficio) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
