import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Minus, Plus, Search, Trash2 } from "lucide-react";
import { cantidad, diaISO, euros, post } from "../api";
import { BotonEscanear, useLectorGlobal } from "../escaner";
import { Cabecera, CampoNumero, Confirmar, Esqueleto, Vacio, emitirCambio, useAviso, useDatos } from "../ui";
import type { ProductoAdmin } from "./Compras";

interface Contado { id: number; contado: number | null; caducidad: string }
const CLAVE = "tienda_recuento";

// Si se cierra la pestaña a medio contar en el móvil, no se pierde lo contado
const leerBorrador = (): Contado[] => { try { return JSON.parse(localStorage.getItem(CLAVE) ?? "[]"); } catch { return []; } };
const guardarBorrador = (c: Contado[]) => { try { localStorage.setItem(CLAVE, JSON.stringify(c)); } catch { /* sin almacenamiento */ } };

export default function Recuento() {
  const { datos: todos } = useDatos<ProductoAdmin[]>("/productos/admin");
  const avisar = useAviso();
  const [lineas, setLineas] = useState<Contado[]>(leerBorrador);
  const [q, setQ] = useState("");
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => guardarBorrador(lineas), [lineas]);

  const productos = useMemo(() => (todos ?? []).filter((p) => p.activo && p.control_stock), [todos]);
  const deId = (id: number) => productos.find((p) => p.id === id);
  const q2 = q.trim().toLowerCase();
  const resultados = q2 ? productos.filter((p) => !lineas.some((l) => l.id === p.id) && (p.nombre.toLowerCase().includes(q2) || p.codigo_barras === q2)).slice(0, 8) : [];

  const añadir = (p: ProductoAdmin) => { setLineas((l) => [{ id: p.id, contado: null, caducidad: "" }, ...l]); setQ(""); };
  const cambiar = (id: number, c: Partial<Contado>) => setLineas((l) => l.map((x) => (x.id === id ? { ...x, ...c } : x)));

  /** Cada lectura del código suma una unidad: se cuenta pasando la pistola por cada producto. */
  function leido(codigo: string) {
    const p = productos.find((x) => x.codigo_barras === codigo.trim());
    if (!p) { avisar("error", "Ese código no está en el catálogo, o el producto no lleva control de stock"); return; }
    const suma = p.unidad_medida === "unidad" ? 1 : 0;
    setLineas((l) => l.some((x) => x.id === p.id)
      ? l.map((x) => (x.id === p.id ? { ...x, contado: (x.contado ?? 0) + suma } : x))
      : [{ id: p.id, contado: suma || null, caducidad: "" }, ...l]);
  }
  useLectorGlobal(leido, !confirmando);

  const validas = lineas.filter((l) => l.contado != null && deId(l.id));
  const dif = (l: Contado) => (l.contado ?? 0) - (deId(l.id)?.stock_actual ?? 0);
  // Lo que falta a precio de coste: es la pérdida que va a verse en los beneficios
  const perdida = validas.reduce((s, l) => s + Math.max(-dif(l), 0) * (deId(l.id)?.coste_medio ?? 0), 0);
  const faltaFecha = validas.some((l) => { const p = deId(l.id)!; return dif(l) > 0 && p.controla_caducidad && !p.vida_util_dias && !l.caducidad; });

  async function guardar() {
    try {
      await post("/inventario/recuento", { lineas: validas.map((l) => ({ producto_id: l.id, contado: l.contado, fecha_caducidad: l.caducidad || null })) });
      avisar("ok", `Recuento guardado: ${validas.length} ${validas.length === 1 ? "producto" : "productos"}`);
      setLineas((ls) => ls.filter((l) => l.contado == null));
      emitirCambio();
    } catch (e) { avisar("error", (e as Error).message); }
  }

  return (
    <>
      <Cabecera titulo="Recuento" subtitulo="Escribe lo que hay de verdad en la estantería. Con la pistola, cada lectura suma una unidad." />
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-tenue" />
          <input className="campo py-3 pl-10" placeholder="Buscar producto o escanear…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && resultados[0]) añadir(resultados[0]); }} />
          {resultados.length > 0 && (
            <ul className="tarjeta absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto p-1 shadow-lg">
              {resultados.map((p) => (
                <li key={p.id}><button className="flex w-full justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-superficie-2" onClick={() => añadir(p)}>
                  <span className="font-medium">{p.nombre}</span><span className="shrink-0 text-tenue">{cantidad(p.stock_actual, p.unidad_medida)}</span>
                </button></li>
              ))}
            </ul>
          )}
        </div>
        <BotonEscanear alLeer={leido} className="boton-sec shrink-0 px-4" />
      </div>

      {!todos ? <Esqueleto className="h-48" /> : !lineas.length ? (
        <div className="tarjeta"><Vacio icono={<ClipboardCheck className="size-6" />} titulo="Aún no has contado nada">Busca o escanea el primer producto. No hace falta contar toda la tienda de una vez.</Vacio></div>
      ) : (
        <ul className="space-y-3">
          {lineas.map((l) => {
            const p = deId(l.id);
            if (!p) return null;
            const d = l.contado == null ? null : Math.round(dif(l) * 1000) / 1000;
            return (
              <li key={l.id} className="tarjeta p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="font-semibold">{p.nombre}</p><p className="text-xs text-tenue">Apuntado: {cantidad(p.stock_actual, p.unidad_medida)}</p></div>
                  <button className="rounded-lg p-1.5 text-tenue hover:text-rose-500" onClick={() => setLineas((x) => x.filter((y) => y.id !== l.id))} aria-label={`Quitar ${p.nombre}`}><Trash2 className="size-4" /></button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {p.unidad_medida === "unidad" && <button className="boton-sec p-2.5" onClick={() => cambiar(l.id, { contado: Math.max((l.contado ?? 0) - 1, 0) })} aria-label="Una menos"><Minus className="size-4" /></button>}
                  <CampoNumero aria-label={`Contado de ${p.nombre}`} className="campo w-24 py-2 text-center text-lg tabular-nums" decimales={p.unidad_medida === "kg" ? 3 : 0} placeholder="?" valor={l.contado} alCambiar={(n) => cambiar(l.id, { contado: n })} />
                  {p.unidad_medida === "unidad" && <button className="boton-sec p-2.5" onClick={() => cambiar(l.id, { contado: (l.contado ?? 0) + 1 })} aria-label="Una más"><Plus className="size-4" /></button>}
                  {d != null && (
                    <span className={`ml-auto text-sm font-semibold tabular-nums ${d === 0 ? "text-marca-fuerte" : d < 0 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {d === 0 ? "cuadra" : d < 0 ? `faltan ${cantidad(-d, p.unidad_medida)}` : `sobran ${cantidad(d, p.unidad_medida)}`}
                    </span>
                  )}
                </div>
                {d != null && d > 0 && !!p.controla_caducidad && (
                  <div className="mt-3">
                    <label className="etiqueta" htmlFor={`cad-${l.id}`}>Caducidad de lo que sobra{p.vida_util_dias ? ` (si no, ${p.vida_util_dias} días)` : ""}</label>
                    <input id={`cad-${l.id}`} className="campo" type="date" min={diaISO()} value={l.caducidad} onChange={(e) => cambiar(l.id, { caducidad: e.target.value })} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {lineas.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {faltaFecha && <p className="text-sm text-rose-600 dark:text-rose-400">Falta la caducidad de lo que sobra.</p>}
          <button className="boton py-3" disabled={!validas.length || faltaFecha} onClick={() => setConfirmando(true)}><ClipboardCheck className="size-4" /> Guardar recuento ({validas.length})</button>
        </div>
      )}

      <Confirmar abierto={confirmando} alCerrar={() => setConfirmando(false)} alConfirmar={guardar} titulo="Guardar recuento" textoBoton="Guardar"
        mensaje={<>El stock de <b>{validas.length}</b> {validas.length === 1 ? "producto" : "productos"} pasará a ser lo contado. Lo que falta se apunta como pérdida{perdida > 0 ? <> (<b>{euros(perdida)}</b> a precio de coste)</> : null} y lo que sobra se suma. Queda en el registro de cambios.</>} />
    </>
  );
}
