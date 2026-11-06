import { useState, type ChangeEvent } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { descargarCsv, post } from "../api";
import { Esqueleto, Modal, emitirCambio, useAviso } from "../ui";

type Valor = string | number | boolean | Date | null;
type Fila = Record<string, unknown>;
interface FilaInforme { fila: number; nombre: string; estado: "nuevo" | "existe" | "error"; detalle?: string }
interface Informe { nuevos: number; errores: number; existentes: number; filas: FilaInforme[] }

// El servidor admite 200 filas por envío: un catálogo grande se manda por partes.
// Repetir un trozo no duplica nada, porque lo que ya existe se salta.
const POR_ENVIO = 200;
const trozos = <T,>(l: T[]) => Array.from({ length: Math.ceil(l.length / POR_ENVIO) }, (_, i) => l.slice(i * POR_ENVIO, (i + 1) * POR_ENVIO));

const COLUMNAS: [string, string][] = [
  ["nombre", "nombre"], ["codigo_barras", "codigo_barras"], ["categoria", "categoria"], ["proveedor", "proveedor"], ["iva", "iva"], ["unidad", "unidad"],
  ["precio", "precio"], ["coste", "coste"], ["stock", "stock"], ["stock_minimo", "stock_minimo"], ["caducidad", "caducidad"], ["vida_util_dias", "vida_util_dias"], ["control_stock", "control_stock"],
];
const EJEMPLO = [
  { nombre: "Coca-Cola lata 33 cl", codigo_barras: "5449000000996", categoria: "Bebidas", proveedor: "Coca-Cola", iva: 10, unidad: "unidad", precio: 1.2, coste: 0.55, stock: 24, stock_minimo: 6, caducidad: "", vida_util_dias: "", control_stock: "si" },
  { nombre: "Barra de pan", codigo_barras: "", categoria: "Alimentación", proveedor: "", iva: 4, unidad: "unidad", precio: 0.9, coste: 0.4, stock: "", stock_minimo: "", caducidad: "", vida_util_dias: "", control_stock: "no" },
];

const clave = (t: unknown) => String(t ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^\w]/g, "");
const ALIAS: Record<string, string> = {
  producto: "nombre", codigo: "codigo_barras", ean: "codigo_barras", pvp: "precio", precio_venta: "precio", precio_de_venta: "precio", coste_sin_iva: "coste", precio_compra: "coste", precio_de_compra: "coste",
  iva_: "iva", unidad_medida: "unidad", cantidad: "stock", minimo: "stock_minimo", fecha_caducidad: "caducidad", vida_util: "vida_util_dias",
};

/** Separador ; (Excel en español) o , con comillas. */
function leerCsv(texto: string): Valor[][] {
  const limpio = texto.replace(/^﻿/, "");
  const primera = limpio.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primera.match(/;/g)?.length ?? 0) >= (primera.match(/,/g)?.length ?? 0) ? ";" : ",";
  const filas: Valor[][] = [];
  let fila: string[] = [], celda = "", comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]!;
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') { celda += '"'; i++; } else if (c === '"') comillas = false; else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(celda); celda = ""; }
    else if (c === "\n") { fila.push(celda.replace(/\r$/, "")); filas.push(fila); fila = []; celda = ""; }
    else celda += c;
  }
  if (celda || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

/** "1,50", "1.234,50" o "1.5 €" a número. Si no se entiende, se deja el texto para que el servidor lo señale. */
function aNumero(v?: Valor): number | string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const t = String(v).replace(/[€%\s]/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : String(v);
}

function aFecha(v?: Valor): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v).trim();
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : t;
}

function aFilas(tabla: Valor[][]): Fila[] {
  const cabecera = (tabla[0] ?? []).map((c) => { const k = clave(c); return ALIAS[k] ?? k; });
  if (!cabecera.includes("nombre")) throw new Error('La primera fila tiene que tener los títulos, al menos "nombre". Descarga la plantilla para verlo.');
  return tabla.slice(1).filter((f) => f.some((c) => c !== null && c !== "")).map((f) => {
    const d: Record<string, Valor> = Object.fromEntries(cabecera.map((k, i) => [k, f[i] ?? null]));
    // Una columna que no está en el fichero llega como undefined
    const texto = (v?: Valor) => (v == null ? null : String(v).trim() || null);
    return {
      nombre: texto(d.nombre), codigo_barras: texto(d.codigo_barras), categoria: texto(d.categoria), proveedor: texto(d.proveedor),
      iva: aNumero(d.iva), unidad: texto(d.unidad)?.toLowerCase() ?? null, precio: aNumero(d.precio), coste: aNumero(d.coste), stock: aNumero(d.stock),
      stock_minimo: aNumero(d.stock_minimo), caducidad: aFecha(d.caducidad), vida_util_dias: aNumero(d.vida_util_dias),
      sin_control_stock: /^(no|0|false)$/i.test(String(d.control_stock ?? "").trim()),
    };
  });
}

export default function Importar({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const avisar = useAviso();
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [informe, setInforme] = useState<Informe | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nombre, setNombre] = useState("");

  const reiniciar = () => { setFilas(null); setInforme(null); setNombre(""); };
  const cerrar = () => { reiniciar(); alCerrar(); };

  /** Manda todo por partes y junta las respuestas. Las filas se renumeran para que coincidan con el fichero. */
  async function enviar(datos: Fila[], probar: boolean): Promise<Informe> {
    const total: Informe = { nuevos: 0, errores: 0, existentes: 0, filas: [] };
    let hechas = 0;
    for (const parte of trozos(datos)) {
      const r = await post<Informe>("/productos/importar", { filas: parte, probar });
      total.nuevos += r.nuevos; total.errores += r.errores; total.existentes += r.existentes;
      total.filas.push(...r.filas.map((f) => ({ ...f, fila: f.fila + hechas })));
      hechas += parte.length;
    }
    return total;
  }

  async function alElegir(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setOcupado(true); setInforme(null); setNombre(f.name);
    try {
      let tabla: Valor[][];
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        tabla = await readSheet(f) as Valor[][];
      } else if (/\.(csv|txt)$/i.test(f.name)) {
        tabla = leerCsv(await f.text());
      } else throw new Error("El fichero tiene que ser .xlsx o .csv. Si es un .xls antiguo, guárdalo antes como .xlsx.");
      const datos = aFilas(tabla);
      if (!datos.length) throw new Error("El fichero no tiene productos");
      setFilas(datos);
      setInforme(await enviar(datos, true));
    } catch (err) {
      avisar("error", (err as Error).message);
      reiniciar();
    } finally { setOcupado(false); }
  }

  async function importar() {
    if (!filas) return;
    setOcupado(true);
    try {
      const r = await enviar(filas, false);
      avisar("ok", `${r.nuevos} ${r.nuevos === 1 ? "producto importado" : "productos importados"}${r.existentes ? `, ${r.existentes} ya existían` : ""}`);
      emitirCambio();
      cerrar();
    } catch (err) { avisar("error", (err as Error).message); } finally { setOcupado(false); }
  }

  const problemas = informe?.filas.filter((f) => f.estado === "error") ?? [];

  return (
    <Modal abierto={abierto} alCerrar={cerrar} titulo="Importar productos desde Excel" ancho="max-w-lg">
      <div className="space-y-4 text-sm">
        <p className="text-suave">Hace falta nombre, categoría, IVA y precio. Lo que ya está en el catálogo (mismo nombre o código) no se toca, así que puedes repetir la importación sin miedo.</p>
        <div className="flex flex-wrap gap-2">
          <label className="boton cursor-pointer"><Upload className="size-4" /> Elegir fichero
            <input type="file" className="sr-only" accept=".xlsx,.csv,.txt" onChange={alElegir} disabled={ocupado} />
          </label>
          <button type="button" className="boton-sec" onClick={() => descargarCsv("plantilla_productos", EJEMPLO, COLUMNAS)}><Download className="size-4" /> Plantilla</button>
        </div>
        {ocupado && <Esqueleto className="h-24" />}
        {!ocupado && informe && (
          <>
            <p className="flex items-center gap-2 font-medium"><FileSpreadsheet className="size-4 text-marca-500" /> {nombre}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-superficie-2 p-3"><p className="text-xl font-bold tabular-nums">{informe.nuevos}</p><p className="text-xs text-tenue">nuevos</p></div>
              <div className="rounded-xl bg-superficie-2 p-3"><p className="text-xl font-bold tabular-nums">{informe.existentes}</p><p className="text-xs text-tenue">ya existen</p></div>
              <div className="rounded-xl bg-superficie-2 p-3"><p className={`text-xl font-bold tabular-nums ${informe.errores ? "text-rose-600 dark:text-rose-400" : ""}`}>{informe.errores}</p><p className="text-xs text-tenue">con error</p></div>
            </div>
            {problemas.length > 0 && (
              <>
                <p className="text-rose-700 dark:text-rose-300">Corrige estas filas en el fichero y vuelve a elegirlo. No se importa nada hasta que estén bien:</p>
                <ul className="max-h-52 divide-y divide-borde overflow-y-auto rounded-xl border border-borde">
                  {problemas.map((f) => <li key={f.fila} className="px-3 py-2">Fila <b>{f.fila + 1}</b>{f.nombre ? ` (${f.nombre})` : ""}: {f.detalle}</li>)}
                </ul>
              </>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="boton-sec" onClick={cerrar}>Cancelar</button>
              <button type="button" className="boton" disabled={!informe.nuevos || informe.errores > 0} onClick={importar}>Importar {informe.nuevos} {informe.nuevos === 1 ? "producto" : "productos"}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
