import { useState, type FormEvent } from "react";
import { HandCoins, Pencil, Phone, Plus, Search, Trash2, UserPlus, X } from "lucide-react";
import { NOMBRE_PAGO, borrar, euros, fechaHora, patch, post, type Cliente, type FormaPago } from "../api";
import type { PropsPagina } from "../App";
import { Cabecera, CampoNumero, Confirmar, Esqueleto, Insignia, Modal, Vacio, emitirCambio, useAviso, useDatos } from "../ui";

interface Movimiento { tipo: "venta" | "devolucion" | "pago"; id: number; fecha: string; importe: number; venta_id: number | null; usuario: string | null; metodo: FormaPago | null; notas: string | null }
type ClienteDetalle = Cliente & { movimientos: Movimiento[] };

const TEXTO_MOVIMIENTO = {
  venta: (m: Movimiento) => `Compra (ticket nº ${m.venta_id})`,
  devolucion: (m: Movimiento) => `Devolución (ticket nº ${m.venta_id})`,
  pago: (m: Movimiento) => `Pago en ${m.metodo ? NOMBRE_PAGO[m.metodo].toLowerCase() : "efectivo"}`,
};

/** Desplegable de clientes con alta rápida, para no salir del cobro. */
export function ElegirCliente({ id, valor, alCambiar }: { id: string; valor: number | ""; alCambiar: (v: number | "") => void }) {
  const { datos, recargar } = useDatos<Cliente[]>("/clientes");
  const avisar = useAviso();
  const [nuevo, setNuevo] = useState<string | null>(null);

  async function crear() {
    if (!nuevo?.trim()) return;
    const ya = datos?.find((c) => c.nombre.toLowerCase() === nuevo.trim().toLowerCase());
    if (ya) { alCambiar(ya.id); setNuevo(null); return; }
    try {
      const r = await post<{ id: number }>("/clientes", { nombre: nuevo.trim() });
      recargar();
      alCambiar(r.id);
      setNuevo(null);
    } catch (e) { avisar("error", (e as Error).message); }
  }

  if (nuevo != null) return (
    <div className="flex gap-2">
      <input id={id} className="campo" autoFocus maxLength={80} placeholder="Nombre del cliente" value={nuevo} onChange={(e) => setNuevo(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); crear(); } if (e.key === "Escape") { e.stopPropagation(); setNuevo(null); } }} />
      <button type="button" className="boton px-3" disabled={!nuevo.trim()} onClick={crear}>Añadir</button>
      <button type="button" className="boton-sec px-3" onClick={() => setNuevo(null)} aria-label="Cancelar"><X className="size-4" /></button>
    </div>
  );
  return (
    <div className="flex gap-2">
      <select id={id} className="campo" value={valor} onChange={(e) => alCambiar(e.target.value ? Number(e.target.value) : "")}>
        <option value="">Elige cliente…</option>
        {datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.deuda ? ` (debe ${euros(c.deuda)})` : ""}</option>)}
      </select>
      <button type="button" className="boton-sec shrink-0 px-3" onClick={() => setNuevo("")} title="Nuevo cliente" aria-label="Nuevo cliente"><Plus className="size-4" /></button>
    </div>
  );
}

export default function Fiado({ usuario }: PropsPagina) {
  const esAdmin = usuario.rol === "admin";
  const { datos } = useDatos<Cliente[]>("/clientes?todos=true");
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<number | null>(null);
  const [form, setForm] = useState<{ id: number | null; nombre: string; telefono: string; notas: string; activo: boolean } | null>(null);
  const avisar = useAviso();

  const lista = (datos ?? [])
    .filter((c) => (c.activo || c.deuda) && c.nombre.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.deuda > 0) - Number(a.deuda > 0));
  const total = (datos ?? []).reduce((s, c) => s + c.deuda, 0);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const cuerpo = { nombre: form.nombre.trim(), telefono: form.telefono.trim() || null, notas: form.notas.trim() || null };
    try {
      if (form.id == null) await post("/clientes", cuerpo);
      else await patch(`/clientes/${form.id}`, { ...cuerpo, activo: form.activo });
      avisar("ok", `${cuerpo.nombre} guardado`);
      emitirCambio();
      setForm(null);
    } catch (err) { avisar("error", (err as Error).message); }
  }

  return (
    <>
      <Cabecera titulo="Fiado" subtitulo="Lo que debe cada cliente. Se apunta al cobrar con Fiado en Vender.">
        <button className="boton" onClick={() => setForm({ id: null, nombre: "", telefono: "", notas: "", activo: true })}><UserPlus className="size-4" /> Cliente</button>
      </Cabecera>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="tarjeta px-4 py-3"><p className="text-xs text-suave">Pendiente de cobrar</p><p className="text-xl font-bold tabular-nums">{datos ? euros(total) : "…"}</p></div>
        <div className="relative min-w-60 flex-1 sm:max-w-md">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-tenue" />
          <input className="campo pl-10" placeholder="Buscar cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {!datos ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Esqueleto key={i} className="h-20" />)}</div>
        : !lista.length ? <div className="tarjeta"><Vacio icono={<HandCoins className="size-6" />} titulo="No hay clientes">Añade el primero aquí o al cobrar con Fiado.</Vacio></div> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((c) => (
            <button key={c.id} onClick={() => setAbierto(c.id)} className={`tarjeta flex items-center justify-between gap-3 p-4 text-left transition hover:border-marca-500/60 ${c.activo ? "" : "opacity-60"}`}>
              <span className="min-w-0"><span className="block truncate font-medium">{c.nombre}</span><span className="block text-xs text-tenue">{c.telefono ?? "Sin teléfono"}</span></span>
              {c.deuda > 0 ? <Insignia color="ambar">debe {euros(c.deuda)}</Insignia> : <Insignia color="verde">al día</Insignia>}
            </button>
          ))}
        </div>
      )}

      <Cuenta id={abierto} esAdmin={esAdmin} alCerrar={() => setAbierto(null)}
        alEditar={(c) => { setAbierto(null); setForm({ id: c.id, nombre: c.nombre, telefono: c.telefono ?? "", notas: c.notas ?? "", activo: !!c.activo }); }} />

      <Modal abierto={!!form} alCerrar={() => setForm(null)} titulo={form?.id == null ? "Nuevo cliente" : "Editar cliente"}>
        {form && (
          <form onSubmit={guardar} className="space-y-4">
            <div><label className="etiqueta" htmlFor="k-nombre">Nombre</label><input id="k-nombre" className="campo" required autoFocus maxLength={80} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
            <div><label className="etiqueta" htmlFor="k-tel">Teléfono (opcional)</label><input id="k-tel" className="campo" type="tel" maxLength={20} value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></div>
            <div><label className="etiqueta" htmlFor="k-notas">Notas (opcional)</label><input id="k-notas" className="campo" maxLength={255} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></div>
            {form.id != null && (
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" className="size-4 accent-emerald-600" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
                Cliente activo (si no debe nada, se puede desactivar)
              </label>
            )}
            <div className="flex justify-end gap-2"><button type="button" className="boton-sec" onClick={() => setForm(null)}>Cancelar</button><button className="boton" disabled={!form.nombre.trim()}>Guardar</button></div>
          </form>
        )}
      </Modal>
    </>
  );
}

function Cuenta({ id, esAdmin, alCerrar, alEditar }: { id: number | null; esAdmin: boolean; alCerrar: () => void; alEditar: (c: Cliente) => void }) {
  const detalle = useDatos<ClienteDetalle>(id ? `/clientes/${id}` : null, false);
  const avisar = useAviso();
  const [importe, setImporte] = useState<number | null>(null);
  const [metodo, setMetodo] = useState<FormaPago>("efectivo");
  const [enviando, setEnviando] = useState(false);
  const [aBorrar, setABorrar] = useState<Movimiento | null>(null);
  const c = detalle.datos && detalle.datos.id === id ? detalle.datos : null;

  async function cobrar(e: FormEvent) {
    e.preventDefault();
    if (!importe) return;
    setEnviando(true);
    try {
      await post(`/clientes/${id}/pagos`, { importe, metodo });
      avisar("ok", `Cobrados ${euros(importe)}`);
      setImporte(null);
      detalle.recargar();
      emitirCambio();
    } catch (err) { avisar("error", (err as Error).message); } finally { setEnviando(false); }
  }

  async function quitarPago(m: Movimiento) {
    try {
      await borrar(`/pagos-fiado/${m.id}`);
      avisar("ok", "Cobro borrado");
      detalle.recargar();
      emitirCambio();
    } catch (err) { avisar("error", (err as Error).message); }
  }

  return (
    <Modal abierto={id != null} alCerrar={alCerrar} titulo={c?.nombre ?? "Cliente"} ancho="max-w-lg">
      {!c ? <Esqueleto className="h-48" /> : (
        <>
          <div className="mb-4 flex items-center justify-between rounded-2xl bg-superficie-2 p-4">
            <div><p className="text-sm text-suave">Debe</p><p className="text-3xl font-bold tabular-nums">{euros(c.deuda)}</p></div>
            <div className="flex gap-2">
              {c.telefono && <a className="boton-sec px-3" href={`tel:${c.telefono}`} aria-label={`Llamar a ${c.nombre}`}><Phone className="size-4" /></a>}
              {esAdmin && <button className="boton-sec px-3" onClick={() => alEditar(c)} aria-label="Editar cliente"><Pencil className="size-4" /></button>}
            </div>
          </div>
          {c.notas && <p className="mb-4 rounded-xl bg-superficie-2 px-3 py-2 text-sm text-suave">{c.notas}</p>}

          {c.deuda > 0 && (
            <form onSubmit={cobrar} className="mb-4 space-y-2">
              <label className="etiqueta" htmlFor="pago-importe">Registrar un pago</label>
              <div className="flex gap-2">
                <CampoNumero id="pago-importe" className="campo text-right tabular-nums" placeholder="0,00" valor={importe} alCambiar={setImporte} />
                <button type="button" className="boton-sec shrink-0 px-3 text-xs" onClick={() => setImporte(c.deuda)}>Todo</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["efectivo", "tarjeta", "bizum"] as const).map((m) => (
                  <button type="button" key={m} onClick={() => setMetodo(m)} className={`rounded-xl border py-2 text-sm ${metodo === m ? "border-marca-500 bg-marca-suave font-medium text-marca-fuerte" : "border-borde text-suave"}`}>{NOMBRE_PAGO[m]}</button>
                ))}
              </div>
              <button className="boton w-full" disabled={enviando || !importe}><HandCoins className="size-4" /> Cobrar</button>
            </form>
          )}

          <h3 className="mb-1 text-sm font-semibold">Movimientos</h3>
          {!c.movimientos.length ? <p className="py-3 text-sm text-tenue">Todavía no hay movimientos.</p> : (
            <ul className="max-h-[35vh] divide-y divide-borde overflow-y-auto rounded-xl border border-borde">
              {c.movimientos.map((m) => (
                <li key={`${m.tipo}-${m.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0"><span className="block">{TEXTO_MOVIMIENTO[m.tipo](m)}</span><span className="block text-xs text-tenue">{fechaHora(m.fecha)} · {m.usuario ?? "—"}</span></span>
                  <span className="flex items-center gap-2">
                    <span className={`font-semibold tabular-nums ${m.importe < 0 ? "text-marca-fuerte" : ""}`}>{m.importe > 0 ? "+" : "−"}{euros(Math.abs(m.importe))}</span>
                    {esAdmin && m.tipo === "pago" && <button className="rounded-lg p-1 text-tenue hover:text-rose-500" onClick={() => setABorrar(m)} aria-label="Borrar cobro"><Trash2 className="size-4" /></button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Confirmar abierto={!!aBorrar} alCerrar={() => setABorrar(null)} alConfirmar={() => aBorrar && quitarPago(aBorrar)} titulo="Borrar cobro" textoBoton="Borrar" peligro
            mensaje={aBorrar && <>Se borrará el cobro de <b>{euros(Math.abs(aBorrar.importe))}</b> y volverá a la deuda. Queda apuntado en el registro de cambios.</>} />
        </>
      )}
    </Modal>
  );
}
