import {
  createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type InputHTMLAttributes, type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Info, Monitor, Moon, Sun, TrendingDown, TrendingUp, X } from "lucide-react";
import { api } from "./api";

/* =====================================================================
   Datos
   ===================================================================== */

/** Avisa al resto de pantallas de que algo ha cambiado (venta, compra...). */
export const emitirCambio = () => window.dispatchEvent(new Event("tienda:cambio"));

/** Carga datos de la API, permite recargarlos y se refresca tras un cambio
 *  (salvo con escuchar = false: p. ej. el detalle de algo que se puede borrar). */
export function useDatos<T>(ruta: string | null, escuchar = true) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recargar = useCallback(() => {
    if (!ruta) return;
    api<T>(ruta).then((d) => { setDatos(d); setError(null); }).catch((e) => setError(e.message));
  }, [ruta]);
  useEffect(() => {
    recargar();
    if (!escuchar) return;
    window.addEventListener("tienda:cambio", recargar);
    return () => window.removeEventListener("tienda:cambio", recargar);
  }, [recargar, escuchar]);
  return { datos, error, cargando: datos === null && !error && !!ruta, recargar };
}

/* =====================================================================
   Tema claro / oscuro
   ===================================================================== */

export type Tema = "claro" | "oscuro" | "sistema";
const CLAVE_TEMA = "tienda_tema";
const consulta = () => window.matchMedia("(prefers-color-scheme: dark)");

function leerTema(): Tema {
  try { return (localStorage.getItem(CLAVE_TEMA) as Tema) || "sistema"; } catch { return "sistema"; }
}

function aplicarTema(t: Tema) {
  const oscuro = t === "oscuro" || (t === "sistema" && consulta().matches);
  document.documentElement.classList.toggle("dark", oscuro);
}

const oyentes = new Set<() => void>();
function suscribir(cb: () => void) {
  oyentes.add(cb);
  const q = consulta();
  const alCambiarSistema = () => { aplicarTema(leerTema()); cb(); };
  q.addEventListener("change", alCambiarSistema);
  return () => { oyentes.delete(cb); q.removeEventListener("change", alCambiarSistema); };
}

export function useTema() {
  const tema = useSyncExternalStore(suscribir, leerTema);
  const oscuro = useSyncExternalStore(suscribir, () => document.documentElement.classList.contains("dark"));
  const cambiar = (t: Tema) => {
    try { localStorage.setItem(CLAVE_TEMA, t); } catch { /* sin almacenamiento: solo esta sesión */ }
    aplicarTema(t);
    oyentes.forEach((cb) => cb());
  };
  return { tema, oscuro, cambiar };
}

/** Colores para los gráficos (recharts no lee variables CSS). */
export function useColoresGrafico() {
  const { oscuro } = useTema();
  return oscuro
    ? { linea: "#34d399", relleno: "#10b981", secundario: "#334155", rejilla: "#243040", ejes: "#64748b", fondoTooltip: "#12181f", bordeTooltip: "#243040", texto: "#e7edf3" }
    : { linea: "#059669", relleno: "#10b981", secundario: "#cbd5e1", rejilla: "#e3e8ee", ejes: "#94a3b8", fondoTooltip: "#ffffff", bordeTooltip: "#e3e8ee", texto: "#0f172a" };
}

export function SelectorTema({ compacto = false }: { compacto?: boolean }) {
  const { tema, cambiar } = useTema();
  const opciones = [
    { id: "claro", nombre: "Claro", icono: Sun },
    { id: "oscuro", nombre: "Oscuro", icono: Moon },
    { id: "sistema", nombre: "Sistema", icono: Monitor },
  ] as const;
  return (
    <div className="flex rounded-xl border border-borde bg-superficie-2 p-1" role="radiogroup" aria-label="Tema">
      {opciones.map(({ id, nombre, icono: Icono }) => (
        <button
          key={id}
          role="radio"
          aria-checked={tema === id}
          title={`Tema ${nombre.toLowerCase()}`}
          onClick={() => cambiar(id)}
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium transition ${
            tema === id ? "bg-superficie text-texto shadow-sm" : "text-tenue hover:text-suave"
          }`}
        >
          <Icono className="size-3.5" />
          {!compacto && nombre}
        </button>
      ))}
    </div>
  );
}

/* =====================================================================
   Notificaciones (toasts)
   ===================================================================== */

type TipoAviso = "ok" | "error" | "info";
interface Notificacion { id: number; tipo: TipoAviso; texto: string }
const ContextoAvisos = createContext<(tipo: TipoAviso, texto: string) => void>(() => {});

export const useAviso = () => useContext(ContextoAvisos);

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Notificacion[]>([]);
  const quitar = (id: number) => setLista((l) => l.filter((n) => n.id !== id));
  const avisar = useCallback((tipo: TipoAviso, texto: string) => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l.slice(-3), { id, tipo, texto }]);
    setTimeout(() => quitar(id), tipo === "error" ? 6000 : 3500);
  }, []);
  const iconos = { ok: CheckCircle2, error: AlertCircle, info: Info };
  const colores = { ok: "text-marca-500", error: "text-rose-500", info: "text-sky-500" };
  return (
    <ContextoAvisos.Provider value={avisar}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {lista.map((n) => {
          const Icono = iconos[n.tipo];
          return (
            <div key={n.id} className="tarjeta animar-modal pointer-events-auto flex w-full max-w-md items-start gap-3 px-4 py-3 shadow-lg">
              <Icono className={`mt-0.5 size-5 shrink-0 ${colores[n.tipo]}`} />
              <p className="flex-1 text-sm">{n.texto}</p>
              <button onClick={() => quitar(n.id)} className="text-tenue hover:text-texto" aria-label="Cerrar"><X className="size-4" /></button>
            </div>
          );
        })}
      </div>
    </ContextoAvisos.Provider>
  );
}

/* =====================================================================
   Ventanas modales
   ===================================================================== */

export function Modal({ abierto, alCerrar, titulo, children, ancho = "max-w-md" }: {
  abierto: boolean; alCerrar: () => void; titulo: string; children: ReactNode; ancho?: string;
}) {
  useEffect(() => {
    if (!abierto) return;
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && alCerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [abierto, alCerrar]);
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-slate-950/50 backdrop-blur-sm sm:place-items-center sm:p-4" onClick={alCerrar}>
      <div
        role="dialog" aria-modal="true" aria-label={titulo}
        className={`tarjeta animar-modal w-full ${ancho} rounded-b-none p-6 shadow-2xl sm:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <button onClick={alCerrar} className="rounded-lg p-1 text-tenue hover:bg-superficie-2 hover:text-texto" aria-label="Cerrar"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Confirmar({ abierto, alCerrar, alConfirmar, titulo, mensaje, textoBoton = "Confirmar", peligro = false }: {
  abierto: boolean; alCerrar: () => void; alConfirmar: () => void; titulo: string; mensaje: ReactNode; textoBoton?: string; peligro?: boolean;
}) {
  return (
    <Modal abierto={abierto} alCerrar={alCerrar} titulo={titulo}>
      <div className="mb-6 text-sm text-suave">{mensaje}</div>
      <div className="flex justify-end gap-2">
        <button className="boton-sec" onClick={alCerrar}>Cancelar</button>
        <button className={peligro ? "boton-peligro" : "boton"} onClick={() => { alConfirmar(); alCerrar(); }} autoFocus>{textoBoton}</button>
      </div>
    </Modal>
  );
}

/* =====================================================================
   Piezas de interfaz
   ===================================================================== */

export function Cabecera({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{titulo}</h1>
        {subtitulo && <p className="mt-1 text-sm text-suave">{subtitulo}</p>}
      </div>
      {children}
    </div>
  );
}

const COLORES = {
  verde: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20",
  ambar: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20",
  rojo: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20",
  azul: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20",
  gris: "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-400/20",
};
export type ColorInsignia = keyof typeof COLORES;

export function Insignia({ color, children }: { color: ColorInsignia; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${COLORES[color]}`}>
      {children}
    </span>
  );
}

export function Kpi({ titulo, valor, detalle, icono, tendencia, color = "marca" }: {
  titulo: string; valor: string; detalle?: string; icono: ReactNode; tendencia?: number | null; color?: "marca" | "ambar" | "rojo" | "azul";
}) {
  const fondos = {
    marca: "bg-marca-suave text-marca-fuerte",
    ambar: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
    rojo: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300",
    azul: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300",
  };
  return (
    <div className="tarjeta p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-suave">{titulo}</p>
        <div className={`rounded-xl p-2 ${fondos[color]}`}>{icono}</div>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums">{valor}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {tendencia != null && isFinite(tendencia) && (
          <span className={`inline-flex items-center gap-0.5 font-semibold ${tendencia >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {tendencia >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {Math.abs(tendencia).toFixed(0)} %
          </span>
        )}
        {detalle && <span className="text-tenue">{detalle}</span>}
      </div>
    </div>
  );
}

export function Esqueleto({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-superficie-2 ${className}`} />;
}

export function Vacio({ icono, titulo, children }: { icono?: ReactNode; titulo?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      {icono && <div className="mb-3 rounded-2xl bg-superficie-2 p-3 text-tenue">{icono}</div>}
      {titulo && <p className="font-semibold">{titulo}</p>}
      {children && <p className="mt-1 text-sm text-tenue">{children}</p>}
    </div>
  );
}

export function Pestañas<T extends string>({ opciones, valor, alCambiar }: {
  opciones: { id: T; nombre: string; cuenta?: number }[]; valor: T; alCambiar: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-borde bg-superficie p-1">
      {opciones.map((o) => (
        <button
          key={o.id}
          onClick={() => alCambiar(o.id)}
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            valor === o.id ? "bg-texto text-fondo" : "text-suave hover:bg-superficie-2"
          }`}
        >
          {o.nombre}
          {o.cuenta != null && <span className={`rounded-md px-1.5 text-xs ${valor === o.id ? "bg-fondo/20" : "bg-superficie-2"}`}>{o.cuenta}</span>}
        </button>
      ))}
    </div>
  );
}

/* =====================================================================
   Campo numérico
   ===================================================================== */

/** Número escrito como texto: se puede borrar del todo (no se queda un 0
 *  pegado), admite coma decimal y en el móvil saca el teclado numérico.
 *  Vacío equivale a null. */
export function CampoNumero({ valor, alCambiar, decimales = 2, className = "campo", ...resto }: {
  valor: number | null; alCambiar: (n: number | null) => void; decimales?: number;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const aTexto = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));
  const leer = (t: string) => {
    const s = t.trim().replace(",", ".");
    const n = Number(s);
    return s === "" || s === "." || Number.isNaN(n) ? null : n;
  };
  const [texto, setTexto] = useState(() => aTexto(valor));
  // Si el valor cambia desde fuera (p. ej. un botón de 0,5 kg), se muestra
  // (vacío y 0 cuentan igual: así borrar el campo no vuelve a poner un 0)
  useEffect(() => { if ((leer(texto) ?? 0) !== (valor ?? 0)) setTexto(aTexto(valor)); }, [valor]); // eslint-disable-line react-hooks/exhaustive-deps
  const patron = decimales ? new RegExp(String.raw`^\d*([.,]\d{0,${decimales}})?$`) : /^\d*$/;
  return (
    <input
      {...resto} type="text" inputMode={decimales ? "decimal" : "numeric"} autoComplete="off" className={className} value={texto}
      onChange={(e) => {
        const t = e.target.value.replace(/\s/g, "");
        if (!patron.test(t)) return;
        setTexto(t);
        alCambiar(leer(t));
      }}
    />
  );
}
