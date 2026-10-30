import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

/** Carga datos de la API y permite recargarlos. */
export function useDatos<T>(ruta: string | null) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recargar = useCallback(() => {
    if (!ruta) return;
    api<T>(ruta).then(setDatos).catch((e) => setError(e.message));
  }, [ruta]);
  useEffect(recargar, [recargar]);
  return { datos, error, recargar };
}

export function Cabecera({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{titulo}</h1>
        {subtitulo && <p className="mt-1 text-sm text-slate-500">{subtitulo}</p>}
      </div>
      {children}
    </div>
  );
}

const COLORES = {
  verde: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  ambar: "bg-amber-50 text-amber-700 ring-amber-600/20",
  rojo: "bg-rose-50 text-rose-700 ring-rose-600/20",
  gris: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export function Insignia({ color, children }: { color: keyof typeof COLORES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${COLORES[color]}`}>
      {children}
    </span>
  );
}

export function Kpi({ titulo, valor, detalle, icono }: { titulo: string; valor: string; detalle?: string; icono: ReactNode }) {
  return (
    <div className="tarjeta p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{titulo}</p>
        <div className="rounded-xl bg-marca-50 p-2 text-marca-600">{icono}</div>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{valor}</p>
      {detalle && <p className="mt-1 text-xs text-slate-500">{detalle}</p>}
    </div>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-slate-400">{children}</p>;
}

export function Aviso({ tipo, children }: { tipo: "error" | "ok"; children: ReactNode }) {
  return (
    <div className={`rounded-xl px-4 py-3 text-sm ${tipo === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
      {children}
    </div>
  );
}
