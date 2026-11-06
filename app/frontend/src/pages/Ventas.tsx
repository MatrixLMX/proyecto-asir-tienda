import { useEffect, useState, type FormEvent } from "react";
import { Ban, Banknote, CreditCard, Download, HandCoins, Lock, Printer, Receipt, Share2, Smartphone, Undo2, Wallet } from "lucide-react";
import { borrar, cantidad, descargarCsv, diaISO, euros, fecha, fechaHora, post, textoPago, type Venta } from "../api";
import type { PropsPagina } from "../App";
import { compartirTicket, imprimirTicket } from "../ticket";
import { Cabecera, CampoNumero, Confirmar, Esqueleto, Insignia, Kpi, Modal, Pestañas, Vacio, emitirCambio, useAviso, useDatos } from "../ui";

type Metodo = Venta["metodo_pago"];
interface ListaVentas { tickets: number; total: number; pagina: number; por_pagina: number; ventas: (Omit<Venta, "lineas"> & { lineas: number })[] }
interface Cierre {
  fecha: string; tickets: number; total_efectivo: number; total_tarjeta: number; total_bizum: number;
  fondo_inicial: number; efectivo_contado: number; diferencia: number; usuario: string | null; notas: string | null;
}
interface Caja { dia: string; tickets: number; total_efectivo: number; total_tarjeta: number; total_bizum: number; total_fiado: number; cobros_fiado: number; total: number; cierre: Cierre | null }

const METODOS: Record<Metodo, { nombre: string; icono: typeof Banknote }> = {
  efectivo: { nombre: "Efectivo", icono: Banknote },
  tarjeta: { nombre: "Tarjeta", icono: CreditCard },
  bizum: { nombre: "Bizum", icono: Smartphone },
  fiado: { nombre: "Fiado", icono: HandCoins },
  mixto: { nombre: "Mixto", icono: Wallet },
};

export default function Ventas({ usuario }: PropsPagina) {
  const [vista, setVista] = useState<"tickets" | "caja">("tickets");
  return (
    <>
      <Cabecera titulo="Ventas" subtitulo="Tickets de cualquier día y cierre de caja">
        <Pestañas valor={vista} alCambiar={setVista} opciones={[{ id: "tickets", nombre: "Tickets" }, { id: "caja", nombre: "Cierre de caja" }]} />
      </Cabecera>
      {vista === "tickets" ? <Tickets esAdmin={usuario.rol === "admin"} /> : <CierreCaja />}
    </>
  );
}

/* =====================================================================
   Historial de tickets
   ===================================================================== */
const RANGOS = [
  { id: "hoy", nombre: "Hoy", desde: 0, hasta: 0 },
  { id: "ayer", nombre: "Ayer", desde: -1, hasta: -1 },
  { id: "7", nombre: "7 días", desde: -6, hasta: 0 },
  { id: "30", nombre: "30 días", desde: -29, hasta: 0 },
] as const;

function Tickets({ esAdmin }: { esAdmin: boolean }) {
  const avisar = useAviso();
  const [desde, setDesde] = useState(diaISO());
  const [hasta, setHasta] = useState(diaISO());
  const [metodo, setMetodo] = useState<Metodo | "">("");
  const [pagina, setPagina] = useState(1);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [anular, setAnular] = useState<Venta | null>(null);
  const [devolver, setDevolver] = useState<Venta | null>(null);

  const ruta = `/ventas?desde=${desde}&hasta=${hasta}&pagina=${pagina}${metodo ? `&metodo=${metodo}` : ""}`;
  const { datos } = useDatos<ListaVentas>(ruta);
  const detalle = useDatos<Venta>(abierta ? `/ventas/${abierta}` : null, false);
  const paginas = datos ? Math.max(1, Math.ceil(datos.tickets / datos.por_pagina)) : 1;

  const elegirRango = (d: number, h: number) => { setDesde(diaISO(d)); setHasta(diaISO(h)); setPagina(1); };
  const rangoActivo = RANGOS.find((r) => diaISO(r.desde) === desde && diaISO(r.hasta) === hasta)?.id;

  async function confirmarAnulacion(v: Venta) {
    try {
      await borrar(`/ventas/${v.id}`);
      avisar("ok", `Ticket nº ${v.id} anulado. El stock se ha devuelto.`);
      setAbierta(null);
      emitirCambio();
    } catch (e) {
      avisar("error", (e as Error).message);
    }
  }

  const imprimir = (id: number) => imprimirTicket(id).catch((e) => avisar("error", e.message));
  const compartir = (id: number) => compartirTicket(id)
    .then((r) => { if (r === "copiado") avisar("ok", "Ticket copiado: pégalo donde quieras enviarlo"); })
    .catch((e) => avisar("error", e.message));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          {RANGOS.map((r) => (
            <button key={r.id} onClick={() => elegirRango(r.desde, r.hasta)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${rangoActivo === r.id ? "border-marca-600 bg-marca-600 text-white" : "border-borde bg-superficie text-suave hover:border-marca-500"}`}>
              {r.nombre}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div><label className="etiqueta" htmlFor="desde">Desde</label><input id="desde" type="date" className="campo py-1.5" value={desde} max={hasta} onChange={(e) => { setDesde(e.target.value); setPagina(1); }} /></div>
          <div><label className="etiqueta" htmlFor="hasta">Hasta</label><input id="hasta" type="date" className="campo py-1.5" value={hasta} min={desde} max={diaISO()} onChange={(e) => { setHasta(e.target.value); setPagina(1); }} /></div>
        </div>
        <select className="campo w-auto py-1.5" aria-label="Forma de pago" value={metodo} onChange={(e) => { setMetodo(e.target.value as Metodo | ""); setPagina(1); }}>
          <option value="">Todas las formas de pago</option>
          {Object.entries(METODOS).map(([id, m]) => <option key={id} value={id}>{id === "mixto" ? "Solo pagos mixtos" : `Con ${m.nombre.toLowerCase()} (también mixtos)`}</option>)}
        </select>
        <button className="boton-sec ml-auto py-1.5" disabled={!datos?.ventas.length}
          onClick={() => datos && descargarCsv(`tickets_${desde}_${hasta}`, datos.ventas, [["id", "Ticket"], ["fecha", "Fecha"], ["metodo_pago", "Pago"], ["pago_tarjeta", "Tarjeta (mixto)"], ["pago_bizum", "Bizum (mixto)"], ["pago_fiado", "Fiado"], ["cliente", "Cliente"], ["devuelto", "Devuelto"], ["lineas", "Líneas"], ["usuario", "Usuario"], ["total", "Total"]])}>
          <Download className="size-4" /> CSV
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="tarjeta p-4"><p className="text-xs text-suave">Tickets</p><p className="text-xl font-bold tabular-nums">{datos?.tickets ?? "…"}</p></div>
        <div className="tarjeta p-4"><p className="text-xs text-suave">Total vendido</p><p className="text-xl font-bold tabular-nums">{datos ? euros(datos.total) : "…"}</p></div>
      </div>

      <div className="tarjeta overflow-x-auto">
        {!datos ? (
          <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, i) => <Esqueleto key={i} className="h-10" />)}</div>
        ) : !datos.ventas.length ? (
          <Vacio icono={<Receipt className="size-6" />} titulo="No hay tickets">Prueba con otras fechas</Vacio>
        ) : (
          <table className="tabla w-full text-sm">
            <thead><tr><th>Nº</th><th>Fecha</th><th>Pago</th><th className="hidden sm:table-cell">Líneas</th><th className="hidden md:table-cell">Vendió</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {datos.ventas.map((v) => {
                const M = METODOS[v.metodo_pago];
                return (
                  <tr key={v.id} className="cursor-pointer hover:bg-superficie-2/60" onClick={() => setAbierta(v.id)}>
                    <td className="font-medium tabular-nums">{v.id}</td>
                    <td className="text-suave">{fechaHora(v.fecha)}</td>
                    <td><span className="inline-flex items-center gap-1.5 text-suave" title={textoPago(v)}><M.icono className="size-4" />{M.nombre}</span></td>
                    <td className="hidden tabular-nums text-suave sm:table-cell">{v.lineas}</td>
                    <td className="hidden text-suave md:table-cell">{v.usuario ?? "—"}</td>
                    <td className="text-right font-semibold tabular-nums">{euros(v.total)}{v.devuelto > 0 && <span className="block text-xs font-medium text-rose-600 dark:text-rose-400">−{euros(v.devuelto)}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {paginas > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="boton-sec py-1.5" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
          <span className="text-suave">Página {pagina} de {paginas}</span>
          <button className="boton-sec py-1.5" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</button>
        </div>
      )}

      <Modal abierto={abierta != null} alCerrar={() => setAbierta(null)} titulo={`Ticket nº ${abierta ?? ""}`}>
        {!detalle.datos || detalle.datos.id !== abierta ? <Esqueleto className="h-40" /> : (
          <>
            <p className="mb-3 text-sm text-suave">
              {fechaHora(detalle.datos.fecha)} · {textoPago(detalle.datos)}{detalle.datos.cliente ? ` · ${detalle.datos.cliente}` : ""} · {detalle.datos.usuario ?? "—"}
            </p>
            <ul className="mb-4 max-h-[45vh] divide-y divide-borde overflow-y-auto rounded-xl border border-borde">
              {detalle.datos.lineas?.map((l, i) => (
                <li key={i} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                  <span><span className="font-medium">{l.producto}</span><span className="block text-xs text-tenue">{cantidad(l.cantidad, l.unidad_medida)} × {euros(l.precio_unitario)} · IVA {l.iva_porcentaje} %</span>{l.devuelto > 0 && <span className="block text-xs font-medium text-rose-600 dark:text-rose-400">Devuelto: {cantidad(l.devuelto, l.unidad_medida)}</span>}</span>
                  <span className="font-semibold tabular-nums">{euros(l.importe)}</span>
                </li>
              ))}
            </ul>
            <div className="mb-5 flex items-baseline justify-between"><span className="text-suave">Total</span><span className="text-2xl font-bold tabular-nums">{euros(detalle.datos.total)}</span></div>
            {detalle.datos.devuelto > 0 && <p className="-mt-3 mb-5 text-right text-sm font-medium text-rose-600 dark:text-rose-400">Devuelto {euros(detalle.datos.devuelto)}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              {esAdmin && !detalle.datos.devuelto && (
                <button className="boton-sec text-rose-600 dark:text-rose-400" onClick={() => setAnular(detalle.datos)}>
                  <Ban className="size-4" /> Anular
                </button>
              )}
              {detalle.datos.lineas?.some((l) => l.devuelto < l.cantidad) && (
                <button className="boton-sec" onClick={() => setDevolver(detalle.datos)}><Undo2 className="size-4" /> Devolver</button>
              )}
              <button className="boton-sec" onClick={() => compartir(detalle.datos!.id)}><Share2 className="size-4" /> Compartir</button>
              <button className="boton" onClick={() => imprimir(detalle.datos!.id)}><Printer className="size-4" /> Imprimir</button>
            </div>
          </>
        )}
      </Modal>

      <Confirmar
        abierto={!!anular} alCerrar={() => setAnular(null)} alConfirmar={() => anular && confirmarAnulacion(anular)}
        titulo="Anular ticket" textoBoton="Anular ticket" peligro
        mensaje={anular && <>Se anulará el ticket nº <b>{anular.id}</b> de <b>{euros(anular.total)}</b>. Los productos vuelven al stock y queda apuntado en el registro de cambios. Si hay que devolver dinero al cliente, hazlo en caja.</>}
      />
      <Devolver venta={devolver} alCerrar={() => setDevolver(null)} alTerminar={() => { setDevolver(null); detalle.recargar(); emitirCambio(); }} />
    </>
  );
}

/* =====================================================================
   Devolución de parte de un ticket
   ===================================================================== */
const FORMAS_DEVOLUCION = [
  { id: "efectivo", nombre: "Efectivo" }, { id: "tarjeta", nombre: "Tarjeta" }, { id: "bizum", nombre: "Bizum" }, { id: "fiado", nombre: "Rebajar deuda" },
] as const;

function Devolver({ venta, alCerrar, alTerminar }: { venta: Venta | null; alCerrar: () => void; alTerminar: () => void }) {
  const avisar = useAviso();
  const [cantidades, setCantidades] = useState<Record<number, number | null>>({});
  const [rotas, setRotas] = useState<Record<number, boolean>>({});
  const [metodo, setMetodo] = useState<(typeof FORMAS_DEVOLUCION)[number]["id"]>("efectivo");
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setCantidades({}); setRotas({}); setNotas("");
    setMetodo(venta?.pago_fiado ? "fiado" : venta?.metodo_pago === "tarjeta" || venta?.metodo_pago === "bizum" ? venta.metodo_pago : "efectivo");
  }, [venta]);

  const lineas = venta?.lineas?.filter((l) => l.devuelto < l.cantidad) ?? [];
  const elegidas = lineas.filter((l) => (cantidades[l.linea_id] ?? 0) > 0);
  const excede = elegidas.some((l) => cantidades[l.linea_id]! > Math.round((l.cantidad - l.devuelto) * 1000) / 1000);
  const aprox = elegidas.reduce((s, l) => s + cantidades[l.linea_id]! * l.precio_unitario, 0);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!venta) return;
    setEnviando(true);
    try {
      const r = await post<{ importe: number }>(`/ventas/${venta.id}/devolucion`, {
        metodo, notas: notas || null,
        lineas: elegidas.map((l) => ({ linea_id: l.linea_id, cantidad: cantidades[l.linea_id], repuesto: !rotas[l.linea_id] })),
      });
      avisar("ok", metodo === "fiado" ? `Deuda rebajada en ${euros(r.importe)}` : `Devuelve ${euros(r.importe)} en ${metodo}`);
      alTerminar();
    } catch (err) { avisar("error", (err as Error).message); } finally { setEnviando(false); }
  }

  return (
    <Modal abierto={!!venta} alCerrar={alCerrar} titulo={`Devolver del ticket nº ${venta?.id ?? ""}`} ancho="max-w-lg">
      <form onSubmit={enviar} className="space-y-4">
        <ul className="max-h-[42vh] divide-y divide-borde overflow-y-auto rounded-xl border border-borde">
          {lineas.map((l) => {
            const queda = Math.round((l.cantidad - l.devuelto) * 1000) / 1000;
            const n = cantidades[l.linea_id] ?? null;
            return (
              <li key={l.linea_id} className="space-y-2 px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0"><span className="block font-medium">{l.producto}</span><span className="block text-xs text-tenue">Se puede devolver: {cantidad(queda, l.unidad_medida)} a {euros(l.precio_unitario)}</span></span>
                  <CampoNumero aria-label={`Cantidad de ${l.producto}`} className={`campo w-20 shrink-0 py-1.5 text-center ${n && n > queda ? "border-rose-500" : ""}`} decimales={l.unidad_medida === "kg" ? 3 : 0} placeholder="0" valor={n} alCambiar={(v) => setCantidades((c) => ({ ...c, [l.linea_id]: v }))} />
                </div>
                {!!n && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-suave">
                    <input type="checkbox" className="size-4 accent-emerald-600" checked={!rotas[l.linea_id]} onChange={(e) => setRotas((r) => ({ ...r, [l.linea_id]: !e.target.checked }))} />
                    Vuelve a la estantería (desmárcalo si está roto o abierto)
                  </label>
                )}
              </li>
            );
          })}
        </ul>
        <div>
          <span className="etiqueta">Cómo se devuelve</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FORMAS_DEVOLUCION.filter((f) => f.id !== "fiado" || venta?.pago_fiado).map((f) => (
              <button type="button" key={f.id} onClick={() => setMetodo(f.id)} className={`rounded-xl border py-2 text-sm ${metodo === f.id ? "border-marca-500 bg-marca-suave font-medium text-marca-fuerte" : "border-borde text-suave"}`}>{f.nombre}</button>
            ))}
          </div>
        </div>
        <div><label className="etiqueta" htmlFor="dev-notas">Motivo (opcional)</label><input id="dev-notas" className="campo" maxLength={255} value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-suave">{elegidas.length > 0 && <>Unos <b className="text-texto">{euros(aprox)}</b></>}</p>
          <div className="flex gap-2">
            <button type="button" className="boton-sec" onClick={alCerrar}>Cancelar</button>
            <button className="boton" disabled={!elegidas.length || excede || enviando}><Undo2 className="size-4" /> Devolver</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* =====================================================================
   Cierre de caja
   ===================================================================== */
const CLAVE_FONDO = "tienda_fondo_caja";
const leerFondo = () => { try { return localStorage.getItem(CLAVE_FONDO) ?? ""; } catch { return ""; } };
const numero = (t: string) => Number(t.replace(",", ".")) || 0;

function CierreCaja() {
  const avisar = useAviso();
  const [dia, setDia] = useState(diaISO());
  const caja = useDatos<Caja>(`/caja?dia=${dia}`);
  const historial = useDatos<Cierre[]>("/caja/cierres");
  const [fondo, setFondo] = useState(leerFondo);
  const [contado, setContado] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);

  const c = caja.datos;
  const esperado = c ? numero(fondo) + c.total_efectivo : 0;
  const diferencia = contado ? Math.round((numero(contado) - esperado) * 100) / 100 : null;

  async function cerrar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      try { localStorage.setItem(CLAVE_FONDO, fondo); } catch { /* sin almacenamiento */ }
      await post("/caja/cierre", { fecha: dia, fondo_inicial: numero(fondo), efectivo_contado: numero(contado), notas: notas || null });
      avisar("ok", "Caja cerrada");
      setContado("");
      setNotas("");
      emitirCambio();
    } catch (e) {
      avisar("error", (e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const colorDif = (d: number) => (Math.abs(d) < 0.01 ? "verde" : Math.abs(d) <= 2 ? "ambar" : "rojo");
  const textoDif = (d: number) => (Math.abs(d) < 0.01 ? "cuadra" : `${d > 0 ? "sobran" : "faltan"} ${euros(Math.abs(d))}`);

  return (
    <>
      <div className="mb-4 flex items-end gap-3">
        <div><label className="etiqueta" htmlFor="dia">Día</label><input id="dia" type="date" className="campo py-1.5" value={dia} max={diaISO()} onChange={(e) => setDia(e.target.value)} /></div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {c ? (
          <>
            <Kpi titulo="Tickets" valor={String(c.tickets)} detalle={`total ${euros(c.total)}`} icono={<Receipt className="size-5" />} color="azul" />
            <Kpi titulo="Efectivo" valor={euros(c.total_efectivo)} icono={<Banknote className="size-5" />} />
            <Kpi titulo="Tarjeta" valor={euros(c.total_tarjeta)} icono={<CreditCard className="size-5" />} color="azul" />
            <Kpi titulo="Bizum" valor={euros(c.total_bizum)} icono={<Smartphone className="size-5" />} color="ambar" />
          </>
        ) : Array.from({ length: 4 }, (_, i) => <Esqueleto key={i} className="h-[132px]" />)}
      </div>

      {c && (c.total_fiado !== 0 || c.cobros_fiado !== 0) && (
        <p className="mt-3 text-sm text-suave">
          <HandCoins className="mr-1.5 inline size-4 align-text-bottom text-tenue" />
          Vendido a fiado: <b className="text-texto tabular-nums">{euros(c.total_fiado)}</b> (no entra en caja) · Cobrado de fiados: <b className="text-texto tabular-nums">{euros(c.cobros_fiado)}</b> (ya sumado arriba)
        </p>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[400px_1fr]">
        <div className="tarjeta h-fit p-5">
          <h2 className="mb-4 flex items-center gap-2 font-semibold"><Wallet className="size-5 text-marca-500" /> Cuadrar la caja</h2>
          {!c ? <Esqueleto className="h-48" /> : c.cierre ? (
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2 font-medium"><Lock className="size-4 text-tenue" /> Caja cerrada por {c.cierre.usuario ?? "—"}</p>
              <div className="flex justify-between"><span className="text-suave">Fondo inicial</span><span className="tabular-nums">{euros(c.cierre.fondo_inicial)}</span></div>
              <div className="flex justify-between"><span className="text-suave">Efectivo contado</span><span className="tabular-nums">{euros(c.cierre.efectivo_contado)}</span></div>
              <div className="flex justify-between"><span className="text-suave">Diferencia</span><Insignia color={colorDif(c.cierre.diferencia)}>{textoDif(c.cierre.diferencia)}</Insignia></div>
              {c.cierre.notas && <p className="rounded-xl bg-superficie-2 px-3 py-2 text-suave">{c.cierre.notas}</p>}
            </div>
          ) : (
            <form onSubmit={cerrar} className="space-y-4">
              <div>
                <label className="etiqueta" htmlFor="fondo">Fondo con el que se abrió la caja</label>
                <input id="fondo" className="campo" inputMode="decimal" placeholder="0,00" value={fondo} onChange={(e) => setFondo(e.target.value)} />
              </div>
              <div className="flex justify-between rounded-xl bg-superficie-2 px-4 py-3 text-sm">
                <span className="text-suave">Debería haber en efectivo</span><b className="tabular-nums">{euros(esperado)}</b>
              </div>
              <div>
                <label className="etiqueta" htmlFor="contado">Efectivo contado ahora</label>
                <input id="contado" className="campo text-lg" inputMode="decimal" placeholder="0,00" required value={contado} onChange={(e) => setContado(e.target.value)} />
              </div>
              {diferencia != null && (
                <p className="flex items-center justify-between text-sm"><span className="text-suave">Resultado</span><Insignia color={colorDif(diferencia)}>{textoDif(diferencia)}</Insignia></p>
              )}
              <div><label className="etiqueta" htmlFor="notas">Notas (opcional)</label><input id="notas" className="campo" maxLength={255} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="p. ej. se pagó al repartidor en efectivo" /></div>
              <button className="boton w-full py-3" disabled={guardando || !contado}><Lock className="size-4" /> Cerrar caja del {fecha(dia)}</button>
            </form>
          )}
        </div>

        <div className="tarjeta overflow-x-auto">
          <h2 className="border-b border-borde p-5 font-semibold">Cierres anteriores</h2>
          {!historial.datos ? <div className="p-5"><Esqueleto className="h-32" /></div> : !historial.datos.length ? (
            <Vacio icono={<Wallet className="size-6" />} titulo="Aún no hay cierres" />
          ) : (
            <table className="tabla w-full text-sm">
              <thead><tr><th>Día</th><th className="text-right">Tickets</th><th className="text-right">Efectivo</th><th className="hidden text-right sm:table-cell">Tarjeta + Bizum</th><th className="text-right">Diferencia</th></tr></thead>
              <tbody>
                {historial.datos.map((h) => (
                  <tr key={h.fecha}>
                    <td className="font-medium">{fecha(h.fecha)}</td>
                    <td className="text-right tabular-nums">{h.tickets}</td>
                    <td className="text-right tabular-nums">{euros(h.total_efectivo)}</td>
                    <td className="hidden text-right tabular-nums sm:table-cell">{euros(h.total_tarjeta + h.total_bizum)}</td>
                    <td className="text-right"><Insignia color={colorDif(h.diferencia)}>{textoDif(h.diferencia)}</Insignia></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
