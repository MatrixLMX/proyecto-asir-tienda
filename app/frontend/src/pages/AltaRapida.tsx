import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Check, ScanBarcode } from "lucide-react";
import { api, diaISO, post } from "../api";
import { EscanerCamara } from "../escaner";
import { CampoNumero, Modal, emitirCambio, useAviso, useDatos } from "../ui";

interface Opcion { id: number; nombre: string; porcentaje?: number }
interface InfoCodigo {
  codigo: string;
  en_catalogo: { id: number; nombre: string; activo: number } | null;
  externo: { nombre: string; marca: string; cantidad: string } | null;
}

// Se recuerda la última categoría: al ir estantería por estantería, casi
// siempre se repite. El IVA (solo para el ticket) lo pone la categoría.
const CLAVE = "tienda_alta_rapida";
const leer = (): { categoria: number } => {
  try { return { categoria: 0, ...JSON.parse(localStorage.getItem(CLAVE) ?? "{}") }; } catch { return { categoria: 0 }; }
};
const guardarPreferencia = (categoria: number) => {
  try { localStorage.setItem(CLAVE, JSON.stringify({ categoria })); } catch { /* sin almacenamiento */ }
};

const nombreSugerido = (r: InfoCodigo) => {
  const e = r.externo;
  if (!e?.nombre) return "";
  const marca = e.marca && !e.nombre.toLowerCase().includes(e.marca.toLowerCase()) ? ` ${e.marca}` : "";
  const tam = e.cantidad && !e.nombre.toLowerCase().includes(e.cantidad.toLowerCase()) ? ` ${e.cantidad}` : "";
  return `${e.nombre}${marca}${tam}`.slice(0, 100);
};

const vacio = () => ({ codigo: "", nombre: "", stock: null as number | null, caducidad: "", pvp: null as number | null, coste: null as number | null });

/** Dar de alta productos uno detrás de otro escaneándolos con el móvil.
 *  Solo lo imprescindible; el precio se pone después (quedan como "sin precio"). */
export default function AltaRapida({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const categorias = useDatos<Opcion[]>("/categorias");
  const avisar = useAviso();
  const [camara, setCamara] = useState(false);
  const [d, setD] = useState(vacio);
  const [categoria, setCategoria] = useState(() => leer().categoria);
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [hechos, setHechos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const nombre = useRef<HTMLInputElement>(null);

  // Al abrir, directamente a la cámara
  useEffect(() => { if (abierto) { setD(vacio()); setAviso(null); setHechos([]); setCamara(true); } }, [abierto]);

  async function leido(codigo: string) {
    const c = codigo.trim();
    setD({ ...vacio(), codigo: c });
    setAviso(null);
    if (!/^\d{6,14}$/.test(c)) { setAviso("Eso no parece un código de barras: escríbelo o vuelve a escanear."); return; }
    setBuscando(true);
    try {
      const r = await api<InfoCodigo>(`/codigo/${c}`);
      if (r.en_catalogo) setAviso(`Ya está en el catálogo como "${r.en_catalogo.nombre}"${r.en_catalogo.activo ? "" : " (dado de baja)"}.`);
      else {
        const s = nombreSugerido(r);
        setD((x) => (x.codigo === c && !x.nombre ? { ...x, nombre: s } : x));
      }
    } catch { /* sin internet: se escribe el nombre a mano */ } finally {
      setBuscando(false);
      setTimeout(() => nombre.current?.focus(), 50);
    }
  }

  async function guardar(e: FormEvent, otro: boolean) {
    e.preventDefault();
    if (!d.nombre.trim() || !categoria) return;
    setEnviando(true);
    try {
      await post("/productos", {
        nombre: d.nombre.trim(), codigo_barras: d.codigo || null, categoria_id: categoria, unidad_medida: "unidad",
        precio_venta: d.pvp ?? 0, coste_compra: d.coste ?? 0,
        stock_inicial: d.stock ?? 0, controla_caducidad: !!d.caducidad, fecha_caducidad: d.stock && d.caducidad ? d.caducidad : null,
      });
      guardarPreferencia(categoria);
      setHechos((h) => [d.nombre.trim(), ...h]);
      emitirCambio();
      setD(vacio()); setAviso(null);
      if (otro) setCamara(true); else alCerrar();
    } catch (err) { avisar("error", (err as Error).message); } finally { setEnviando(false); }
  }

  // Los dos precios llevan el IVA incluido
  const margen = d.pvp && d.coste ? Math.round(((d.pvp - d.coste) / d.pvp) * 100) : null;

  const listo = !!d.nombre.trim() && !!categoria && !aviso?.startsWith("Ya está");

  return (
    <Modal abierto={abierto} alCerrar={alCerrar} titulo="Alta rápida escaneando">
      <form onSubmit={(e) => guardar(e, true)} className="space-y-4">
        <p className="text-sm text-suave">Escanea, revisa el nombre y guarda. Los precios puedes ponerlos aquí o después: sin precio de venta salen como <b>sin precio</b> en Catálogo y no se pueden vender hasta que lo tengan.</p>

        <div>
          <label className="etiqueta" htmlFor="ar-codigo">Código de barras</label>
          <div className="flex gap-2">
            <input id="ar-codigo" className="campo" inputMode="numeric" maxLength={20} placeholder="Escanéalo o escríbelo (opcional)" value={d.codigo}
              onChange={(e) => setD({ ...d, codigo: e.target.value.trim() })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); leido(d.codigo); } }} />
            <button type="button" className="boton shrink-0 px-3" onClick={() => setCamara(true)} aria-label="Escanear con la cámara"><Camera className="size-4" /></button>
          </div>
          {buscando && <p className="mt-1 text-xs text-tenue">Buscando el nombre…</p>}
          {aviso && <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{aviso}</p>}
        </div>

        <div>
          <label className="etiqueta" htmlFor="ar-nombre">Nombre</label>
          <input id="ar-nombre" ref={nombre} className="campo" required maxLength={100} placeholder="p. ej. Coca-Cola lata 33 cl" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="etiqueta" htmlFor="ar-cat">Categoría</label>
            <select id="ar-cat" className="campo" required value={categoria || ""} onChange={(e) => setCategoria(Number(e.target.value))}>
              <option value="">Elige…</option>{categorias.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="etiqueta" htmlFor="ar-pvp">Precio de venta (€)</label>
            <CampoNumero id="ar-pvp" placeholder="Opcional" valor={d.pvp} alCambiar={(n) => setD({ ...d, pvp: n })} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ar-coste">Precio de compra (€)</label>
            <CampoNumero id="ar-coste" decimales={4} placeholder="IVA incluido" valor={d.coste} alCambiar={(n) => setD({ ...d, coste: n })} />
          </div>
          {margen != null && (
            <p className={`col-span-2 -mt-1 text-xs ${margen < 0 ? "text-red-600 dark:text-red-400" : "text-tenue"}`}>
              Margen: {margen} %{margen < 0 ? " — lo vendes por debajo de lo que te cuesta" : ""}
            </p>
          )}
          <div>
            <label className="etiqueta" htmlFor="ar-stock">Cuántos hay</label>
            <CampoNumero id="ar-stock" decimales={0} placeholder="Opcional" valor={d.stock} alCambiar={(n) => setD({ ...d, stock: n })} />
          </div>
          <div>
            <label className="etiqueta" htmlFor="ar-cad">Caduca el (si caduca)</label>
            <input id="ar-cad" className="campo" type="date" min={diaISO()} value={d.caducidad} onChange={(e) => setD({ ...d, caducidad: e.target.value })} />
          </div>
        </div>
        {d.caducidad && !d.stock && <p className="-mt-2 text-xs text-tenue">Sin cantidad, solo se apunta que el producto caduca; la fecha irá con cada compra.</p>}

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="boton-sec" disabled={!listo || enviando} onClick={(e) => guardar(e, false)}>Guardar y terminar</button>
          <button className="boton" disabled={!listo || enviando}><ScanBarcode className="size-4" /> Guardar y otro</button>
        </div>

        {hechos.length > 0 && (
          <div className="rounded-xl bg-superficie-2 p-3 text-sm">
            <p className="mb-1 flex items-center gap-1.5 font-medium text-marca-fuerte"><Check className="size-4" /> {hechos.length} {hechos.length === 1 ? "producto añadido" : "productos añadidos"}</p>
            <p className="line-clamp-2 text-xs text-tenue">{hechos.join(" · ")}</p>
          </div>
        )}
      </form>
      <EscanerCamara abierto={camara} alCerrar={() => setCamara(false)} alLeer={leido} />
    </Modal>
  );
}
