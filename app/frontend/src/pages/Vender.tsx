import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Banknote, CreditCard, Minus, PackagePlus, PackageSearch, Plus, Printer, Search, ShoppingBag, Smartphone, Trash2, X } from "lucide-react";
import { cantidad, euros, post, type ProductoStock } from "../api";
import type { PropsPagina } from "../App";
import { BotonEscanear, useLectorGlobal } from "../escaner";
import { imprimirTicket } from "../ticket";
import { Cabecera, CampoNumero, Esqueleto, Modal, Vacio, emitirCambio, useAviso, useDatos } from "../ui";
import { CLAVE_CODIGO_NUEVO } from "./Catalogo";

interface Linea { producto: ProductoStock; cantidad: number }
interface UltimaVenta { id: number; total: number; efectivo?: { entregado: number; cambio: number } }
type Pago = "efectivo" | "tarjeta" | "bizum";

const PAGOS = [
  { id: "efectivo", nombre: "Efectivo", icono: Banknote },
  { id: "tarjeta", nombre: "Tarjeta", icono: CreditCard },
  { id: "bizum", nombre: "Bizum", icono: Smartphone },
] as const;
const PESOS = [0.25, 0.5, 1, 2];
const BILLETES = [5, 10, 20, 50];
// Igual que la base de datos: cada línea se redondea a céntimos
const importe = (l: Linea) => Math.round(l.cantidad * l.producto.precio_venta * 100) / 100;

export default function Vender({ usuario, ir }: PropsPagina) {
  const { datos: productos } = useDatos<ProductoStock[]>("/productos");
  const avisar = useAviso();
  const buscador = useRef<HTMLInputElement>(null);
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [carrito, setCarrito] = useState<Linea[]>([]);
  const [cobrando, setCobrando] = useState(false);
  const [ticketMovil, setTicketMovil] = useState(false);
  const [ultima, setUltima] = useState<UltimaVenta | null>(null);
  const [desconocido, setDesconocido] = useState<string | null>(null);

  const categorias = useMemo(() => [...new Set((productos ?? []).map((p) => p.categoria))].sort(), [productos]);
  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    return (productos ?? []).filter(
      (p) => (!categoria || p.categoria === categoria) &&
        (!q || p.producto.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q) || p.codigo_barras === q),
    );
  }, [productos, busqueda, categoria]);

  const total = carrito.reduce((s, l) => s + importe(l), 0);
  const articulos = carrito.reduce((s, l) => s + (l.producto.unidad_medida === "kg" ? 1 : l.cantidad), 0);
  const enCarrito = (id: number) => carrito.find((l) => l.producto.id === id)?.cantidad ?? 0;

  function añadir(p: ProductoStock) {
    const yaHay = enCarrito(p.id);
    if (p.stock_actual <= 0) { avisar("error", `${p.producto} está agotado`); return; }
    if (p.unidad_medida === "unidad" && yaHay + 1 > p.stock_actual) {
      avisar("error", `Solo quedan ${cantidad(p.stock_actual, p.unidad_medida)} de ${p.producto}`);
      return;
    }
    setCarrito((c) => yaHay
      ? c.map((l) => (l.producto.id === p.id && p.unidad_medida === "unidad" ? { ...l, cantidad: l.cantidad + 1 } : l))
      : [...c, { producto: p, cantidad: p.unidad_medida === "kg" ? 0.5 : 1 }]);
  }

  // quitarSiCero = false al escribir un peso: mientras se borra el número
  // la línea se queda (con 0 kg) en vez de desaparecer
  const cambiar = (id: number, n: number, quitarSiCero = true) =>
    setCarrito((c) => c.map((l) => (l.producto.id === id ? { ...l, cantidad: Math.max(0, Math.round(n * 1000) / 1000) } : l))
      .filter((l) => l.cantidad > 0 || (!quitarSiCero && l.producto.id === id)));

  /** Código leído por el lector, la cámara o escrito en el buscador. */
  function porCodigo(codigo: string) {
    const c = codigo.trim();
    const p = productos?.find((x) => x.codigo_barras === c);
    if (p) { añadir(p); setDesconocido(null); return true; }
    if (/^\d{6,14}$/.test(c)) { setDesconocido(c); return true; }
    return false;
  }
  // Lector USB/Bluetooth aunque el cursor no esté en el buscador
  useLectorGlobal(porCodigo, !cobrando);

  function alPulsarEnter() {
    if (porCodigo(busqueda)) { setBusqueda(""); return; }
    if (filtrados.length === 1) { añadir(filtrados[0]); setBusqueda(""); }
  }

  function crearProducto() {
    try { sessionStorage.setItem(CLAVE_CODIGO_NUEVO, desconocido ?? ""); } catch { /* sin almacenamiento */ }
    setDesconocido(null);
    ir("catalogo");
  }

  // Atajos de teclado: F2 cobrar, F4 buscar
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "F2" && carrito.length && carrito.every((l) => l.cantidad > 0) && !cobrando) { e.preventDefault(); setCobrando(true); }
      if (e.key === "F4") { e.preventDefault(); buscador.current?.focus(); buscador.current?.select(); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [carrito, cobrando]);

  const imprimir = (v: UltimaVenta) => imprimirTicket(v.id, v.efectivo).catch((e) => avisar("error", e.message));

  async function confirmarVenta(pago: Pago, entregado: number | null) {
    try {
      const r = await post<{ id: number; total: number }>("/ventas", {
        metodo_pago: pago,
        lineas: carrito.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad })),
      });
      const cambio = entregado != null ? Math.round((entregado - r.total) * 100) / 100 : null;
      setUltima({ id: r.id, total: r.total, ...(entregado != null ? { efectivo: { entregado, cambio: cambio ?? 0 } } : {}) });
      avisar("ok", `Venta nº ${r.id}: ${euros(r.total)}${cambio ? ` · cambio ${euros(cambio)}` : ""}`);
      setCarrito([]);
      setCobrando(false);
      setTicketMovil(false);
      setBusqueda("");
      emitirCambio();
      buscador.current?.focus();
    } catch (e) {
      avisar("error", (e as Error).message);
    }
  }

  const ticket = (
    <Ticket carrito={carrito} total={total} cambiar={cambiar} vaciar={() => setCarrito([])} cobrar={() => setCobrando(true)}
      ultima={ultima} imprimir={imprimir} />
  );

  return (
    <>
      <Cabecera titulo="Vender" subtitulo="Toca un producto o escanea su código de barras (lector o cámara)">
        <p className="hidden gap-3 text-xs text-tenue lg:flex">
          <span><kbd className="tecla">F4</kbd> buscar</span><span><kbd className="tecla">F2</kbd> cobrar</span><span><kbd className="tecla">Esc</kbd> cerrar</span>
        </p>
      </Cabecera>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-tenue" />
            <input
              ref={buscador}
              className="campo py-3 pl-10 pr-10"
              placeholder="Buscar o escanear código de barras…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && alPulsarEnter()}
              autoFocus
            />
            {busqueda && (
              <button className="absolute right-3 top-1/2 -translate-y-1/2 text-tenue hover:text-texto" onClick={() => setBusqueda("")} aria-label="Borrar búsqueda"><X className="size-4" /></button>
            )}
            </div>
            <BotonEscanear alLeer={porCodigo} className="boton-sec shrink-0 px-4" />
          </div>
          {desconocido && (
            <div className="animar-entrada mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              <span className="flex-1">El código <b className="tabular-nums">{desconocido}</b> no está en el catálogo.
                {usuario.rol !== "admin" && " Avisa al administrador para que lo dé de alta."}</span>
              {usuario.rol === "admin" && <button className="boton py-1.5" onClick={crearProducto}><PackagePlus className="size-4" /> Crear producto</button>}
              <button className="text-tenue hover:text-texto" onClick={() => setDesconocido(null)} aria-label="Cerrar aviso"><X className="size-4" /></button>
            </div>
          )}

          <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
            {[null, ...categorias].map((c) => (
              <button
                key={c ?? "todas"}
                onClick={() => setCategoria(c)}
                className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                  categoria === c ? "border-marca-600 bg-marca-600 text-white" : "border-borde bg-superficie text-suave hover:border-marca-500"
                }`}
              >
                {c ?? "Todas"}
              </button>
            ))}
          </div>

          {!productos ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Esqueleto key={i} className="h-32" />)}</div>
          ) : filtrados.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {filtrados.map((p) => {
                const n = enCarrito(p.id);
                const agotado = p.stock_actual <= 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => añadir(p)}
                    disabled={agotado}
                    className={`tarjeta group relative flex min-h-32 flex-col items-start p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 ${
                      n ? "border-marca-500 ring-2 ring-marca-500/20" : "hover:border-marca-500/60"
                    }`}
                  >
                    {n > 0 && (
                      <span className="absolute right-2.5 top-2.5 grid min-w-6 place-items-center rounded-full bg-marca-600 px-1.5 py-0.5 text-xs font-bold text-white">
                        {p.unidad_medida === "kg" ? `${n} kg` : n}
                      </span>
                    )}
                    <span className="text-xs text-tenue">{p.categoria}</span>
                    <span className="mt-1 line-clamp-2 pr-6 text-sm font-semibold leading-snug">{p.producto}</span>
                    <div className="mt-auto flex w-full items-end justify-between pt-3">
                      <span className="text-lg font-bold tabular-nums text-marca-fuerte">
                        {euros(p.precio_venta)}
                        {p.unidad_medida === "kg" && <span className="text-xs font-medium text-tenue">/kg</span>}
                      </span>
                      <span className={`whitespace-nowrap text-[11px] font-medium ${agotado ? "text-rose-500" : p.estado === "BAJO" ? "text-amber-600 dark:text-amber-400" : "text-tenue"}`}>
                        {agotado ? "agotado" : cantidad(p.stock_actual, p.unidad_medida)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : <Vacio icono={<PackageSearch className="size-6" />} titulo="Sin resultados">Prueba con otro nombre o categoría</Vacio>}
        </div>

        <aside className="tarjeta hidden h-fit flex-col p-5 lg:sticky lg:top-8 lg:flex">{ticket}</aside>
      </div>

      {/* Barra del ticket (móvil) */}
      {carrito.length > 0 && (
        <div className="fixed bottom-[76px] left-3 right-[84px] z-30 lg:hidden">
          <button onClick={() => setTicketMovil(true)} className="animar-modal flex w-full items-center gap-3 rounded-2xl bg-marca-600 px-5 py-3.5 text-white shadow-xl shadow-marca-700/30">
            <ShoppingBag className="size-5" />
            <span className="text-sm font-medium">{articulos} {articulos === 1 ? "artículo" : "artículos"}</span>
            <span className="ml-auto text-lg font-bold tabular-nums">{euros(total)}</span>
          </button>
        </div>
      )}
      <Modal abierto={ticketMovil} alCerrar={() => setTicketMovil(false)} titulo="Ticket">{ticket}</Modal>

      <Cobro abierto={cobrando} total={total} alCerrar={() => setCobrando(false)} alConfirmar={confirmarVenta} />
    </>
  );
}

function Ticket({ carrito, total, cambiar, vaciar, cobrar, ultima, imprimir }: {
  carrito: Linea[]; total: number; cambiar: (id: number, n: number, quitarSiCero?: boolean) => void; vaciar: () => void; cobrar: () => void;
  ultima: UltimaVenta | null; imprimir: (v: UltimaVenta) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-3 hidden items-center justify-between lg:flex">
        <h2 className="font-semibold">Ticket</h2>
        {carrito.length > 0 && <button className="text-xs font-medium text-tenue hover:text-rose-500" onClick={vaciar}>Vaciar</button>}
      </div>
      {carrito.length === 0 ? (
        <Vacio icono={<ShoppingBag className="size-6" />} titulo="Ticket vacío">Añade productos para empezar</Vacio>
      ) : (
        <ul className="-mx-1 mb-4 max-h-[50vh] overflow-y-auto px-1">
          {carrito.map((linea) => { const { producto: p, cantidad: n } = linea; return (
            <li key={p.id} className="border-b border-borde py-3 last:border-0">
              <div className="flex justify-between gap-2 text-sm">
                <span className="font-medium">{p.producto}</span>
                <span className="font-semibold tabular-nums">{euros(importe(linea))}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                {p.unidad_medida === "kg" ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CampoNumero
                      decimales={3} valor={n} aria-label="Peso en kg" placeholder="0"
                      alCambiar={(v) => cambiar(p.id, v ?? 0, false)}
                      className={`campo w-20 px-2 py-1 text-center ${n > p.stock_actual || !n ? "border-rose-500" : ""}`}
                    />
                    <span className="text-xs text-tenue">kg</span>
                    {PESOS.map((w) => (
                      <button key={w} onClick={() => cambiar(p.id, w)} className={`rounded-lg border px-2 py-1 text-xs ${n === w ? "border-marca-500 bg-marca-suave text-marca-fuerte" : "border-borde text-suave hover:bg-superficie-2"}`}>
                        {w.toLocaleString("es-ES")}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center rounded-xl border border-borde">
                    <button className="p-1.5 text-suave hover:text-texto" onClick={() => cambiar(p.id, n - 1)} aria-label="Quitar uno"><Minus className="size-3.5" /></button>
                    <span className="w-8 text-center text-sm font-semibold tabular-nums">{n}</span>
                    <button className="p-1.5 text-suave hover:text-texto disabled:opacity-30" disabled={n >= p.stock_actual} onClick={() => cambiar(p.id, n + 1)} aria-label="Añadir uno"><Plus className="size-3.5" /></button>
                  </div>
                )}
                <span className="text-xs text-tenue">× {euros(p.precio_venta)}</span>
                <button className="ml-auto text-tenue hover:text-rose-500" onClick={() => cambiar(p.id, 0)} aria-label="Quitar del ticket"><Trash2 className="size-4" /></button>
              </div>
            </li>
          ); })}
        </ul>
      )}
      <div className="mb-4 flex items-baseline justify-between border-t border-borde pt-4">
        <span className="text-sm text-suave">Total</span>
        <span className="text-3xl font-bold tracking-tight tabular-nums">{euros(total)}</span>
      </div>
      <button className="boton w-full py-3.5 text-base" disabled={!carrito.length || carrito.some((l) => l.cantidad <= 0)} onClick={cobrar}>
        Cobrar <kbd className="tecla hidden border-white/30 bg-white/15 text-white lg:inline">F2</kbd>
      </button>
      {ultima && !carrito.length && (
        <button className="boton-sec mt-2 w-full" onClick={() => imprimir(ultima)}>
          <Printer className="size-4" /> Imprimir ticket nº {ultima.id} ({euros(ultima.total)})
        </button>
      )}
    </div>
  );
}

function Cobro({ abierto, total, alCerrar, alConfirmar }: {
  abierto: boolean; total: number; alCerrar: () => void; alConfirmar: (pago: Pago, entregado: number | null) => Promise<void>;
}) {
  const [pago, setPago] = useState<Pago>("efectivo");
  const [entregado, setEntregado] = useState("");
  const [enviando, setEnviando] = useState(false);
  const recibido = Number(entregado.replace(",", ".")) || 0;
  const cambio = pago === "efectivo" && recibido ? Math.round((recibido - total) * 100) / 100 : null;
  const falta = cambio != null && cambio < 0;

  async function confirmar(e?: FormEvent) {
    e?.preventDefault();
    if (enviando || falta) return;
    setEnviando(true);
    await alConfirmar(pago, pago === "efectivo" && recibido ? recibido : null);
    setEnviando(false);
    setEntregado("");
  }

  return (
    <Modal abierto={abierto} alCerrar={alCerrar} titulo="Cobrar">
      <div className="mb-5 rounded-2xl bg-superficie-2 p-5 text-center">
        <p className="text-sm text-suave">Total a cobrar</p>
        <p className="text-4xl font-bold tracking-tight tabular-nums">{euros(total)}</p>
      </div>
      <div className="mb-5 grid grid-cols-3 gap-2">
        {PAGOS.map(({ id, nombre, icono: Icono }) => (
          <button
            key={id}
            onClick={() => setPago(id)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border py-3 text-sm font-medium transition ${
              pago === id ? "border-marca-500 bg-marca-suave text-marca-fuerte ring-2 ring-marca-500/20" : "border-borde text-suave hover:bg-superficie-2"
            }`}
          >
            <Icono className="size-5" /> {nombre}
          </button>
        ))}
      </div>
      {pago === "efectivo" && (
        <div className="mb-5">
          <label className="etiqueta" htmlFor="entregado">Entregado por el cliente</label>
          <form onSubmit={confirmar}>
            <input id="entregado" className="campo mb-2 text-lg" inputMode="decimal" placeholder="0,00 (Intro para cobrar)" autoFocus value={entregado} onChange={(e) => setEntregado(e.target.value)} />
          </form>
          <div className="flex flex-wrap gap-2">
            <button className="boton-sec px-3 py-1.5" onClick={() => setEntregado(total.toFixed(2))}>Exacto</button>
            {BILLETES.filter((b) => b >= total).map((b) => (
              <button key={b} className="boton-sec px-3 py-1.5" onClick={() => setEntregado(String(b))}>{b} €</button>
            ))}
          </div>
          {cambio != null && (
            <p className={`mt-3 flex justify-between rounded-xl px-4 py-3 text-sm font-semibold ${falta ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" : "bg-marca-suave text-marca-fuerte"}`}>
              {falta ? "Falta" : "Cambio"} <span className="text-lg tabular-nums">{euros(Math.abs(cambio))}</span>
            </p>
          )}
        </div>
      )}
      <button className="boton w-full py-3.5 text-base" disabled={enviando || falta} onClick={() => confirmar()} autoFocus={pago !== "efectivo"}>
        Confirmar venta
      </button>
    </Modal>
  );
}
