import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, Banknote, CalendarRange, Download, Euro, Hourglass, Package, PiggyBank, Receipt, ShoppingBasket, Trash2,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { cantidad, descargarCsv, diaISO, euros, fecha } from "../api";
import { Cabecera, Esqueleto, Insignia, Kpi, Pestañas, Vacio, useColoresGrafico, useDatos } from "../ui";

/* ---------------------------------------------------------------------
   Lo que devuelve /estadisticas
   --------------------------------------------------------------------- */
interface Resumen {
  desde: string; hasta: string; ventas_brutas: number; devoluciones: number; num_devoluciones: number; ventas_netas: number;
  sin_iva: number; iva: number; coste: number; beneficio_bruto: number; mermas: number; beneficio: number; margen: number | null;
  tickets: number; ticket_medio: number; articulos_ticket: number;
  pagos: { efectivo: number; tarjeta: number; bizum: number; fiado: number };
}
interface Punto {
  clave: string; clave_anterior: string | null; facturacion: number; beneficio: number; tickets: number;
  facturacion_anterior: number | null; beneficio_anterior: number | null; tickets_anterior: number | null;
}
interface Producto {
  id: number; producto: string; categoria: string; unidad_medida: string; activo: boolean; precio_libre: boolean;
  unidades: number; facturacion: number; sin_iva: number; coste: number; beneficio: number; margen: number | null; tickets: number; sin_coste: boolean;
}
interface Categoria { categoria: string; facturacion: number; beneficio: number; margen: number | null; peso: number | null; unidades: number; productos: number }
interface Mes { mes: string; facturacion: number; sin_iva: number; coste: number; mermas: number; beneficio: number; margen: number | null; tickets: number; ticket_medio: number; estimacion_15: number }
interface Estadisticas {
  desde: string; hasta: string; dias: number; agrupado: "dia" | "mes";
  actual: Resumen; anterior: Resumen; cambio: Record<string, number | null>; serie: Punto[];
  semana: { dia: number; tickets: number; facturacion: number }[]; horas: { hora: number; tickets: number; facturacion: number }[];
  productos: Producto[]; categorias: Categoria[]; mensual: Mes[]; fiado_pendiente: number; primera_venta: string | null;
}
interface Parado { id: number; producto: string; categoria: string; unidad_medida: string; stock_actual: number; ultima_venta: string | null; dias_sin_vender: number }
interface Merma { id: number; fecha: string; producto: string; unidad_medida: string; cantidad: number; motivo: string; usuario: string | null; perdida: number }

/* ---------------------------------------------------------------------
   Periodos
   --------------------------------------------------------------------- */
type IdPeriodo = "hoy" | "7" | "30" | "mes" | "mes_pasado" | "año" | "siempre" | "otro";
const PERIODOS: { id: IdPeriodo; nombre: string }[] = [
  { id: "hoy", nombre: "Hoy" }, { id: "7", nombre: "7 días" }, { id: "30", nombre: "30 días" }, { id: "mes", nombre: "Este mes" },
  { id: "mes_pasado", nombre: "Mes pasado" }, { id: "año", nombre: "Este año" }, { id: "siempre", nombre: "Desde el principio" }, { id: "otro", nombre: "Elegir fechas" },
];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rango(id: IdPeriodo, primera: string | null): [string, string] {
  const h = new Date();
  switch (id) {
    case "hoy": return [diaISO(), diaISO()];
    case "7": return [diaISO(-6), diaISO()];
    case "mes": return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), diaISO()];
    case "mes_pasado": return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))];
    case "año": return [`${h.getFullYear()}-01-01`, diaISO()];
    case "siempre": return [primera ?? diaISO(-29), diaISO()];
    default: return [diaISO(-29), diaISO()];
  }
}

/** Con qué se compara cada periodo, como en las tiendas online: el mes con el mes
 *  anterior hasta el mismo día, y el año con el año pasado hasta la misma fecha.
 *  Sin nada, el servidor usa los mismos días justo antes. */
function comparacion(id: IdPeriodo): [string, string] | null {
  const h = new Date();
  const finDeMes = (a: number, m: number) => new Date(a, m + 1, 0).getDate();
  switch (id) {
    case "mes": return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth() - 1, Math.min(h.getDate(), finDeMes(h.getFullYear(), h.getMonth() - 1))))];
    case "mes_pasado": return [iso(new Date(h.getFullYear(), h.getMonth() - 2, 1)), iso(new Date(h.getFullYear(), h.getMonth() - 1, 0))];
    case "año": return [`${h.getFullYear() - 1}-01-01`, iso(new Date(h.getFullYear() - 1, h.getMonth(), Math.min(h.getDate(), finDeMes(h.getFullYear() - 1, h.getMonth()))))];
    default: return null;
  }
}

const CLAVE_PERIODO = "tienda_estadisticas_periodo";
const leerPeriodo = (): IdPeriodo => {
  try { const v = localStorage.getItem(CLAVE_PERIODO); return PERIODOS.some((p) => p.id === v) && v !== "otro" ? (v as IdPeriodo) : "30"; } catch { return "30"; }
};

/* ---------------------------------------------------------------------
   Formatos
   --------------------------------------------------------------------- */
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`);
const num = (n: number, d = 0) => n.toLocaleString("es-ES", { maximumFractionDigits: d });
const tickets = (n: number) => `${num(n)} ${n === 1 ? "ticket" : "tickets"}`;
const eurosCorto = (n: number) => (Math.abs(n) >= 1000 ? `${num(n / 1000, 1)} k€` : `${num(n)} €`);
const nombreMes = (m: string, largo = false) => {
  const t = new Date(`${m}-01T12:00`).toLocaleDateString("es-ES", largo ? { month: "long", year: "numeric" } : { month: "short", year: "2-digit" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const diaCorto = (d: string) => new Date(`${d}T12:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
const etiquetaClave = (k: string, largo = false) => (k.length === 7 ? nombreMes(k, largo) : largo
  ? new Date(`${k}T12:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : diaCorto(k));
const textoRango = (a: string, b: string) => (a === b ? diaCorto(a) : `${diaCorto(a)} – ${diaCorto(b)}${a.slice(0, 4) !== b.slice(0, 4) || a.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${b.slice(0, 4)}` : ""}`);
const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const colorMargen = (m: number | null) => (m == null ? "gris" : m >= 25 ? "verde" : m >= 10 ? "ambar" : "rojo");
const MOTIVOS: Record<string, string> = { caducado: "caducado", roto: "roto", robo: "robo", consumo_propio: "consumo propio", otro: "otro" };

type Vista = "resumen" | "dinero" | "productos";

export default function Estadisticas() {
  const [periodo, setPeriodo] = useState<IdPeriodo>(leerPeriodo);
  const [otro, setOtro] = useState<[string, string]>([diaISO(-29), diaISO()]);
  const [vista, setVista] = useState<Vista>("resumen");
  const [primera, setPrimera] = useState<string | null>(null);

  useEffect(() => { try { if (periodo !== "otro") localStorage.setItem(CLAVE_PERIODO, periodo); } catch { /* sin almacenamiento */ } }, [periodo]);

  const [desde, hasta] = periodo === "otro" ? otro : rango(periodo, primera);
  const valido = desde <= hasta;
  const comp = comparacion(periodo);
  const e = useDatos<Estadisticas>(valido && (periodo !== "siempre" || primera)
    ? `/estadisticas?desde=${desde}&hasta=${hasta}${comp ? `&comparar_desde=${comp[0]}&comparar_hasta=${comp[1]}` : ""}` : null);
  // "Desde el principio" necesita saber cuándo fue la primera venta: sale en cualquier respuesta
  const sonda = useDatos<Estadisticas>(periodo === "siempre" && !primera ? "/estadisticas?desde=" + diaISO() : null, false);
  useEffect(() => { const p = e.datos?.primera_venta ?? sonda.datos?.primera_venta; if (p) setPrimera(p); }, [e.datos, sonda.datos]);

  const d = e.datos && e.datos.desde === desde && e.datos.hasta === hasta ? e.datos : null;

  return (
    <>
      <Cabecera titulo="Estadísticas" subtitulo="Cómo va la tienda: dinero, productos y horarios, comparado con el periodo anterior.">
        <Pestañas<Vista> valor={vista} alCambiar={setVista} opciones={[
          { id: "resumen", nombre: "Resumen" }, { id: "dinero", nombre: "Dinero" }, { id: "productos", nombre: "Productos" },
        ]} />
      </Cabecera>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <CalendarRange className="size-4 shrink-0 text-tenue" aria-hidden />
        <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label="Periodo">
          {PERIODOS.map((p) => (
            <button key={p.id} role="radio" aria-checked={periodo === p.id} onClick={() => setPeriodo(p.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition ${periodo === p.id ? "border-transparent bg-texto text-fondo" : "border-borde bg-superficie text-suave hover:text-texto"}`}>
              {p.nombre}
            </button>
          ))}
        </div>
        {periodo === "otro" && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <input type="date" className="campo w-auto py-1.5" aria-label="Desde" value={otro[0]} max={otro[1]} onChange={(ev) => setOtro([ev.target.value, otro[1]])} />
            <span className="text-tenue">a</span>
            <input type="date" className="campo w-auto py-1.5" aria-label="Hasta" value={otro[1]} min={otro[0]} max={diaISO()} onChange={(ev) => setOtro([otro[0], ev.target.value])} />
          </div>
        )}
      </div>
      {d && <p className="-mt-3 mb-5 text-xs text-tenue">{textoRango(d.desde, d.hasta)} · las flechas comparan con {textoRango(d.anterior.desde, d.anterior.hasta)}</p>}

      {!valido ? <div className="tarjeta"><Vacio titulo="Revisa las fechas">La fecha de inicio va después de la de fin.</Vacio></div>
        : e.error && !d ? <div className="tarjeta"><Vacio titulo="No se han podido cargar">{e.error}</Vacio></div>
        : vista === "resumen" ? <VistaResumen d={d} />
        : vista === "dinero" ? <VistaDinero d={d} />
        : <VistaProductos d={d} />}
    </>
  );
}

/* =====================================================================
   Resumen
   ===================================================================== */
function VistaResumen({ d }: { d: Estadisticas | null }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {d ? (
          <>
            <Kpi titulo="Ventas" valor={euros(d.actual.ventas_netas)} tendencia={d.cambio.ventas_netas} detalle="vs. periodo anterior" icono={<Euro className="size-5" />} color="azul" />
            <Kpi titulo="Beneficio" valor={euros(d.actual.beneficio)} tendencia={d.cambio.beneficio} detalle={`margen ${pct(d.actual.margen)}`} icono={<PiggyBank className="size-5" />} />
            <Kpi titulo="Tickets" valor={num(d.actual.tickets)} tendencia={d.cambio.tickets} detalle={`${num(d.actual.tickets / d.dias, 1)} al día`} icono={<Receipt className="size-5" />} color="ambar" />
            <Kpi titulo="Ticket medio" valor={euros(d.actual.ticket_medio)} tendencia={d.cambio.ticket_medio} detalle={`${num(d.actual.articulos_ticket, 1)} artículos por ticket`} icono={<ShoppingBasket className="size-5" />} />
          </>
        ) : Array.from({ length: 4 }, (_, i) => <Esqueleto key={i} className="h-[132px]" />)}
      </div>

      <GraficoEvolucion d={d} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Tarjeta titulo="Lo que más se vende" subtitulo="Por lo que se ha cobrado en el periodo">
          {!d ? <Esqueleto className="h-48" /> : <Ranking filas={[...d.productos].sort((a, b) => b.facturacion - a.facturacion).slice(0, 6)} valor={(p) => p.facturacion} texto={(p) => euros(p.facturacion)} detalle={(p) => cantidad(p.unidades, p.unidad_medida)} />}
        </Tarjeta>
        <Tarjeta titulo="Cómo pagan" subtitulo="Lo cobrado de cada forma, antes de devoluciones">
          {!d ? <Esqueleto className="h-48" /> : <FormasPago r={d.actual} />}
        </Tarjeta>
      </div>
    </>
  );
}

type Metrica = "facturacion" | "beneficio" | "tickets";
const METRICAS: { id: Metrica; nombre: string }[] = [{ id: "facturacion", nombre: "Ventas" }, { id: "beneficio", nombre: "Beneficio" }, { id: "tickets", nombre: "Tickets" }];

function GraficoEvolucion({ d }: { d: Estadisticas | null }) {
  const c = useColoresGrafico();
  const [m, setM] = useState<Metrica>("facturacion");
  const formato = (v: number) => (m === "tickets" ? num(v) : euros(v));
  const total = d ? (m === "facturacion" ? d.actual.ventas_netas : m === "beneficio" ? d.actual.beneficio : d.actual.tickets) : 0;
  const unSoloPunto = (d?.serie.length ?? 0) <= 1;

  return (
    <div className="tarjeta mt-6 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{unSoloPunto ? "Ventas por horas" : `Evolución ${d?.agrupado === "mes" ? "por meses" : "por días"}`}</h2>
          <p className="text-2xl font-bold tabular-nums">{d ? formato(total) : "…"}</p>
        </div>
        {!unSoloPunto && <Pestañas<Metrica> valor={m} alCambiar={setM} opciones={METRICAS} />}
      </div>
      <div className="h-72">
        {!d ? <Esqueleto className="h-full" /> : unSoloPunto ? (
          // Un solo día no tiene evolución: se ve cómo ha ido a lo largo del día
          d.horas.length ? <GraficoBarras alto="h-72" datos={d.horas.map((h) => ({ etiqueta: `${h.hora}h`, valor: h.facturacion, extra: h.tickets }))} />
            : <div className="grid h-full place-items-center text-sm text-suave">Todavía no hay ventas este día.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={d.serie} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.rejilla} />
              <XAxis dataKey="clave" tickFormatter={(k: string) => etiquetaClave(k)} fontSize={12} stroke={c.ejes} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis width={52} fontSize={12} stroke={c.ejes} tickFormatter={(v: number) => (m === "tickets" ? num(v) : eurosCorto(v))} tickLine={false} axisLine={false} allowDecimals={m !== "tickets"} />
              <Tooltip
                contentStyle={{ background: c.fondoTooltip, border: `1px solid ${c.bordeTooltip}`, borderRadius: 12, color: c.texto }}
                formatter={(v, nombre, item) => {
                  const p = item.payload as Punto;
                  const k = nombre === "Este periodo" ? p.clave : p.clave_anterior;
                  return [v == null ? "—" : formato(Number(v)), k ? etiquetaClave(k, true) : String(nombre)];
                }}
                labelFormatter={() => ""}
              />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              <Line dataKey={`${m}_anterior`} name="Periodo anterior" stroke={c.ejes} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line dataKey={m} name="Este periodo" stroke={c.linea} strokeWidth={2} dot={d.serie.length <= 14 ? { r: 4, strokeWidth: 2, fill: c.fondoTooltip } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function FormasPago({ r }: { r: Resumen }) {
  const filas = [
    { id: "efectivo", nombre: "Efectivo", v: r.pagos.efectivo }, { id: "tarjeta", nombre: "Tarjeta", v: r.pagos.tarjeta },
    { id: "bizum", nombre: "Bizum", v: r.pagos.bizum }, { id: "fiado", nombre: "Fiado (pendiente de cobro)", v: r.pagos.fiado },
  ];
  const total = filas.reduce((t, f) => t + f.v, 0);
  if (!total) return <Vacio titulo="Sin ventas en este periodo" />;
  return (
    <ul className="space-y-3.5">
      {filas.map((f) => (
        <li key={f.id}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{f.nombre}</span>
            <span><span className="font-semibold tabular-nums">{euros(f.v)}</span> <span className="ml-1 text-xs text-tenue tabular-nums">{pct(Math.round((f.v / total) * 1000) / 10)}</span></span>
          </div>
          <Barra parte={f.v} total={total} />
        </li>
      ))}
    </ul>
  );
}

/* =====================================================================
   Dinero
   ===================================================================== */
function VistaDinero({ d: datos }: { d: Estadisticas | null }) {
  const d = useMemo(() => {
    if (!datos) return null;
    const primero = datos.mensual.findIndex((m) => m.tickets > 0);
    return { ...datos, mensual: primero < 0 ? datos.mensual.slice(-1) : datos.mensual.slice(primero) };
  }, [datos]);
  const mermas = useDatos<Merma[]>(d ? `/mermas?dias=${Math.min(Math.round((Date.now() - Date.parse(`${d.desde}T00:00`)) / 86_400_000) + 1, 3650)}` : null);
  const enPeriodo = (mermas.datos ?? []).filter((m) => d && m.fecha.slice(0, 10) >= d.desde && m.fecha.slice(0, 10) <= d.hasta);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {d ? (
          <>
            <Kpi titulo="Ventas netas" valor={euros(d.actual.ventas_netas)} tendencia={d.cambio.ventas_netas} detalle="IVA incluido, sin devoluciones" icono={<Euro className="size-5" />} color="azul" />
            <Kpi titulo="Beneficio real" valor={euros(d.actual.beneficio)} tendencia={d.cambio.beneficio} detalle="ventas menos coste y mermas" icono={<PiggyBank className="size-5" />} />
            <Kpi titulo="Margen" valor={pct(d.actual.margen)} detalle={d.cambio.margen == null ? "sobre lo vendido" : `${d.cambio.margen >= 0 ? "+" : ""}${num(d.cambio.margen, 1)} puntos vs. antes`} icono={<Banknote className="size-5" />} />
            <Kpi titulo="Fiado sin cobrar" valor={euros(d.fiado_pendiente)} detalle="lo que deben hoy los clientes" icono={<Receipt className="size-5" />} color="ambar" />
          </>
        ) : Array.from({ length: 4 }, (_, i) => <Esqueleto key={i} className="h-[132px]" />)}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Tarjeta titulo="De las ventas al beneficio" subtitulo="Qué se queda por el camino">
          {!d ? <Esqueleto className="h-72" /> : <Cuenta r={d.actual} cambio={d.cambio} />}
        </Tarjeta>
        <Tarjeta titulo={d && d.mensual.length < 12 ? "Por meses" : "Últimos 12 meses"} subtitulo="Ventas con IVA y beneficio real de cada mes">
          {!d ? <Esqueleto className="h-72" /> : <GraficoMeses meses={d.mensual} />}
        </Tarjeta>
      </div>

      <div className="tarjeta mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borde p-5">
          <div>
            <h2 className="font-semibold">Mes a mes</h2>
            <p className="text-sm text-suave">La última columna compara con el 15 % que se calculaba a ojo.</p>
          </div>
          <button className="boton-sec px-3 py-1.5" disabled={!d} onClick={() => d && descargarCsv("estadisticas_meses", d.mensual, [
            ["mes", "Mes"], ["facturacion", "Ventas"], ["sin_iva", "Sin IVA"], ["coste", "Coste"], ["mermas", "Mermas"], ["beneficio", "Beneficio"],
            ["margen", "Margen %"], ["tickets", "Tickets"], ["ticket_medio", "Ticket medio"], ["estimacion_15", "Estimación 15 %"]])}>
            <Download className="size-4" /> CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="tabla w-full text-sm">
            <thead><tr>
              <th>Mes</th><th className="text-right">Ventas</th><th className="hidden text-right md:table-cell">Tickets</th>
              <th className="hidden text-right md:table-cell">Ticket medio</th><th className="hidden text-right sm:table-cell">Mermas</th>
              <th className="text-right">Beneficio</th><th className="text-right">Margen</th><th className="hidden text-right lg:table-cell">vs. 15 %</th>
            </tr></thead>
            <tbody>
              {d?.mensual.slice().reverse().map((m) => {
                const dif = m.beneficio - m.estimacion_15;
                return (
                  <tr key={m.mes} className={m.tickets ? "" : "text-tenue"}>
                    <td className="font-medium">{nombreMes(m.mes, true)}</td>
                    <td className="text-right tabular-nums">{euros(m.facturacion)}</td>
                    <td className="hidden text-right tabular-nums md:table-cell">{num(m.tickets)}</td>
                    <td className="hidden text-right tabular-nums md:table-cell">{m.tickets ? euros(m.ticket_medio) : "—"}</td>
                    <td className="hidden text-right tabular-nums text-rose-600 dark:text-rose-400 sm:table-cell">{m.mermas ? `−${euros(m.mermas)}` : "—"}</td>
                    <td className="text-right font-semibold tabular-nums">{euros(m.beneficio)}</td>
                    <td className="text-right">{m.tickets ? <Insignia color={colorMargen(m.margen)}>{pct(m.margen)}</Insignia> : "—"}</td>
                    <td className={`hidden text-right tabular-nums lg:table-cell ${dif >= 0 ? "text-marca-fuerte" : "text-rose-600 dark:text-rose-400"}`}>{m.tickets ? `${dif >= 0 ? "+" : "−"}${euros(Math.abs(dif))}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Tarjeta titulo="Qué días se vende más" subtitulo="Ventas de cada día de la semana en el periodo">
          {!d ? <Esqueleto className="h-56" /> : <GraficoBarras datos={d.semana.map((s) => ({ etiqueta: DIAS_SEMANA[s.dia]!, valor: s.facturacion, extra: s.tickets }))} />}
        </Tarjeta>
        <Tarjeta titulo="A qué horas" subtitulo="Ventas por hora del día en el periodo">
          {!d ? <Esqueleto className="h-56" /> : !d.horas.length ? <Vacio titulo="Sin ventas en este periodo" />
            : <GraficoBarras datos={d.horas.map((h) => ({ etiqueta: `${h.hora}h`, valor: h.facturacion, extra: h.tickets }))} />}
        </Tarjeta>
      </div>

      <div className="tarjeta mt-6">
        <div className="flex items-start justify-between gap-3 border-b border-borde p-5">
          <div>
            <h2 className="flex items-center gap-2 font-semibold"><Trash2 className="size-4 text-rose-500" /> Mermas del periodo</h2>
            <p className="text-sm text-suave">{d ? `Perdido a precio de coste: ${euros(d.actual.mermas)}` : "…"}</p>
          </div>
          <button className="boton-sec px-3 py-1.5" disabled={!enPeriodo.length} aria-label="Exportar mermas a CSV"
            onClick={() => descargarCsv("mermas", enPeriodo, [["fecha", "Fecha"], ["producto", "Producto"], ["cantidad", "Cantidad"], ["motivo", "Motivo"], ["usuario", "Usuario"], ["perdida", "Pérdida"]])}>
            <Download className="size-4" />
          </button>
        </div>
        {!mermas.datos ? <div className="p-5"><Esqueleto className="h-24" /></div> : !enPeriodo.length ? <Vacio titulo="Sin mermas en este periodo" /> : (
          <ul className="max-h-[360px] divide-y divide-borde overflow-y-auto">
            {enPeriodo.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0"><span className="font-medium">{m.producto}</span><span className="block text-xs text-tenue">{fecha(m.fecha)} · {cantidad(m.cantidad, m.unidad_medida)} · {MOTIVOS[m.motivo] ?? m.motivo}{m.usuario ? ` · ${m.usuario}` : ""}</span></span>
                <span className="shrink-0 font-semibold tabular-nums text-rose-600 dark:text-rose-400">−{euros(m.perdida)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** El paso de las ventas al beneficio, como el resumen financiero de una tienda online. */
function Cuenta({ r, cambio }: { r: Resumen; cambio: Record<string, number | null> }) {
  const filas: { nombre: string; valor: number; tipo?: "resta" | "total"; nota?: string; clave?: string }[] = [
    { nombre: "Ventas brutas", valor: r.ventas_brutas, nota: tickets(r.tickets), clave: "ventas_brutas" },
    { nombre: "Devoluciones", valor: r.devoluciones, tipo: "resta", nota: r.num_devoluciones ? `${r.num_devoluciones}` : undefined },
    { nombre: "Ventas netas", valor: r.ventas_netas, tipo: "total", clave: "ventas_netas" },
    { nombre: "Coste de lo vendido", valor: r.coste, tipo: "resta", nota: "precio de compra" },
    { nombre: "Mermas", valor: r.mermas, tipo: "resta", nota: "tirado o roto" },
    { nombre: "Beneficio real", valor: r.beneficio, tipo: "total", clave: "beneficio" },
  ];
  return (
    <dl className="text-sm">
      {filas.map((f) => {
        const t = f.clave ? cambio[f.clave] : null;
        return (
          <div key={f.nombre} className={`flex items-baseline justify-between gap-3 py-2.5 ${f.tipo === "total" ? "border-t border-borde font-semibold" : ""}`}>
            <dt className={f.tipo === "resta" ? "pl-3 text-suave" : ""}>
              {f.tipo === "resta" ? "− " : ""}{f.nombre}
              {f.nota && <span className="ml-1.5 text-xs font-normal text-tenue">{f.nota}</span>}
            </dt>
            <dd className="flex items-baseline gap-2 tabular-nums">
              {t != null && <span className={`text-xs font-semibold ${t >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{t >= 0 ? "▲" : "▼"} {num(Math.abs(t))} %</span>}
              <span className={f.tipo === "resta" && f.valor ? "text-rose-600 dark:text-rose-400" : ""}>{f.tipo === "resta" && f.valor ? "−" : ""}{euros(f.valor)}</span>
            </dd>
          </div>
        );
      })}
      <p className="mt-2 text-xs text-tenue">Margen real: <b className="text-texto">{pct(r.margen)}</b> sobre lo vendido. Compras y ventas, con IVA incluido.</p>
    </dl>
  );
}

function GraficoMeses({ meses }: { meses: Mes[] }) {
  const c = useColoresGrafico();
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={meses} margin={{ left: 0, right: 4, top: 8 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.rejilla} />
          <XAxis dataKey="mes" tickFormatter={(m: string) => nombreMes(m)} fontSize={12} stroke={c.ejes} tickLine={false} axisLine={false} minTickGap={8} />
          <YAxis width={52} fontSize={12} stroke={c.ejes} tickFormatter={eurosCorto} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: c.rejilla, opacity: 0.4 }}
            contentStyle={{ background: c.fondoTooltip, border: `1px solid ${c.bordeTooltip}`, borderRadius: 12, color: c.texto }}
            formatter={(v) => euros(Number(v))}
            labelFormatter={(m) => nombreMes(String(m), true)}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          <Bar dataKey="facturacion" name="Ventas" fill={c.secundario} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="beneficio" name="Beneficio" fill={c.linea} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function GraficoBarras({ datos, alto = "h-56" }: { datos: { etiqueta: string; valor: number; extra: number }[]; alto?: string }) {
  const c = useColoresGrafico();
  if (!datos.some((x) => x.valor)) return <Vacio titulo="Sin ventas en este periodo" />;
  return (
    <div className={alto}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} margin={{ left: 0, right: 4, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.rejilla} />
          <XAxis dataKey="etiqueta" fontSize={12} stroke={c.ejes} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis width={52} fontSize={12} stroke={c.ejes} tickFormatter={eurosCorto} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: c.rejilla, opacity: 0.4 }}
            contentStyle={{ background: c.fondoTooltip, border: `1px solid ${c.bordeTooltip}`, borderRadius: 12, color: c.texto }}
            formatter={(v, _n, item) => [`${euros(Number(v))} · ${tickets((item.payload as { extra: number }).extra)}`, "Ventas"]}
          />
          <Bar dataKey="valor" name="Ventas" fill={c.linea} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* =====================================================================
   Productos
   ===================================================================== */
type Orden = "unidades" | "facturacion" | "beneficio" | "margen" | "menos";
const ORDENES: { id: Orden; nombre: string; ayuda: string }[] = [
  { id: "unidades", nombre: "Más vendidos", ayuda: "Por unidades (o kilos) vendidas." },
  { id: "facturacion", nombre: "Más ventas", ayuda: "Por dinero cobrado, IVA incluido." },
  { id: "beneficio", nombre: "Más beneficio", ayuda: "Lo que de verdad dejan: lo cobrado menos lo que costaron." },
  { id: "margen", nombre: "Más rentables", ayuda: "Por margen: de cada euro cobrado, cuánto es beneficio. Solo los que tienen coste y se han vendido en 3 tickets o más." },
  { id: "menos", nombre: "Menos vendidos", ayuda: "Los que se han vendido algo, pero poco. Los que no se venden nada están en Género parado." },
];

function VistaProductos({ d }: { d: Estadisticas | null }) {
  const [orden, setOrden] = useState<Orden>("unidades");
  const parados = useDatos<Parado[]>("/informes/parados?dias=30");
  const ayuda = ORDENES.find((o) => o.id === orden)!.ayuda;

  const lista = useMemo(() => {
    const p = d?.productos ?? [];
    switch (orden) {
      case "unidades": return [...p].sort((a, b) => b.unidades - a.unidades);
      case "facturacion": return [...p].sort((a, b) => b.facturacion - a.facturacion);
      case "beneficio": return [...p].sort((a, b) => b.beneficio - a.beneficio);
      case "margen": return p.filter((x) => !x.sin_coste && x.tickets >= 3 && x.margen != null).sort((a, b) => b.margen! - a.margen!);
      case "menos": return p.filter((x) => x.activo && x.unidades > 0).sort((a, b) => a.unidades - b.unidades);
    }
  }, [d, orden]);
  const sinCoste = d?.productos.filter((p) => p.sin_coste).length ?? 0;
  // Sin coste, el beneficio sale inflado: no cuentan para "el que más deja"
  const mejor = d?.productos.filter((p) => !p.sin_coste && p.beneficio > 0).sort((a, b) => b.beneficio - a.beneficio)[0];

  const valor = (p: Producto) => (orden === "unidades" || orden === "menos" ? p.unidades : orden === "facturacion" ? p.facturacion : orden === "beneficio" ? p.beneficio : p.margen ?? 0);
  const texto = (p: Producto) => (orden === "unidades" || orden === "menos" ? cantidad(p.unidades, p.unidad_medida) : orden === "facturacion" ? euros(p.facturacion) : orden === "beneficio" ? euros(p.beneficio) : pct(p.margen));
  const detalle = (p: Producto) => (orden === "unidades" || orden === "menos" ? `${euros(p.facturacion)} · ${tickets(p.tickets)}`
    : orden === "facturacion" ? cantidad(p.unidades, p.unidad_medida)
    : orden === "beneficio" ? `margen ${pct(p.margen)}` : `${euros(p.beneficio)} de beneficio`);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {d ? (
          <>
            <Kpi titulo="Productos vendidos" valor={num(d.productos.filter((p) => p.unidades > 0).length)} detalle="distintos en el periodo" icono={<Package className="size-5" />} color="azul" />
            <Kpi titulo="Artículos por ticket" valor={num(d.actual.articulos_ticket, 1)} tendencia={d.cambio.articulos_ticket} detalle="vs. periodo anterior" icono={<ShoppingBasket className="size-5" />} />
            <Kpi titulo="El que más deja" valor={mejor?.producto ?? "—"} detalle={mejor ? `${euros(mejor.beneficio)} de beneficio` : "sin ventas con coste"} icono={<PiggyBank className="size-5" />} />
            <Kpi titulo="Devoluciones" valor={euros(d.actual.devoluciones)} tendencia={d.cambio.devoluciones == null ? null : -d.cambio.devoluciones} detalle={`${d.actual.num_devoluciones} en el periodo`} icono={<Receipt className="size-5" />} color="rojo" />
          </>
        ) : Array.from({ length: 4 }, (_, i) => <Esqueleto key={i} className="h-[132px]" />)}
      </div>

      <div className="tarjeta mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borde p-5">
          <div className="min-w-0">
            <h2 className="font-semibold">Ranking de productos</h2>
            <p className="text-sm text-suave">{ayuda}</p>
          </div>
          <button className="boton-sec px-3 py-1.5" disabled={!d?.productos.length} onClick={() => d && descargarCsv("estadisticas_productos", d.productos, [
            ["producto", "Producto"], ["categoria", "Categoría"], ["unidades", "Vendido"], ["tickets", "Tickets"], ["facturacion", "Ventas"],
            ["sin_iva", "Sin IVA"], ["coste", "Coste"], ["beneficio", "Beneficio"], ["margen", "Margen %"]])}>
            <Download className="size-4" /> CSV
          </button>
          <div className="w-full"><Pestañas<Orden> valor={orden} alCambiar={setOrden} opciones={ORDENES} /></div>
        </div>
        <div className="p-5">
          {!d ? <Esqueleto className="h-64" /> : !lista?.length ? <Vacio titulo={orden === "margen" ? "Aún no hay productos con coste y ventas suficientes" : "Sin ventas en este periodo"} />
            : <Ranking filas={lista.slice(0, 15)} valor={valor} texto={texto} detalle={detalle} numerado />}
          {d && sinCoste > 0 && (orden === "beneficio" || orden === "facturacion") && (
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {sinCoste} {sinCoste === 1 ? "producto se ha vendido" : "productos se han vendido"} sin coste conocido: su beneficio sale más alto de lo real. Ponles el precio de compra en Catálogo.
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Tarjeta titulo="Por categoría" subtitulo="Qué parte de las ventas es de cada categoría">
          {!d ? <Esqueleto className="h-56" /> : !d.categorias.length ? <Vacio titulo="Sin ventas en este periodo" /> : (
            <ul className="space-y-3.5">
              {d.categorias.map((c) => (
                <li key={c.categoria}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{c.categoria} <span className="text-xs font-normal text-tenue">{pct(c.peso)}</span></span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="font-semibold tabular-nums">{euros(c.facturacion)}</span>
                      <Insignia color={colorMargen(c.margen)}>{pct(c.margen)}</Insignia>
                    </span>
                  </div>
                  <Barra parte={c.facturacion} total={d.categorias[0]!.facturacion} />
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
        <div className="tarjeta">
          <div className="border-b border-borde p-5">
            <h2 className="flex items-center gap-2 font-semibold"><Hourglass className="size-4 text-amber-500" /> Género parado</h2>
            <p className="text-sm text-suave">Con stock y sin venderse en 30 días o más: dinero quieto en la estantería.</p>
          </div>
          {!parados.datos ? <div className="p-5"><Esqueleto className="h-32" /></div> : !parados.datos.length ? <Vacio titulo="Todo se mueve" /> : (
            <ul className="max-h-[360px] divide-y divide-borde overflow-y-auto">
              {parados.datos.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0"><span className="font-medium">{p.producto}</span><span className="block text-xs text-tenue">{cantidad(p.stock_actual, p.unidad_medida)} · {p.ultima_venta ? `última venta ${fecha(p.ultima_venta)}` : "nunca vendido"}</span></span>
                  <Insignia color={p.dias_sin_vender >= 90 ? "rojo" : "ambar"}>{p.dias_sin_vender} días</Insignia>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

/* =====================================================================
   Piezas
   ===================================================================== */
function Tarjeta({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <div className="tarjeta p-5">
      <h2 className="font-semibold">{titulo}</h2>
      {subtitulo && <p className="mb-4 text-sm text-suave">{subtitulo}</p>}
      {children}
    </div>
  );
}

function Barra({ parte, total }: { parte: number; total: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-superficie-2">
      <div className="h-full rounded-full bg-marca-500" style={{ width: `${total > 0 ? Math.max((Math.max(parte, 0) / total) * 100, parte > 0 ? 1.5 : 0) : 0}%` }} />
    </div>
  );
}

function Ranking({ filas, valor, texto, detalle, numerado = false }: {
  filas: Producto[]; valor: (p: Producto) => number; texto: (p: Producto) => string; detalle: (p: Producto) => string; numerado?: boolean;
}) {
  if (!filas.length) return <Vacio titulo="Sin ventas en este periodo" />;
  // La barra se mide contra el mayor de la lista (en "menos vendidos" no es el primero)
  const max = Math.max(...filas.map((p) => Math.abs(valor(p))), 0) || 1;
  return (
    <ol className="space-y-3">
      {filas.map((p, i) => (
        <li key={p.id} className="flex items-center gap-3">
          {numerado && <span className="w-5 shrink-0 text-right text-xs font-semibold text-tenue tabular-nums">{i + 1}</span>}
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-medium">{p.producto}</span>
                {p.sin_coste && <span className="ml-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">sin coste</span>}
                <span className="block truncate text-xs text-tenue">{p.categoria} · {detalle(p)}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{texto(p)}</span>
            </div>
            <Barra parte={valor(p)} total={max} />
          </div>
        </li>
      ))}
    </ol>
  );
}
