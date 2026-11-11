import { useRef, useState } from "react";
import { Camera, FileText, Image as ImageIcon, ImagePlus, Loader2, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { euros, patch, post } from "../api";
import { CampoNumero, Insignia, Modal, emitirCambio, useAviso, useDatos } from "../ui";
import { ElegirProveedor } from "./Catalogo";
import type { ProductoAdmin } from "./Compras";

interface Opcion { id: number; nombre: string; porcentaje?: number }

interface LineaLeida {
  descripcion: string; codigo_barras: string | null; es_producto: boolean; cantidad: number; por_kg: boolean;
  unidades_por_bulto: number; coste_unitario: number; iva: number | null; importe: number | null;
  producto_id: number | null; como: "aprendido" | "codigo" | "nombre" | null;
}
interface Leida {
  proveedor: string | null; nif_proveedor: string | null; proveedor_id: number | null; numero_factura: string | null; fecha: string | null;
  total_sin_iva: number | null; total_con_iva: number | null; lineas: LineaLeida[];
}

/** Lo que se pasa al formulario de compra para que el administrador lo guarde. */
export interface CompraLeida {
  proveedor: number | ""; factura: string;
  lineas: { producto_id: number; cantidad: number; coste_unitario: number; texto_factura: string }[];
}

// "nuevo": dar de alta · "no": quitada de la lista (portes, envases…) · número: producto del catálogo
type Destino = "nuevo" | "no" | number;
interface Fila {
  clave: number; leida: LineaLeida; destino: Destino; cantidad: number | null; coste: number | null;
  nombre: string; categoria: number; iva: number; pvp: number | null; caduca: boolean; porKg: boolean;
}

const CLAVE = "tienda_leer_factura";
const ultimaCategoria = () => { try { return Number(localStorage.getItem(CLAVE)) || 0; } catch { return 0; } };

// "AGUA MINERAL 1,5L" -> "Agua mineral 1,5L"
const bonito = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  const minus = t === t.toUpperCase() ? t.toLowerCase() : t;
  return (minus.charAt(0).toUpperCase() + minus.slice(1)).slice(0, 100);
};

/** Reduce la foto (las del móvil pesan varios MB) sin perder la letra pequeña. */
async function prepararPagina(f: File): Promise<{ tipo: string; datos: string; vista: string | null }> {
  const base64 = (b: Blob) => new Promise<string>((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => mal(new Error("No se ha podido leer el fichero"));
    r.readAsDataURL(b);
  });
  if (f.type === "application/pdf") {
    if (f.size > 8_000_000) throw new Error("El PDF es demasiado grande (máximo 8 MB)");
    return { tipo: f.type, datos: await base64(f), vista: null };
  }
  try {
    const img = await createImageBitmap(f);
    const escala = Math.min(1, 2200 / Math.max(img.width, img.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(img.width * escala);
    lienzo.height = Math.round(img.height * escala);
    lienzo.getContext("2d")!.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise<Blob>((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("No se ha podido preparar la foto"))), "image/jpeg", 0.85));
    return { tipo: "image/jpeg", datos: await base64(blob), vista: URL.createObjectURL(blob) };
  } catch {
    // El navegador no sabe abrirla (p. ej. HEIC): se manda tal cual
    if (f.size > 8_000_000) throw new Error("La foto es demasiado grande");
    return { tipo: f.type || "image/jpeg", datos: await base64(f), vista: null };
  }
}

/** Hacer foto a una factura o albarán y convertirla en una compra.
 *  Primero se eligen las páginas, luego se revisa lo leído línea a línea. */
export default function LeerFactura({ alCerrar, alCargar }: { alCerrar: () => void; alCargar: (c: CompraLeida) => void }) {
  const productos = useDatos<ProductoAdmin[]>("/productos/admin");
  const categorias = useDatos<Opcion[]>("/categorias");
  const ivas = useDatos<Opcion[]>("/tipos-iva");
  const avisar = useAviso();
  const [paginas, setPaginas] = useState<{ tipo: string; datos: string; vista: string | null; nombre: string }[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [leida, setLeida] = useState<Leida | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [proveedor, setProveedor] = useState<number | "">("");
  const [factura, setFactura] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [verFoto, setVerFoto] = useState(false);
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  async function añadir(ficheros: FileList | null) {
    if (!ficheros?.length) return;
    try {
      const nuevas = await Promise.all([...ficheros].map(async (f) => ({ ...(await prepararPagina(f)), nombre: f.name })));
      setPaginas((p) => [...p, ...nuevas].slice(0, 5));
      if (paginas.length + nuevas.length > 5) avisar("error", "Como mucho 5 páginas por factura");
    } catch (e) { avisar("error", (e as Error).message); }
  }

  const ivaId = (pct: number | null) => (ivas.datos ?? []).find((i) => i.porcentaje === pct)?.id ?? 0;

  async function leer() {
    setLeyendo(true);
    try {
      const r = await post<Leida>("/compras/leer-factura", { paginas: paginas.map(({ tipo, datos }) => ({ tipo, datos })) });
      const cat = ultimaCategoria();
      setLeida(r);
      setProveedor(r.proveedor_id ?? "");
      setFactura(r.numero_factura ?? "");
      setFilas(r.lineas.map((l, i) => ({
        clave: i, leida: l,
        destino: l.producto_id ?? (l.es_producto ? "nuevo" : "no"),
        cantidad: l.cantidad || null, coste: l.coste_unitario || null,
        nombre: bonito(l.descripcion), categoria: cat, iva: ivaId(l.iva), pvp: precioDe(l.producto_id), caduca: false, porKg: l.por_kg,
      })));
    } catch (e) { avisar("error", (e as Error).message); } finally { setLeyendo(false); }
  }

  const precioDe = (id: number | null) => productos.datos?.find((p) => p.id === id)?.precio_venta || null;
  const cambiarDestino = (f: Fila, v: string) => {
    const destino: Destino = v === "nuevo" ? "nuevo" : Number(v);
    // Al elegir un producto del catálogo se trae su precio de venta actual
    editar(f.clave, { destino, pvp: destino === "nuevo" ? f.pvp : precioDe(destino) });
  };
  const añadirFila = () => setFilas((fs) => [...fs, {
    clave: Math.max(0, ...fs.map((x) => x.clave)) + 1, destino: "nuevo", cantidad: 1, coste: null, nombre: "", categoria: ultimaCategoria(),
    iva: 0, pvp: null, caduca: false, porKg: false,
    leida: { descripcion: "", codigo_barras: null, es_producto: true, cantidad: 1, por_kg: false, unidades_por_bulto: 1, coste_unitario: 0, iva: null, importe: null, producto_id: null, como: null },
  }]);
  const editar = (clave: number, cambio: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)));

  async function añadirProveedor() {
    if (!leida?.proveedor) return;
    try {
      const r = await post<{ id: number }>("/proveedores", { nombre: leida.proveedor, notas: leida.nif_proveedor ? `NIF ${leida.nif_proveedor}` : null });
      setProveedor(r.id);
      emitirCambio();
      avisar("ok", `Proveedor "${leida.proveedor}" añadido`);
    } catch (e) { avisar("error", (e as Error).message); }
  }

  const usadas = filas.filter((f) => f.destino !== "no");
  const quitadas = filas.filter((f) => f.destino === "no");
  const nuevas = usadas.filter((f) => f.destino === "nuevo");
  const incompletas = usadas.filter((f) => !(f.cantidad && f.cantidad > 0) || (f.destino === "nuevo" && (!f.nombre.trim() || !f.categoria || !f.iva)));
  const sumaLineas = filas.filter((f) => f.destino !== "no" || !f.leida.es_producto).reduce((t, f) => t + (f.cantidad ?? 0) * (f.coste ?? 0), 0);
  const descuadre = leida?.total_sin_iva && Math.abs(sumaLineas - leida.total_sin_iva) > Math.max(0.05, leida.total_sin_iva * 0.01);

  async function pasarACompra() {
    setGuardando(true);
    const prov = proveedor || null;
    let actuales = filas;
    try {
      // Primero se dan de alta los productos nuevos. Si uno falla, los ya creados
      // quedan apuntados en su línea y no se repiten al volver a pulsar.
      for (const f of actuales.filter((x) => x.destino === "nuevo")) {
        const r = await post<{ id: number }>("/productos", {
          nombre: f.nombre.trim(), codigo_barras: f.leida.codigo_barras, categoria_id: f.categoria, iva_id: f.iva, proveedor_id: prov,
          unidad_medida: f.porKg ? "kg" : "unidad", coste_compra: f.coste ?? 0, precio_venta: f.pvp ?? 0, controla_caducidad: f.caduca,
        });
        actuales = actuales.map((x) => (x.clave === f.clave ? { ...x, destino: r.id } : x));
        setFilas(actuales);
        try { localStorage.setItem(CLAVE, String(f.categoria)); } catch { /* sin almacenamiento */ }
      }
      // Precios de venta cambiados en productos que ya existían
      for (const x of actuales) {
        const p = typeof x.destino === "number" ? productos.datos?.find((q) => q.id === x.destino) : undefined;
        if (p && x.pvp != null && x.pvp > 0 && x.pvp !== p.precio_venta) await patch(`/productos/${p.id}`, { precio_venta: x.pvp });
      }
      // Los productos que aún no tenían proveedor se quedan con este
      if (prov) {
        const sinProveedor = actuales.filter((x) => typeof x.destino === "number" && !productos.datos?.find((p) => p.id === x.destino)?.proveedor_id && productos.datos?.some((p) => p.id === x.destino));
        await Promise.all(sinProveedor.map((x) => patch(`/productos/${x.destino}`, { proveedor_id: prov }).catch(() => undefined)));
      }
      emitirCambio();
      alCargar({
        proveedor: proveedor, factura,
        lineas: actuales.filter((x) => typeof x.destino === "number").map((x) => ({
          producto_id: x.destino as number, cantidad: x.cantidad ?? 0, coste_unitario: x.coste ?? 0, texto_factura: x.leida.descripcion,
        })),
      });
    } catch (e) { avisar("error", (e as Error).message); } finally { setGuardando(false); }
  }

  const lista = (productos.datos ?? []).filter((p) => p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return (
    <Modal abierto alCerrar={alCerrar} titulo={leida ? "Revisar la factura" : "Leer factura con foto"} ancho={leida ? "max-w-3xl" : "max-w-md"}>
      {!leida ? (
        <div className="space-y-4">
          <p className="text-sm text-suave">Haz una foto de frente y con buena luz a cada página de la factura o albarán (o elige un PDF). Luego revisas lo leído antes de guardar nada.</p>
          <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { añadir(e.target.files); e.target.value = ""; }} />
          <input ref={galeria} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { añadir(e.target.files); e.target.value = ""; }} />
          {paginas.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {paginas.map((p, i) => (
                <li key={i} className="relative overflow-hidden rounded-xl border border-borde bg-superficie-2">
                  {p.vista ? <img src={p.vista} alt={`Página ${i + 1}`} className="h-28 w-full object-cover object-top" />
                    : <div className="flex h-28 flex-col items-center justify-center gap-1 p-2 text-center text-xs text-tenue"><FileText className="size-6" /><span className="line-clamp-2 break-all">{p.nombre}</span></div>}
                  <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 text-xs font-medium text-white">{i + 1}</span>
                  <button type="button" className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white" aria-label={`Quitar página ${i + 1}`}
                    onClick={() => setPaginas((ps) => ps.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="boton-sec" disabled={paginas.length >= 5 || leyendo} onClick={() => camara.current?.click()}>
              <Camera className="size-4" /> {paginas.length ? "Otra página" : "Hacer foto"}
            </button>
            <button type="button" className="boton-sec" disabled={paginas.length >= 5 || leyendo} onClick={() => galeria.current?.click()}>
              <ImagePlus className="size-4" /> Foto o PDF
            </button>
          </div>
          <button type="button" className="boton w-full py-3" disabled={!paginas.length || leyendo} onClick={leer}>
            {leyendo ? <><Loader2 className="size-4 animate-spin" /> Leyendo la factura…</> : <><Sparkles className="size-4" /> Leer {paginas.length > 1 ? `${paginas.length} páginas` : "factura"}</>}
          </button>
          {leyendo && <p className="text-center text-xs text-tenue">Puede tardar hasta medio minuto.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="etiqueta" htmlFor="lf-prov">Proveedor</label>
              <ElegirProveedor id="lf-prov" valor={proveedor} alCambiar={setProveedor} vacio="Sin proveedor" />
              {!proveedor && leida.proveedor && (
                <p className="mt-1.5 text-xs text-suave">En la factura pone <b>{leida.proveedor}</b>. <button type="button" className="font-medium text-marca-fuerte hover:underline" onClick={añadirProveedor}>Añadirlo a tus proveedores</button></p>
              )}
            </div>
            <div>
              <label className="etiqueta" htmlFor="lf-num">Nº de factura o albarán</label>
              <input id="lf-num" className="campo" maxLength={40} value={factura} onChange={(e) => setFactura(e.target.value)} />
            </div>
          </div>

          {paginas.some((p) => p.vista) && (
            <div>
              <button type="button" className="flex items-center gap-1.5 text-sm font-medium text-marca-fuerte hover:underline" onClick={() => setVerFoto(!verFoto)}>
                <ImageIcon className="size-4" /> {verFoto ? "Ocultar la factura" : "Ver la factura para comparar"}
              </button>
              {verFoto && (
                <div className="mt-2 max-h-[50vh] space-y-2 overflow-auto rounded-xl border border-borde bg-superficie-2 p-2">
                  {paginas.filter((p) => p.vista).map((p, i) => <img key={i} src={p.vista!} alt={`Página ${i + 1} de la factura`} className="w-full rounded-lg" />)}
                </div>
              )}
            </div>
          )}

          <div>
            <h3 className="mb-2 flex items-baseline justify-between font-semibold">
              Productos de la factura <span className="text-sm font-normal text-tenue">{usadas.length}</span>
            </h3>
            <ul className="space-y-2">
              {usadas.map((f) => {
                const l = f.leida;
                const actual = typeof f.destino === "number" ? productos.datos?.find((p) => p.id === f.destino) : undefined;
                const kg = f.destino === "nuevo" ? f.porKg : actual?.unidad_medida === "kg";
                const pctIva = actual ? actual.iva : ivas.datos?.find((i) => i.id === f.iva)?.porcentaje;
                const base = f.pvp && pctIva != null ? f.pvp / (1 + pctIva / 100) : null;
                const margen = base && f.coste ? ((base - f.coste) / base) * 100 : null;
                const insignia = f.destino === "nuevo" ? <Insignia color="azul">nuevo</Insignia>
                  : f.destino === l.producto_id && l.como === "nombre" ? <Insignia color="ambar">¿es este?</Insignia>
                  : <Insignia color="verde">{f.destino === l.producto_id && l.como === "aprendido" ? "reconocido" : "ya lo tienes"}</Insignia>;
                return (
                  <li key={f.clave} className="rounded-2xl border border-borde bg-superficie-2/50 p-3">
                    <div className="mb-2 flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        {l.descripcion ? (
                          <p className="text-xs text-tenue">En la factura: <span className="font-medium text-suave">{l.descripcion}</span>
                            {l.unidades_por_bulto > 1 ? ` · cajas de ${l.unidades_por_bulto}` : ""}{l.importe != null ? ` · ${euros(l.importe)}` : ""}</p>
                        ) : <p className="text-xs text-tenue">Añadido a mano</p>}
                      </div>
                      {insignia}
                      <button type="button" className="-m-1 rounded-lg p-1 text-tenue hover:text-rose-500" aria-label="Quitar de la lista" onClick={() => editar(f.clave, { destino: "no" })}>
                        <Trash2 className="size-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="col-span-2">
                        <label className="etiqueta" htmlFor={`lf-p-${f.clave}`}>Producto</label>
                        <select id={`lf-p-${f.clave}`} className="campo" value={String(f.destino)} onChange={(e) => cambiarDestino(f, e.target.value)}>
                          <option value="nuevo">➕ Nuevo (darlo de alta)</option>
                          <optgroup label="Ya en tu catálogo">{lista.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</optgroup>
                        </select>
                      </div>
                      {f.destino === "nuevo" && <>
                        <div className="col-span-2">
                          <label className="etiqueta" htmlFor={`lf-n-${f.clave}`}>Nombre en la tienda</label>
                          <input id={`lf-n-${f.clave}`} className="campo" maxLength={100} placeholder="p. ej. Galletas de chocolate" value={f.nombre} onChange={(e) => editar(f.clave, { nombre: e.target.value })} />
                        </div>
                        <div>
                          <label className="etiqueta" htmlFor={`lf-cat-${f.clave}`}>Categoría</label>
                          <select id={`lf-cat-${f.clave}`} className="campo" value={f.categoria || ""} onChange={(e) => editar(f.clave, { categoria: Number(e.target.value) })}>
                            <option value="">Elige…</option>{categorias.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="etiqueta" htmlFor={`lf-iva-${f.clave}`}>IVA</label>
                          <select id={`lf-iva-${f.clave}`} className="campo" value={f.iva || ""} onChange={(e) => editar(f.clave, { iva: Number(e.target.value) })}>
                            <option value="">Elige…</option>{ivas.datos?.map((c) => <option key={c.id} value={c.id}>{c.porcentaje} %</option>)}
                          </select>
                        </div>
                        <div className="col-span-2 flex items-end gap-4 pb-2">
                          <label className="flex items-center gap-2 text-sm text-suave">
                            <input type="checkbox" className="size-4 accent-emerald-600" checked={f.porKg} onChange={(e) => editar(f.clave, { porKg: e.target.checked })} /> Se vende por kg
                          </label>
                          <label className="flex items-center gap-2 text-sm text-suave">
                            <input type="checkbox" className="size-4 accent-emerald-600" checked={f.caduca} onChange={(e) => editar(f.clave, { caduca: e.target.checked })} /> Caduca
                          </label>
                        </div>
                      </>}
                      <div>
                        <label className="etiqueta" htmlFor={`lf-c-${f.clave}`}>Cantidad ({kg ? "kg" : "uds."})</label>
                        <CampoNumero id={`lf-c-${f.clave}`} decimales={kg ? 3 : 0} valor={f.cantidad} alCambiar={(n) => editar(f.clave, { cantidad: n })} />
                      </div>
                      <div>
                        <label className="etiqueta" htmlFor={`lf-k-${f.clave}`}>Compra sin IVA</label>
                        <CampoNumero id={`lf-k-${f.clave}`} decimales={4} valor={f.coste} alCambiar={(n) => editar(f.clave, { coste: n })} />
                      </div>
                      <div>
                        <label className="etiqueta" htmlFor={`lf-pvp-${f.clave}`}>Venta con IVA</label>
                        <CampoNumero id={`lf-pvp-${f.clave}`} placeholder="Luego" valor={f.pvp} alCambiar={(n) => editar(f.clave, { pvp: n })} />
                      </div>
                      <div className="flex flex-col justify-end pb-2 text-xs text-tenue">
                        <span>Subtotal <b className="text-suave">{euros((f.cantidad ?? 0) * (f.coste ?? 0))}</b></span>
                        {margen != null && <span className={margen < 0 ? "font-medium text-rose-600 dark:text-rose-400" : ""}>Margen {Math.round(margen)} %</span>}
                      </div>
                    </div>

                    {actual && f.coste != null && actual.coste_medio > 0 && Math.abs(f.coste - actual.coste_medio) / actual.coste_medio > 0.15 && (
                      <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">Hasta ahora te costaba {euros(actual.coste_medio)}: comprueba que es el mismo producto y la cantidad por caja.</p>
                    )}
                    {actual && f.pvp != null && f.pvp > 0 && f.pvp !== actual.precio_venta && (
                      <p className="mt-1.5 text-xs text-sky-700 dark:text-sky-300">El precio de venta cambiará de {actual.precio_venta ? euros(actual.precio_venta) : "sin precio"} a {euros(f.pvp)}.</p>
                    )}
                  </li>
                );
              })}
            </ul>
            <button type="button" className="boton-sec mt-2 w-full border-dashed" onClick={añadirFila}><Plus className="size-4" /> Añadir un producto que falta</button>
          </div>

          {quitadas.length > 0 && (
            <div className="rounded-xl border border-borde p-3">
              <p className="mb-1 text-xs font-medium text-tenue">No se añaden ({quitadas.length})</p>
              <ul className="divide-y divide-borde text-sm">
                {quitadas.map((f) => (
                  <li key={f.clave} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate text-suave">{f.leida.descripcion || f.nombre || "Línea vacía"}{f.leida.importe != null ? ` · ${euros(f.leida.importe)}` : ""}</span>
                    <button type="button" className="shrink-0 text-xs font-medium text-marca-fuerte hover:underline"
                      onClick={() => editar(f.clave, { destino: f.leida.producto_id ?? "nuevo" })}>Añadir</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {descuadre ? (
            <p className="flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlert className="size-4 shrink-0" />
              <span>Las líneas suman {euros(sumaLineas)} sin IVA y la factura dice {euros(leida.total_sin_iva!)}. Revisa cantidades y precios antes de seguir.</span>
            </p>
          ) : leida.total_sin_iva ? <p className="text-xs text-tenue">Las líneas cuadran con el total de la factura ({euros(leida.total_sin_iva)} sin IVA).</p> : null}

          <div className="sticky -bottom-6 -mx-1 -mb-6 flex flex-col gap-2 border-t border-borde bg-superficie px-1 pb-6 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-tenue">{usadas.length} productos{nuevas.length ? ` · ${nuevas.length} nuevos` : ""}{incompletas.length ? ` · faltan datos en ${incompletas.length}` : ""}</p>
            <button className="boton" disabled={!usadas.length || incompletas.length > 0 || guardando} onClick={pasarACompra}>
              {guardando ? <Loader2 className="size-4 animate-spin" /> : null} Pasar a la compra
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
