/** Estadísticas de un periodo, comparadas con el periodo anterior de la misma
 *  duración. Todo sale en una sola petición y en un solo lote a D1. */
import { Hono } from "hono";
import { type C, type Ctx, fallo, hoy, soloAdmin } from "./comun";

export const estadisticas = new Hono<Ctx>();
estadisticas.use("/estadisticas", soloAdmin);

const DIA = 86_400_000;
const aDia = (t: number) => new Date(t).toISOString().slice(0, 10);
const tiempo = (d: string) => Date.parse(`${d}T00:00:00Z`);
const masDias = (d: string, n: number) => aDia(tiempo(d) + n * DIA);
const euros = (cent: number | null | undefined) => Math.round(cent ?? 0) / 100;
/** Cambio en %, o null si antes no había nada con qué comparar. */
const cambio = (ahora: number, antes: number) => (antes ? Math.round(((ahora - antes) / Math.abs(antes)) * 1000) / 10 : null);
const pct = (parte: number, total: number) => (total ? Math.round((parte / total) * 1000) / 10 : null);

function fechaUrl(c: C, nombre: string, defecto: string) {
  const v = c.req.query(nombre) ?? defecto;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(tiempo(v)) || aDia(tiempo(v)) !== v) throw fallo(400, "Revisa las fechas");
  return v;
}

/** Meses entre dos días, ambos incluidos: ["2026-01", "2026-02", ...] */
function meses(desde: string, hasta: string) {
  const r: string[] = [];
  let [a, m] = desde.slice(0, 7).split("-").map(Number) as [number, number];
  while (`${a}-${String(m).padStart(2, "0")}` <= hasta.slice(0, 7)) {
    r.push(`${a}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; a++; }
  }
  return r;
}

type Fila = Record<string, number | string | null>;
const n = (f: Fila | undefined, k: string) => Number(f?.[k] ?? 0);

estadisticas.get("/estadisticas", async (c) => {
  const hoyEs = await hoy(c);
  const hasta = fechaUrl(c, "hasta", hoyEs);
  const desde = fechaUrl(c, "desde", masDias(hasta, -29));
  if (desde > hasta) throw fallo(400, "La fecha de inicio va después de la de fin");
  const dias = (tiempo(hasta) - tiempo(desde)) / DIA + 1;
  if (dias > 3700) throw fallo(400, "El periodo es demasiado largo: como mucho 10 años");

  // Con qué se compara: lo que pida la pantalla (el mismo mes del año pasado,
  // por ejemplo) o, si no, un periodo de la misma duración justo antes
  const antHasta = fechaUrl(c, "comparar_hasta", masDias(desde, -1));
  const antDesde = fechaUrl(c, "comparar_desde", masDias(antHasta, -(dias - 1)));
  if (antDesde > antHasta || antHasta >= desde) throw fallo(400, "El periodo con el que se compara tiene que ir antes");
  if ((tiempo(antHasta) - tiempo(antDesde)) / DIA + 1 > 3700) throw fallo(400, "El periodo es demasiado largo: como mucho 10 años");
  // Hasta mes y medio, día a día; si no, por meses (substr de 10 o de 7 letras)
  const porDia = dias <= 62;
  const largo = porDia ? 10 : 7;
  const fin = masDias(hasta, 1);
  const finAnt = masDias(antHasta, 1);
  // Los 12 últimos meses, para la tabla mensual
  const ultimoMes = hoyEs.slice(0, 7);
  const listaMeses = meses(masDias(`${ultimoMes}-01`, -340), hoyEs).slice(-12);
  const inicioMeses = `${listaMeses[0]}-01`;

  const db = c.env.DB;
  const q = (sql: string, ...p: unknown[]) => db.prepare(sql).bind(...p);
  const PAGOS = `
    SUM(CASE metodo_pago WHEN 'efectivo' THEN total_cent WHEN 'mixto' THEN total_cent - pago_tarjeta_cent - pago_bizum_cent - pago_fiado_cent ELSE 0 END) AS efectivo,
    SUM(CASE metodo_pago WHEN 'tarjeta' THEN total_cent WHEN 'mixto' THEN pago_tarjeta_cent ELSE 0 END) AS tarjeta,
    SUM(CASE metodo_pago WHEN 'bizum' THEN total_cent WHEN 'mixto' THEN pago_bizum_cent ELSE 0 END) AS bizum,
    SUM(CASE metodo_pago WHEN 'fiado' THEN total_cent WHEN 'mixto' THEN pago_fiado_cent ELSE 0 END) AS fiado`;
  const MERMA = "CAST(ROUND(SUM(cantidad_milli * coste_unitario_dm) / 100000.0) AS INTEGER)";

  const r = await db.batch([
    // 0. Por producto, en el periodo (las devoluciones restan)
    q(`SELECT d.producto_id, d.producto, d.categoria, p.unidad_medida, p.precio_libre, p.activo,
              SUM(d.cantidad_milli) AS unidades, SUM(d.importe) AS importe, SUM(d.base) AS base,
              SUM(d.coste) AS coste, SUM(d.beneficio) AS beneficio,
              COUNT(DISTINCT CASE WHEN d.cantidad_milli > 0 THEN d.venta_id END) AS tickets,
              SUM(CASE WHEN d.cantidad_milli > 0 AND d.coste = 0 THEN 1 ELSE 0 END) AS sin_coste
         FROM v_lineas_detalle d JOIN productos p ON p.id = d.producto_id
        WHERE d.fecha >= ?1 AND d.fecha < ?2
        GROUP BY d.producto_id`, desde, fin),
    // 1. Líneas por día o mes, de los dos periodos
    q(`SELECT substr(fecha, 1, ?3) AS k, SUM(importe) AS importe, SUM(base) AS base, SUM(coste) AS coste,
              SUM(beneficio) AS beneficio, SUM(cantidad_milli) AS unidades
         FROM v_lineas_detalle WHERE fecha >= ?1 AND fecha < ?2 AND (fecha >= ?4 OR fecha < ?5) GROUP BY k`, antDesde, fin, largo, desde, finAnt),
    // 2. Tickets y formas de pago por día o mes, de los dos periodos
    q(`SELECT substr(fecha, 1, ?3) AS k, COUNT(*) AS tickets, SUM(total_cent) AS bruto, ${PAGOS}
         FROM ventas WHERE fecha >= ?1 AND fecha < ?2 AND (fecha >= ?4 OR fecha < ?5) GROUP BY k`, antDesde, fin, largo, desde, finAnt),
    // 3. Devoluciones
    q(`SELECT substr(fecha, 1, ?3) AS k, COUNT(*) AS n, SUM(importe_cent) AS importe
         FROM devoluciones WHERE fecha >= ?1 AND fecha < ?2 AND (fecha >= ?4 OR fecha < ?5) GROUP BY k`, antDesde, fin, largo, desde, finAnt),
    // 4. Mermas, a precio de coste
    q(`SELECT substr(fecha, 1, ?3) AS k, ${MERMA} AS perdida FROM mermas WHERE fecha >= ?1 AND fecha < ?2 AND (fecha >= ?4 OR fecha < ?5) GROUP BY k`,
      antDesde, fin, largo, desde, finAnt),
    // 5. Día de la semana (0 = domingo) y hora, del periodo
    q(`SELECT CAST(strftime('%w', fecha) AS INTEGER) AS dia, CAST(substr(fecha, 12, 2) AS INTEGER) AS hora,
              COUNT(*) AS tickets, SUM(total_cent) AS bruto
         FROM ventas WHERE fecha >= ?1 AND fecha < ?2 GROUP BY dia, hora`, desde, fin),
    // 6 a 8. Los últimos 12 meses
    q(`SELECT substr(fecha, 1, 7) AS k, SUM(importe) AS importe, SUM(base) AS base, SUM(coste) AS coste, SUM(beneficio) AS beneficio
         FROM v_lineas_detalle WHERE fecha >= ?1 GROUP BY k`, inicioMeses),
    q(`SELECT substr(fecha, 1, 7) AS k, COUNT(*) AS tickets FROM ventas WHERE fecha >= ?1 GROUP BY k`, inicioMeses),
    q(`SELECT substr(fecha, 1, 7) AS k, ${MERMA} AS perdida FROM mermas WHERE fecha >= ?1 GROUP BY k`, inicioMeses),
    // 9. Lo que deben los clientes ahora, y la primera venta (para "desde siempre")
    q(`SELECT (SELECT SUM(deuda) FROM v_clientes) AS fiado, (SELECT MIN(fecha) FROM ventas) AS primera`),
    // 10 a 13. Totales exactos de cada periodo (p = 1 el actual, 0 el anterior)
    q(`SELECT CASE WHEN fecha >= ?3 THEN 1 ELSE 0 END AS p, COUNT(*) AS tickets, SUM(total_cent) AS bruto, ${PAGOS}
         FROM ventas WHERE fecha >= ?1 AND fecha < ?2 AND (fecha >= ?3 OR fecha < ?4) GROUP BY p`, antDesde, fin, desde, finAnt),
    q(`SELECT CASE WHEN fecha >= ?3 THEN 1 ELSE 0 END AS p, SUM(importe) AS importe, SUM(base) AS base, SUM(coste) AS coste,
              SUM(beneficio) AS beneficio, SUM(cantidad_milli) AS unidades
         FROM v_lineas_detalle WHERE fecha >= ?1 AND fecha < ?2 AND (fecha >= ?3 OR fecha < ?4) GROUP BY p`, antDesde, fin, desde, finAnt),
    q(`SELECT CASE WHEN fecha >= ?3 THEN 1 ELSE 0 END AS p, COUNT(*) AS n, SUM(importe_cent) AS importe FROM devoluciones
        WHERE fecha >= ?1 AND fecha < ?2 AND (fecha >= ?3 OR fecha < ?4) GROUP BY p`, antDesde, fin, desde, finAnt),
    q(`SELECT CASE WHEN fecha >= ?3 THEN 1 ELSE 0 END AS p, ${MERMA} AS perdida FROM mermas WHERE fecha >= ?1 AND fecha < ?2 AND (fecha >= ?3 OR fecha < ?4) GROUP BY p`, antDesde, fin, desde, finAnt),
  ]);
  const [prod, lin, ven, dev, mer, horas, mLin, mVen, mMer, extra, tVen, tLin, tDev, tMer] = r.map((x) => (x.results ?? []) as Fila[]);

  const indice = (lista: Fila[]) => new Map(lista.map((f) => [String(f.k), f]));
  const iLin = indice(lin!), iVen = indice(ven!), iDev = indice(dev!), iMer = indice(mer!);

  // Claves de cada punto de la serie, en los dos periodos, emparejadas por posición
  const claves = (a: string, b: string) => porDia
    ? Array.from({ length: (tiempo(b) - tiempo(a)) / DIA + 1 }, (_, i) => masDias(a, i))
    : meses(a, b);
  const kAct = claves(desde, hasta), kAnt = claves(antDesde, antHasta);

  function resumen(a: string, b: string, p: 0 | 1) {
    const de = (l: Fila[]) => l.find((f) => n(f, "p") === p);
    const v = de(tVen!), l = de(tLin!), d = de(tDev!), m = de(tMer!);
    const bruto = n(v, "bruto"), tickets = n(v, "tickets"), devoluciones = n(d, "importe");
    const importe = n(l, "importe"), base = n(l, "base"), beneficio = n(l, "beneficio"), mermas = n(m, "perdida");
    const neto = bruto - devoluciones;
    return {
      desde: a, hasta: b,
      ventas_brutas: euros(bruto), devoluciones: euros(devoluciones), num_devoluciones: n(d, "n"), ventas_netas: euros(neto),
      sin_iva: euros(base), iva: euros(importe - base), coste: euros(n(l, "coste")),
      beneficio_bruto: euros(beneficio), mermas: euros(mermas), beneficio: euros(beneficio - mermas),
      margen: pct(beneficio - mermas, base),
      tickets, ticket_medio: tickets ? euros(neto / tickets) : 0,
      articulos_ticket: tickets ? Math.round((n(l, "unidades") / 1000 / tickets) * 10) / 10 : 0,
      pagos: { efectivo: euros(n(v, "efectivo")), tarjeta: euros(n(v, "tarjeta")), bizum: euros(n(v, "bizum")), fiado: euros(n(v, "fiado")) },
    };
  }
  const actual = resumen(desde, hasta, 1);
  const anterior = resumen(antDesde, antHasta, 0);

  const punto = (k: string | undefined) => {
    if (!k) return { facturacion: null, beneficio: null, tickets: null };
    const v = iVen.get(k), d = iDev.get(k), l = iLin.get(k), m = iMer.get(k);
    return { facturacion: euros(n(v, "bruto") - n(d, "importe")), beneficio: euros(n(l, "beneficio") - n(m, "perdida")), tickets: n(v, "tickets") };
  };
  const serie = kAct.map((k, i) => {
    const a = punto(k), b = punto(kAnt[i]);
    return { clave: k, clave_anterior: kAnt[i] ?? null, ...a, facturacion_anterior: b.facturacion, beneficio_anterior: b.beneficio, tickets_anterior: b.tickets };
  });

  // Semana empezando en lunes
  const semana = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ dia: d, tickets: 0, facturacion: 0 }));
  const porHora = new Map<number, { hora: number; tickets: number; facturacion: number }>();
  for (const f of horas!) {
    const s = semana.find((x) => x.dia === n(f, "dia"))!;
    s.tickets += n(f, "tickets"); s.facturacion += n(f, "bruto");
    const h = porHora.get(n(f, "hora")) ?? { hora: n(f, "hora"), tickets: 0, facturacion: 0 };
    h.tickets += n(f, "tickets"); h.facturacion += n(f, "bruto");
    porHora.set(h.hora, h);
  }
  const horasConVenta = [...porHora.keys()];
  const listaHoras = horasConVenta.length
    ? Array.from({ length: Math.max(...horasConVenta) - Math.min(...horasConVenta) + 1 }, (_, i) => Math.min(...horasConVenta) + i)
      .map((h) => ({ ...(porHora.get(h) ?? { hora: h, tickets: 0, facturacion: 0 }) }))
    : [];

  const productos = prod!.map((f) => ({
    id: n(f, "producto_id"), producto: String(f.producto), categoria: String(f.categoria), unidad_medida: String(f.unidad_medida),
    activo: !!n(f, "activo"), precio_libre: !!n(f, "precio_libre"),
    unidades: n(f, "unidades") / 1000, facturacion: euros(n(f, "importe")), sin_iva: euros(n(f, "base")),
    coste: euros(n(f, "coste")), beneficio: euros(n(f, "beneficio")), margen: pct(n(f, "beneficio"), n(f, "base")),
    tickets: n(f, "tickets"),
    // Si alguna venta salió sin coste conocido, su beneficio está inflado
    sin_coste: n(f, "sin_coste") > 0,
  }));
  const cat = new Map<string, { categoria: string; facturacion: number; sin_iva: number; beneficio: number; unidades: number; productos: number }>();
  for (const p of productos) {
    const x = cat.get(p.categoria) ?? { categoria: p.categoria, facturacion: 0, sin_iva: 0, beneficio: 0, unidades: 0, productos: 0 };
    x.facturacion += p.facturacion; x.sin_iva += p.sin_iva; x.beneficio += p.beneficio; x.unidades += p.unidades; x.productos++;
    cat.set(p.categoria, x);
  }
  const categorias = [...cat.values()]
    .map((x) => ({ ...x, facturacion: Math.round(x.facturacion * 100) / 100, beneficio: Math.round(x.beneficio * 100) / 100, margen: pct(x.beneficio, x.sin_iva), peso: pct(x.facturacion, actual.ventas_netas) }))
    .sort((a, b) => b.facturacion - a.facturacion);

  const iML = indice(mLin!), iMV = indice(mVen!), iMM = indice(mMer!);
  const mensual = listaMeses.map((k) => {
    const l = iML.get(k), t = n(iMV.get(k), "tickets"), perdida = n(iMM.get(k), "perdida");
    const beneficio = n(l, "beneficio") - perdida;
    return {
      mes: k, facturacion: euros(n(l, "importe")), sin_iva: euros(n(l, "base")), coste: euros(n(l, "coste")),
      mermas: euros(perdida), beneficio: euros(beneficio), margen: pct(beneficio, n(l, "base")),
      tickets: t, ticket_medio: t ? euros(n(l, "importe") / t) : 0, estimacion_15: euros(n(l, "importe") * 0.15),
    };
  });

  const comparar = Object.fromEntries((["ventas_brutas", "devoluciones", "ventas_netas", "beneficio", "margen", "tickets", "ticket_medio", "articulos_ticket", "mermas", "iva"] as const)
    .map((k) => [k, k === "margen" ? (actual.margen != null && anterior.margen != null ? Math.round((actual.margen - anterior.margen) * 10) / 10 : null) : cambio(actual[k], anterior[k])]));

  return c.json({
    desde, hasta, dias, agrupado: porDia ? "dia" : "mes",
    actual, anterior, cambio: comparar, serie,
    semana: semana.map((s) => ({ ...s, facturacion: euros(s.facturacion) })),
    horas: listaHoras.map((h) => ({ ...h, facturacion: euros(h.facturacion) })),
    productos, categorias, mensual,
    fiado_pendiente: Math.round(n(extra![0], "fiado") * 100) / 100,
    primera_venta: extra![0]?.primera ? String(extra![0].primera).slice(0, 10) : null,
  });
});
