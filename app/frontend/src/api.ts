export type Rol = "admin" | "dependiente";

export interface Usuario {
  usuario: string;
  nombre: string;
  rol: Rol;
  asistente?: boolean;
}

export interface ProductoStock {
  id: number;
  codigo_barras: string | null;
  producto: string;
  categoria: string;
  unidad_medida: "unidad" | "kg";
  precio_venta: number;
  stock_actual: number;
  stock_minimo: number;
  estado: "OK" | "BAJO" | "AGOTADO";
}

export interface Caducidad {
  lote_id: number;
  producto_id: number;
  producto: string;
  categoria: string;
  fecha_caducidad: string;
  dias_restantes: number;
  cantidad_restante: number;
  unidad_medida: string;
  estado: "CADUCADO" | "CADUCA HOY" | "PROXIMO";
}

export interface AlertaStock {
  id: number;
  producto: string;
  categoria: string;
  proveedor: string | null;
  unidad_medida: string;
  stock_actual: number;
  stock_minimo: number;
  cantidad_sugerida: number;
}

const CLAVE = "tienda_token";

export const sesion = {
  token: () => localStorage.getItem(CLAVE),
  guardar: (t: string) => localStorage.setItem(CLAVE, t),
  cerrar: () => localStorage.removeItem(CLAVE),
};

export async function api<T = unknown>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const token = sesion.token();
  const res = await fetch(`/api${ruta}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opciones.headers,
    },
  });
  if (res.status === 401 && ruta !== "/auth/login") {
    sesion.cerrar();
    window.location.reload();
  }
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => ({}));
    const detalle = cuerpo.detail;
    throw new Error(
      typeof detalle === "string" ? detalle : Array.isArray(detalle) ? "Revisa los datos del formulario" : `Error ${res.status}`,
    );
  }
  return res.json();
}

export const post = <T = unknown>(ruta: string, datos: unknown) =>
  api<T>(ruta, { method: "POST", body: JSON.stringify(datos) });

export const euros = (n: number) =>
  n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export const cantidad = (n: number, unidad: string) =>
  unidad === "kg"
    ? `${n.toLocaleString("es-ES", { maximumFractionDigits: 3 })} kg`
    : `${n.toLocaleString("es-ES", { maximumFractionDigits: 0 })} u`;

export const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });

export const patch = <T = unknown>(ruta: string, datos: unknown) =>
  api<T>(ruta, { method: "PATCH", body: JSON.stringify(datos) });

export const borrar = <T = unknown>(ruta: string) => api<T>(ruta, { method: "DELETE" });

export const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** Fecha de hoy (o desplazada) en formato AAAA-MM-DD, en hora local. */
export const diaISO = (desplazamiento = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + desplazamiento);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Descarga una tabla como CSV que Excel abre bien (separador ; y coma decimal). */
export function descargarCsv<T extends object>(nombre: string, filas: T[], columnas: [string, string][]) {
  const celda = (v: unknown) => {
    const texto = typeof v === "number" ? v.toLocaleString("es-ES", { useGrouping: false, maximumFractionDigits: 4 }) : String(v ?? "");
    return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const lineas = [columnas.map(([, t]) => t).join(";"), ...filas.map((f) => columnas.map(([k]) => celda((f as Record<string, unknown>)[k])).join(";"))];
  const blob = new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export interface LineaTicket { producto: string; unidad_medida: string; cantidad: number; precio_unitario: number; iva_porcentaje: number; importe: number }
export interface Venta { id: number; fecha: string; metodo_pago: "efectivo" | "tarjeta" | "bizum"; total: number; usuario: string | null; lineas?: LineaTicket[] }
