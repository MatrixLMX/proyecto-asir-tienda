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
