import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, CalendarClock, Euro, PackageCheck, Receipt, ShoppingCart, TrendingUp, Truck } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cantidad, euros, type AlertaStock, type Caducidad } from "../api";
import type { PropsPagina } from "../App";
import { Cabecera, Esqueleto, Insignia, Kpi, Vacio, useColoresGrafico, useDatos } from "../ui";

interface Mes { mes: string; beneficio_neto: number; facturacion: number; margen_pct: number }
interface Dia { dia: string; facturacion: number; num_ventas: number }
interface Hoy { tickets: number; facturado: number; tickets_ayer: number; facturado_ayer: number }

const variacion = (hoy: number, ayer: number) => (ayer ? ((hoy - ayer) / ayer) * 100 : null);

export default function Inicio({ usuario, ir }: PropsPagina) {
  const admin = usuario.rol === "admin";
  const hoy = useDatos<Hoy>("/resumen/hoy");
  const stock = useDatos<AlertaStock[]>("/alertas/stock");
  const cad = useDatos<Caducidad[]>("/alertas/caducidades");
  const meses = useDatos<Mes[]>(admin ? "/informes/mensual" : null);
  const dias = useDatos<Dia[]>(admin ? "/informes/diario?dias=30" : null);
  const c = useColoresGrafico();

  const mesActual = meses.datos?.at(-1);
  const hora = new Date().getHours();
  const saludo = hora < 14 ? "Buenos días" : hora < 21 ? "Buenas tardes" : "Buenas noches";
  const fechaHoy = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const h = hoy.datos;

  return (
    <>
      <Cabecera titulo={`${saludo}, ${usuario.nombre}`} subtitulo={fechaHoy.charAt(0).toUpperCase() + fechaHoy.slice(1)}>
        <div className="flex gap-2">
          <button className="boton" onClick={() => ir("vender")}><ShoppingCart className="size-4" /> Nueva venta</button>
          {admin && <button className="boton-sec" onClick={() => ir("compras")}><Truck className="size-4" /> Compra</button>}
        </div>
      </Cabecera>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {h ? (
          <>
            <Kpi titulo="Vendido hoy" valor={euros(h.facturado)} tendencia={variacion(h.facturado, h.facturado_ayer)} detalle="vs. ayer a esta hora" icono={<Euro className="size-5" />} />
            <Kpi titulo="Tickets hoy" valor={String(h.tickets)} tendencia={variacion(h.tickets, h.tickets_ayer)} detalle="vs. ayer a esta hora" icono={<Receipt className="size-5" />} color="azul" />
          </>
        ) : <><Esqueleto className="h-[132px]" /><Esqueleto className="h-[132px]" /></>}
        {admin ? (
          <Kpi
            titulo="Beneficio del mes"
            valor={mesActual ? euros(mesActual.beneficio_neto) : "—"}
            detalle={mesActual ? `margen ${mesActual.margen_pct?.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %` : undefined}
            icono={<TrendingUp className="size-5" />}
          />
        ) : (
          <Kpi titulo="Stock bajo" valor={String(stock.datos?.length ?? "—")} detalle="productos" icono={<AlertTriangle className="size-5" />} color="ambar" />
        )}
        <Kpi titulo="Caducidades" valor={String(cad.datos?.length ?? "—")} detalle="lotes a revisar" icono={<CalendarClock className="size-5" />} color={cad.datos?.length ? "rojo" : "marca"} />
      </div>

      {admin && (
        <div className="tarjeta mt-6 p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-semibold">Ventas de los últimos 30 días</h2>
            <button className="flex items-center gap-1 text-sm font-medium text-marca-fuerte hover:underline" onClick={() => ir("informes")}>
              Ver beneficios <ArrowRight className="size-4" />
            </button>
          </div>
          <div className="h-64">
            {dias.datos ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dias.datos} margin={{ left: -10, right: 4 }}>
                  <defs>
                    <linearGradient id="relleno" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c.relleno} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={c.relleno} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.rejilla} />
                  <XAxis dataKey="dia" tickFormatter={(d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`} fontSize={12} stroke={c.ejes} tickLine={false} axisLine={false} minTickGap={20} />
                  <YAxis fontSize={12} stroke={c.ejes} tickFormatter={(v: number) => `${v} €`} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: c.fondoTooltip, border: `1px solid ${c.bordeTooltip}`, borderRadius: 12, color: c.texto }}
                    formatter={(v) => [euros(Number(v)), "Facturación"]}
                    labelFormatter={(d) => new Date(String(d)).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}
                  />
                  <Area type="monotone" dataKey="facturacion" stroke={c.linea} strokeWidth={2.5} fill="url(#relleno)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <Esqueleto className="h-full" />}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Lista
          titulo="Caducidades"
          alVerTodo={() => ir("caducidades")}
          cargando={cad.cargando}
          vacio={<Vacio icono={<PackageCheck className="size-6" />} titulo="Nada a punto de caducar" />}
          filas={cad.datos?.slice(0, 5).map((x) => ({
            clave: x.lote_id,
            texto: x.producto,
            detalle: cantidad(x.cantidad_restante, x.unidad_medida),
            insignia: <Insignia color={x.estado === "PROXIMO" ? "ambar" : "rojo"}>{x.estado !== "PROXIMO" ? x.estado.toLowerCase() : x.dias_restantes === 1 ? "mañana" : `${x.dias_restantes} días`}</Insignia>,
          }))}
        />
        <Lista
          titulo="Hay que pedir"
          alVerTodo={() => ir("stock")}
          cargando={stock.cargando}
          vacio={<Vacio icono={<PackageCheck className="size-6" />} titulo="Todo el stock está bien" />}
          filas={stock.datos?.slice(0, 5).map((s) => ({
            clave: s.id,
            texto: s.producto,
            detalle: s.proveedor ?? "sin proveedor",
            insignia: <Insignia color={s.stock_actual <= 0 ? "rojo" : "ambar"}>quedan {cantidad(s.stock_actual, s.unidad_medida)}</Insignia>,
          }))}
        />
      </div>
    </>
  );
}

function Lista({ titulo, filas, cargando, vacio, alVerTodo }: {
  titulo: string; cargando: boolean; vacio: ReactNode; alVerTodo: () => void;
  filas?: { clave: number; texto: string; detalle: string; insignia: ReactNode }[];
}) {
  return (
    <div className="tarjeta p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{titulo}</h2>
        <button className="flex items-center gap-1 text-sm font-medium text-marca-fuerte hover:underline" onClick={alVerTodo}>Ver todo <ArrowRight className="size-4" /></button>
      </div>
      {cargando ? (
        <div className="space-y-2 pt-2">{[1, 2, 3].map((i) => <Esqueleto key={i} className="h-10" />)}</div>
      ) : filas?.length ? (
        <ul>
          {filas.map((f) => (
            <li key={f.clave} className="flex items-center justify-between gap-3 border-b border-borde py-3 text-sm last:border-0">
              <div className="min-w-0">
                <p className="truncate font-medium">{f.texto}</p>
                <p className="text-xs text-tenue">{f.detalle}</p>
              </div>
              {f.insignia}
            </li>
          ))}
        </ul>
      ) : vacio}
    </div>
  );
}
