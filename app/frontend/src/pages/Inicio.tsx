import { AlertTriangle, CalendarClock, Euro, Receipt, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cantidad, euros, type AlertaStock, type Caducidad, type Usuario } from "../api";
import { Cabecera, Insignia, Kpi, Vacio, useDatos } from "../ui";

interface Mes { mes: string; beneficio_neto: number; facturacion: number; margen_pct: number }
interface Dia { dia: string; facturacion: number }

export default function Inicio({ usuario }: { usuario: Usuario }) {
  const admin = usuario.rol === "admin";
  const hoy = useDatos<{ tickets: number; facturado: number }>("/resumen/hoy");
  const stock = useDatos<AlertaStock[]>("/alertas/stock");
  const cad = useDatos<Caducidad[]>("/alertas/caducidades");
  const meses = useDatos<Mes[]>(admin ? "/informes/mensual" : null);
  const dias = useDatos<Dia[]>(admin ? "/informes/diario?dias=30" : null);

  const mesActual = meses.datos?.at(-1);
  const saludo = new Date().getHours() < 14 ? "Buenos días" : "Buenas tardes";

  return (
    <>
      <Cabecera titulo={`${saludo}, ${usuario.nombre}`} subtitulo="Así está la tienda hoy" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi titulo="Vendido hoy" valor={euros(hoy.datos?.facturado ?? 0)} icono={<Euro className="size-5" />} />
        <Kpi titulo="Tickets hoy" valor={String(hoy.datos?.tickets ?? 0)} icono={<Receipt className="size-5" />} />
        {admin ? (
          <Kpi
            titulo="Beneficio este mes"
            valor={euros(mesActual?.beneficio_neto ?? 0)}
            detalle={mesActual ? `Margen real ${mesActual.margen_pct?.toLocaleString("es-ES")} %` : undefined}
            icono={<TrendingUp className="size-5" />}
          />
        ) : (
          <Kpi titulo="Productos con stock bajo" valor={String(stock.datos?.length ?? 0)} icono={<AlertTriangle className="size-5" />} />
        )}
        <Kpi titulo="Lotes a revisar" valor={String(cad.datos?.length ?? 0)} detalle="Caducados o a punto de caducar" icono={<CalendarClock className="size-5" />} />
      </div>

      {admin && (
        <div className="tarjeta mt-6 p-5">
          <h2 className="mb-4 font-semibold">Ventas de los últimos 30 días</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dias.datos ?? []}>
                <defs>
                  <linearGradient id="verde" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="dia" tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)} fontSize={12} stroke="#94a3b8" />
                <YAxis fontSize={12} stroke="#94a3b8" tickFormatter={(v: number) => `${v} €`} />
                <Tooltip formatter={(v) => euros(Number(v))} labelFormatter={(d) => new Date(String(d)).toLocaleDateString("es-ES")} />
                <Area type="monotone" dataKey="facturacion" name="Facturación" stroke="#059669" strokeWidth={2} fill="url(#verde)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="tarjeta p-5">
          <h2 className="mb-3 font-semibold">Caducidades</h2>
          {cad.datos?.length ? (
            <ul className="divide-y divide-slate-100">
              {cad.datos.slice(0, 6).map((c) => (
                <li key={c.lote_id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{c.producto} <span className="text-slate-400">· {cantidad(c.cantidad_restante, c.unidad_medida)}</span></span>
                  <Insignia color={c.estado === "PROXIMO" ? "ambar" : "rojo"}>
                    {c.estado === "PROXIMO" ? `${c.dias_restantes} días` : c.estado.toLowerCase()}
                  </Insignia>
                </li>
              ))}
            </ul>
          ) : <Vacio>Nada a punto de caducar 🎉</Vacio>}
        </div>
        <div className="tarjeta p-5">
          <h2 className="mb-3 font-semibold">Hay que pedir</h2>
          {stock.datos?.length ? (
            <ul className="divide-y divide-slate-100">
              {stock.datos.slice(0, 6).map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>{s.producto} <span className="text-slate-400">· {s.proveedor ?? "sin proveedor"}</span></span>
                  <Insignia color={s.stock_actual <= 0 ? "rojo" : "ambar"}>quedan {cantidad(s.stock_actual, s.unidad_medida)}</Insignia>
                </li>
              ))}
            </ul>
          ) : <Vacio>Todo el stock está por encima del mínimo</Vacio>}
        </div>
      </div>
    </>
  );
}
