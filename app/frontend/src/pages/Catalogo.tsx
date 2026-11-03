import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Download, FolderPlus, PackagePlus, Pencil, Phone, Plus, Search, Truck, X } from "lucide-react";
import { api, cantidad, descargarCsv, diaISO, euros, fecha, patch, post } from "../api";
import { BotonEscanear } from "../escaner";
import { Cabecera, CampoNumero, Esqueleto, Insignia, Modal, Pestañas, emitirCambio, useAviso, useDatos } from "../ui";
import type { ProductoAdmin } from "./Compras";

interface Opcion { id: number; nombre: string; porcentaje?: number }
interface Categoria { id: number; nombre: string; activa: number; productos: number }
interface Proveedor { id: number; nombre: string; contacto: string | null; telefono: string | null; email: string | null; notas: string | null; activo: number }

interface FormProducto {
  nombre: string; codigo_barras: string; categoria_id: number; proveedor_id: number; iva_id: number; unidad_medida: "unidad" | "kg";
  precio_venta: number | null; coste: number | null; stock_minimo: number | null; stock_inicial: number | null; fecha_caducidad: string;
  controla_caducidad: boolean; vida_util_dias: number | null; dias_aviso_caducidad: number | null; activo: boolean;
}
const productoVacio: FormProducto = {
  nombre: "", codigo_barras: "", categoria_id: 0, proveedor_id: 0, iva_id: 0, unidad_medida: "unidad",
  precio_venta: null, coste: null, stock_minimo: null, stock_inicial: null, fecha_caducidad: "",
  controla_caducidad: false, vida_util_dias: null, dias_aviso_caducidad: 5, activo: true,
};
const proveedorVacio = { nombre: "", contacto: "", telefono: "", email: "", notas: "", activo: 1 };

interface InfoCodigo {
  codigo: string;
  en_catalogo: { id: number; nombre: string; activo: number } | null;
  externo: { nombre: string; marca: string; cantidad: string; categorias: string } | null;
}

/** Vender guarda aquí un código que no está en el catálogo para crearlo. */
export const CLAVE_CODIGO_NUEVO = "tienda_codigo_nuevo";

const margenDe = (precio: number, iva: number, coste: number) => {
  const base = precio / (1 + iva / 100);
  return base ? ((base - coste) / base) * 100 : 0;
};
const pct = (n: number) => `${n.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;
const redondear = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const MARGEN_OBJETIVO = 30;

export default function Catalogo() {
  const [vista, setVista] = useState<"productos" | "categorias" | "proveedores">("productos");
  return (
    <>
      <Cabecera titulo="Catálogo" subtitulo="Productos, categorías y proveedores">
        <Pestañas valor={vista} alCambiar={setVista} opciones={[
          { id: "productos", nombre: "Productos" }, { id: "categorias", nombre: "Categorías" }, { id: "proveedores", nombre: "Proveedores" },
        ]} />
      </Cabecera>
      {vista === "productos" ? <Productos /> : vista === "categorias" ? <Categorias /> : <Proveedores />}
    </>
  );
}

function useEjecutar() {
  const avisar = useAviso();
  return async (accion: () => Promise<unknown>, ok: string) => {
    try { await accion(); avisar("ok", ok); emitirCambio(); return true; } catch (e) { avisar("error", (e as Error).message); return false; }
  };
}

/** Desplegable de proveedores con un botón para dar de alta uno nuevo sin
 *  salir del formulario. Se usa también en Compras. */
export function ElegirProveedor({ id, valor, alCambiar, vacio = "Ninguno" }: {
  id: string; valor: number | ""; alCambiar: (v: number | "") => void; vacio?: string;
}) {
  const { datos, recargar } = useDatos<Opcion[]>("/proveedores");
  const avisar = useAviso();
  const [nuevo, setNuevo] = useState<string | null>(null);

  async function crear() {
    if (!nuevo?.trim()) return;
    const ya = datos?.find((p) => p.nombre.toLowerCase() === nuevo.trim().toLowerCase());
    if (ya) { alCambiar(ya.id); setNuevo(null); return; }
    try {
      const r = await post<{ id: number; nombre: string }>("/proveedores", { nombre: nuevo.trim() });
      avisar("ok", `Proveedor "${r.nombre}" añadido. Sus datos de contacto se completan en Catálogo → Proveedores.`);
      recargar();
      emitirCambio();
      alCambiar(r.id);
      setNuevo(null);
    } catch (e) { avisar("error", (e as Error).message); }
  }

  if (nuevo != null) return (
    <div className="flex gap-2">
      <input id={id} className="campo" autoFocus maxLength={80} placeholder="Nombre del proveedor" value={nuevo}
        onChange={(e) => setNuevo(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); crear(); } if (e.key === "Escape") { e.stopPropagation(); setNuevo(null); } }} />
      <button type="button" className="boton px-3" disabled={!nuevo.trim()} onClick={crear}>Añadir</button>
      <button type="button" className="boton-sec px-3" onClick={() => setNuevo(null)} aria-label="Cancelar"><X className="size-4" /></button>
    </div>
  );
  return (
    <div className="flex gap-2">
      <select id={id} className="campo" value={valor} onChange={(e) => alCambiar(e.target.value ? Number(e.target.value) : "")}>
        <option value="">{vacio}</option>{datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
      <button type="button" className="boton-sec shrink-0 px-3" onClick={() => setNuevo("")} title="Nuevo proveedor" aria-label="Nuevo proveedor"><Plus className="size-4" /></button>
    </div>
  );
}

/* =====================================================================
   Productos
   ===================================================================== */
function Productos() {
  const productos = useDatos<ProductoAdmin[]>("/productos/admin");
  const categorias = useDatos<Opcion[]>("/categorias");
  const ivas = useDatos<Opcion[]>("/tipos-iva");
  const ejecutar = useEjecutar();
  const [q, setQ] = useState("");
  const [bajas, setBajas] = useState(false);
  // null: cerrado · {id: null}: nuevo · {id: n}: editando
  const [form, setForm] = useState<{ id: number | null; datos: FormProducto; actual?: ProductoAdmin } | null>(null);
  const [info, setInfo] = useState<InfoCodigo | "buscando" | null>(null);

  const filas = useMemo(() => (productos.datos ?? []).filter((p) => (bajas || p.activo) &&
    `${p.nombre} ${p.categoria} ${p.proveedor ?? ""} ${p.codigo_barras ?? ""}`.toLowerCase().includes(q.toLowerCase())), [productos.datos, q, bajas]);

  const nuevo = (codigo = "") => { setInfo(null); setForm({ id: null, datos: { ...productoVacio, codigo_barras: codigo } }); if (codigo) buscarCodigo(codigo, true); };

  // Viene de Vender con un código que no estaba en el catálogo
  useEffect(() => {
    let codigo: string | null = null;
    try { codigo = sessionStorage.getItem(CLAVE_CODIGO_NUEVO); sessionStorage.removeItem(CLAVE_CODIGO_NUEVO); } catch { /* sin almacenamiento */ }
    if (codigo) nuevo(codigo);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const editar = (p: ProductoAdmin) => { setInfo(null); setForm({
    id: p.id, actual: p, datos: {
      nombre: p.nombre, codigo_barras: p.codigo_barras ?? "", categoria_id: p.categoria_id, proveedor_id: p.proveedor_id ?? 0,
      iva_id: (ivas.datos ?? []).find((i) => i.porcentaje === p.iva)?.id ?? 0, unidad_medida: p.unidad_medida,
      precio_venta: p.precio_venta, coste: redondear(p.coste_medio), stock_minimo: p.stock_minimo, stock_inicial: null, fecha_caducidad: "",
      controla_caducidad: !!p.controla_caducidad, vida_util_dias: p.vida_util_dias, dias_aviso_caducidad: p.dias_aviso_caducidad ?? 5, activo: !!p.activo,
    },
  }); };

  const campo = <K extends keyof FormProducto>(k: K, v: FormProducto[K]) => setForm((f) => f && { ...f, datos: { ...f.datos, [k]: v } });

  /** Busca el código en el catálogo y en Open Food Facts. */
  async function buscarCodigo(codigo: string, rellenar: boolean) {
    const c = codigo.trim();
    if (!/^\d{6,14}$/.test(c)) { setInfo(null); return; }
    setInfo("buscando");
    try {
      const r = await api<InfoCodigo>(`/codigo/${c}`);
      setInfo(r);
      const sugerido = nombreSugerido(r);
      if (rellenar && sugerido) setForm((f) => f && !f.datos.nombre ? { ...f, datos: { ...f.datos, nombre: sugerido } } : f);
    } catch { setInfo(null); }
  }
  const leido = (c: string) => { campo("codigo_barras", c); buscarCodigo(c, true); };

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const d = form.datos;
    const caduca = d.controla_caducidad;
    const cuerpo = {
      nombre: d.nombre.trim(), codigo_barras: d.codigo_barras.trim() || null, categoria_id: d.categoria_id, proveedor_id: d.proveedor_id || null,
      iva_id: d.iva_id, precio_venta: d.precio_venta ?? 0, stock_minimo: d.stock_minimo ?? 0, controla_caducidad: caduca,
      vida_util_dias: caduca && d.vida_util_dias ? d.vida_util_dias : null, dias_aviso_caducidad: d.dias_aviso_caducidad ?? 5,
    };
    let ok: boolean;
    if (form.id == null) {
      const hayStock = !!d.stock_inicial;
      ok = await ejecutar(() => post("/productos", {
        ...cuerpo, unidad_medida: d.unidad_medida, coste_compra: d.coste, stock_inicial: d.stock_inicial,
        fecha_caducidad: caduca && hayStock && d.fecha_caducidad ? d.fecha_caducidad : null,
      }), hayStock ? `"${cuerpo.nombre}" creado con ${cantidad(d.stock_inicial!, d.unidad_medida)} en stock.`
        : `"${cuerpo.nombre}" creado. Cuando llegue mercancía, regístrala en Compras.`);
    } else {
      const coste = d.coste != null && d.coste !== redondear(form.actual!.coste_medio) ? { coste_medio: d.coste } : {};
      ok = await ejecutar(() => patch(`/productos/${form.id}`, { ...cuerpo, ...coste, activo: d.activo }), `${cuerpo.nombre} guardado`);
    }
    if (ok) setForm(null);
  }

  const ivaElegido = ivas.datos?.find((i) => i.id === form?.datos.iva_id)?.porcentaje;
  const porKg = form?.datos.unidad_medida === "kg" ? "/kg" : "";
  const hoyMas = (dias: number) => fecha(diaISO(dias));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1 sm:max-w-md">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-tenue" />
          <input className="campo pl-10" placeholder="Buscar por producto, categoría, proveedor o código…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-suave">
          <input type="checkbox" className="size-4 accent-emerald-600" checked={bajas} onChange={(e) => setBajas(e.target.checked)} /> Ver dados de baja
        </label>
        <div className="ml-auto flex gap-2">
          <button className="boton-sec" disabled={!filas.length} onClick={() => descargarCsv("catalogo", filas.map((p) => ({ ...p, margen: margenDe(p.precio_venta, p.iva, p.coste_medio) })), [
            ["nombre", "Producto"], ["codigo_barras", "Código"], ["categoria", "Categoría"], ["proveedor", "Proveedor"], ["iva", "IVA %"],
            ["coste_medio", "Coste sin IVA"], ["precio_venta", "PVP"], ["margen", "Margen %"], ["stock_actual", "Stock"], ["unidad_medida", "Unidad"]])}>
            <Download className="size-4" /> CSV
          </button>
          <button className="boton" onClick={() => nuevo()}><PackagePlus className="size-4" /> Producto</button>
        </div>
      </div>

      <div className="tarjeta overflow-x-auto">
        {!productos.datos ? (
          <div className="space-y-2 p-5">{Array.from({ length: 8 }, (_, i) => <Esqueleto key={i} className="h-12" />)}</div>
        ) : (
          <table className="tabla w-full text-sm">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="hidden md:table-cell">Proveedor</th>
                <th className="text-right">Coste</th>
                <th className="text-right">PVP</th>
                <th className="text-right">Margen</th>
                <th className="hidden text-right sm:table-cell">Stock</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filas.map((p) => {
                const margen = margenDe(p.precio_venta, p.iva, p.coste_medio);
                return (
                  <tr key={p.id} className={p.activo ? "" : "opacity-50"}>
                    <td>
                      <p className="font-medium">{p.nombre} {!p.activo && <Insignia color="gris">de baja</Insignia>}</p>
                      <p className="text-xs text-tenue">{p.categoria} · IVA {p.iva} %{p.controla_caducidad ? " · caduca" : ""}{p.codigo_barras ? ` · ${p.codigo_barras}` : ""}</p>
                    </td>
                    <td className="hidden text-suave md:table-cell">{p.proveedor ?? "—"}</td>
                    <td className="text-right tabular-nums text-suave">{p.coste_medio ? euros(p.coste_medio) : <span className="text-amber-600 dark:text-amber-400">sin coste</span>}</td>
                    <td className="text-right font-semibold tabular-nums">{euros(p.precio_venta)}</td>
                    <td className="text-right">{p.coste_medio ? <Insignia color={margen >= 25 ? "verde" : margen >= 10 ? "ambar" : "rojo"}>{pct(margen)}</Insignia> : <span className="text-tenue">—</span>}</td>
                    <td className="hidden text-right tabular-nums sm:table-cell">{cantidad(p.stock_actual, p.unidad_medida)}</td>
                    <td className="text-right">
                      <button className="rounded-lg p-1.5 text-tenue hover:bg-superficie-2 hover:text-texto" onClick={() => editar(p)} aria-label={`Editar ${p.nombre}`}>
                        <Pencil className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal abierto={!!form} alCerrar={() => setForm(null)} titulo={form?.id == null ? "Nuevo producto" : `Editar ${form.actual?.nombre}`} ancho="max-w-2xl">
        {form && (() => {
          const d = form.datos;
          const base = d.precio_venta != null && ivaElegido != null ? d.precio_venta / (1 + ivaElegido / 100) : null;
          const beneficio = base != null && d.coste != null ? base - d.coste : null;
          const sugerido = d.coste && ivaElegido != null ? Math.ceil((d.coste * (1 + ivaElegido / 100)) / (1 - MARGEN_OBJETIVO / 100) * 20) / 20 : null;
          return (
          <form onSubmit={guardar} className="grid max-h-[72vh] gap-4 overflow-y-auto px-0.5 sm:grid-cols-2">
            <Seccion>Producto</Seccion>
            <div className="sm:col-span-2">
              <label className="etiqueta" htmlFor="p-codigo">Código de barras</label>
              <div className="flex gap-2">
                <input id="p-codigo" className="campo" inputMode="numeric" maxLength={20} placeholder="Opcional: escanéalo o escríbelo" value={d.codigo_barras}
                  onChange={(e) => campo("codigo_barras", e.target.value.trim())}
                  onBlur={() => d.codigo_barras && buscarCodigo(d.codigo_barras, !d.nombre)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscarCodigo(d.codigo_barras, true); } }} />
                <BotonEscanear alLeer={leido} className="boton-sec shrink-0 px-3" />
              </div>
              <InfoDelCodigo info={info} propio={form.id} alUsarNombre={(n) => campo("nombre", n)} />
            </div>
            <div className="sm:col-span-2"><label className="etiqueta" htmlFor="p-nombre">Nombre</label><input id="p-nombre" className="campo" required maxLength={100} autoFocus value={d.nombre} onChange={(e) => campo("nombre", e.target.value)} placeholder="p. ej. Coca-Cola lata 33 cl" /></div>
            <div>
              <span className="etiqueta">Se vende por</span>
              <div className="grid grid-cols-2 gap-2">
                {(["unidad", "kg"] as const).map((u) => (
                  <button type="button" key={u} disabled={form.id != null} onClick={() => campo("unidad_medida", u)}
                    title={form.id != null ? "No se puede cambiar en un producto que ya existe" : undefined}
                    className={`rounded-xl border py-2.5 text-sm font-medium disabled:cursor-not-allowed ${d.unidad_medida === u ? "border-marca-500 bg-marca-suave text-marca-fuerte" : "border-borde text-suave disabled:opacity-50"}`}>
                    {u === "unidad" ? "Unidades" : "Peso (kg)"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="etiqueta" htmlFor="p-cat">Categoría</label>
              <select id="p-cat" className="campo" required value={d.categoria_id || ""} onChange={(e) => campo("categoria_id", Number(e.target.value))}>
                <option value="">Elige…</option>{categorias.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="p-prov">Proveedor habitual</label>
              <ElegirProveedor id="p-prov" valor={d.proveedor_id || ""} alCambiar={(v) => campo("proveedor_id", v || 0)} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="p-iva">IVA</label>
              <select id="p-iva" className="campo" required value={d.iva_id || ""} onChange={(e) => campo("iva_id", Number(e.target.value))}>
                <option value="">Elige…</option>{ivas.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.porcentaje} %)</option>)}
              </select>
            </div>

            <Seccion>Precios</Seccion>
            <div>
              <label className="etiqueta" htmlFor="p-coste">{form.id == null ? "Precio de compra" : "Coste medio"} sin IVA (€{porKg})</label>
              <CampoNumero id="p-coste" decimales={4} placeholder="El de la factura del proveedor" valor={d.coste} alCambiar={(n) => campo("coste", n)} />
              <p className="mt-1 text-xs text-tenue">
                {form.id == null ? "Opcional, pero sin él no se puede calcular el beneficio." : "Se recalcula solo con cada compra. Cámbialo solo para corregirlo."}
                {d.coste != null && ivaElegido != null && <> Con IVA: {euros(d.coste * (1 + ivaElegido / 100))}.</>}
              </p>
            </div>
            <div>
              <label className="etiqueta" htmlFor="p-pvp">Precio de venta, con IVA (€{porKg})</label>
              <CampoNumero id="p-pvp" required placeholder="Lo que paga el cliente" valor={d.precio_venta} alCambiar={(n) => campo("precio_venta", n)} />
              {sugerido != null && d.precio_venta == null && (
                <button type="button" className="mt-1 text-xs font-medium text-marca-fuerte hover:underline" onClick={() => campo("precio_venta", sugerido)}>
                  Para ganar un {MARGEN_OBJETIVO} %: {euros(sugerido)} (usar)
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-superficie-2 p-3 text-center text-sm sm:col-span-2">
              <Dato titulo="Venta sin IVA" valor={base != null ? euros(base) : "—"} />
              <Dato titulo={`Beneficio por ${d.unidad_medida === "kg" ? "kg" : "unidad"}`} valor={beneficio != null ? euros(beneficio) : "—"}
                color={beneficio == null ? "" : beneficio < 0 ? "text-rose-600 dark:text-rose-400" : "text-marca-fuerte"} />
              <Dato titulo="Margen" valor={beneficio != null && base ? pct((beneficio / base) * 100) : "—"} />
              {(d.coste == null || ivaElegido == null) && <p className="col-span-3 text-xs text-tenue">Pon el IVA, el precio de compra y el de venta para ver lo que ganas.</p>}
            </div>

            <Seccion>Stock</Seccion>
            {form.id == null ? (
              <div>
                <label className="etiqueta" htmlFor="p-stock">Cuánto tienes ahora ({d.unidad_medida === "kg" ? "kg" : "uds."})</label>
                <CampoNumero id="p-stock" decimales={d.unidad_medida === "kg" ? 3 : 0} placeholder="0" valor={d.stock_inicial} alCambiar={(n) => campo("stock_inicial", n)} />
                <p className="mt-1 text-xs text-tenue">Se apunta como una compra de "stock inicial". Lo que llegue después, en Compras.</p>
              </div>
            ) : (
              <p className="self-start rounded-xl bg-superficie-2 px-4 py-3 text-sm text-suave">
                Stock actual: <b className="text-texto">{cantidad(form.actual!.stock_actual, d.unidad_medida)}</b>
                <span className="block text-xs">Sube con las compras y baja con las ventas y las mermas.</span>
              </p>
            )}
            <div>
              <label className="etiqueta" htmlFor="p-min">Avisar cuando queden menos de</label>
              <CampoNumero id="p-min" decimales={d.unidad_medida === "kg" ? 3 : 0} placeholder="0 (sin aviso)" valor={d.stock_minimo} alCambiar={(n) => campo("stock_minimo", n)} />
            </div>

            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-borde p-3 text-sm sm:col-span-2">
              <input type="checkbox" className="size-4 accent-emerald-600" checked={d.controla_caducidad} onChange={(e) => campo("controla_caducidad", e.target.checked)} />
              <span><b>Tiene fecha de caducidad</b><span className="block text-xs text-tenue">Para lácteos, pan, bollería, embutido… Cada compra guarda su propia fecha (lote).</span></span>
            </label>
            {d.controla_caducidad && (
              <>
                {form.id == null && !!d.stock_inicial && (
                  <div>
                    <label className="etiqueta" htmlFor="p-cad">Caducidad del stock que tienes ahora</label>
                    <input id="p-cad" className="campo" type="date" min={diaISO()} required={!d.vida_util_dias} value={d.fecha_caducidad} onChange={(e) => campo("fecha_caducidad", e.target.value)} />
                  </div>
                )}
                <div>
                  <label className="etiqueta" htmlFor="p-vida">Duración habitual en días (opcional)</label>
                  <CampoNumero id="p-vida" decimales={0} maxLength={4} placeholder="p. ej. 5 para sándwiches" valor={d.vida_util_dias} alCambiar={(n) => campo("vida_util_dias", n)} />
                  <p className="mt-1 text-xs text-tenue">
                    {d.vida_util_dias ? <>Si se compra hoy, caducará el <b>{hoyMas(d.vida_util_dias)}</b>. Al registrar la compra se puede cambiar.</>
                      : "Solo para productos que duran siempre lo mismo. Si no, la fecha se escribe en cada compra."}
                  </p>
                </div>
                <div>
                  <label className="etiqueta" htmlFor="p-aviso">Avisar con (días de antelación)</label>
                  <CampoNumero id="p-aviso" decimales={0} maxLength={3} placeholder="5" valor={d.dias_aviso_caducidad} alCambiar={(n) => campo("dias_aviso_caducidad", n)} />
                </div>
              </>
            )}
            {form.id != null && (
              <label className="flex cursor-pointer items-center gap-3 text-sm sm:col-span-2">
                <input type="checkbox" className="size-4 accent-emerald-600" checked={d.activo} onChange={(e) => campo("activo", e.target.checked)} />
                Producto activo (si lo desmarcas, deja de aparecer para vender)
              </label>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" className="boton-sec" onClick={() => setForm(null)}>Cancelar</button>
              <button className="boton">{form.id == null ? "Crear producto" : "Guardar"}</button>
            </div>
          </form>
          );
        })()}
      </Modal>
    </>
  );
}

const nombreSugerido = (r: InfoCodigo) => {
  const e = r.externo;
  if (!e?.nombre) return "";
  const marca = e.marca && !e.nombre.toLowerCase().includes(e.marca.toLowerCase()) ? ` ${e.marca}` : "";
  const tam = e.cantidad && !e.nombre.toLowerCase().includes(e.cantidad.toLowerCase()) ? ` ${e.cantidad}` : "";
  return `${e.nombre}${marca}${tam}`.slice(0, 100);
};

function InfoDelCodigo({ info, propio, alUsarNombre }: { info: InfoCodigo | "buscando" | null; propio: number | null; alUsarNombre: (n: string) => void }) {
  if (!info) return null;
  if (info === "buscando") return <p className="mt-2 text-xs text-tenue">Buscando el código…</p>;
  if (info.en_catalogo && info.en_catalogo.id !== propio)
    return <p className="mt-2 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">Este código ya es de <b>{info.en_catalogo.nombre}</b>{info.en_catalogo.activo ? "" : " (dado de baja)"}.</p>;
  if (info.en_catalogo) return null;
  const sugerido = nombreSugerido(info);
  if (!sugerido)
    return <p className="mt-2 text-xs text-tenue">El código no está en Open Food Facts (o no hay internet): escribe el nombre a mano.</p>;
  return (
    <div className="mt-2 rounded-lg bg-marca-suave px-3 py-2 text-xs text-suave">
      <p>Encontrado en Open Food Facts: <b className="text-texto">{sugerido}</b>{" "}
        <button type="button" className="font-medium text-marca-fuerte hover:underline" onClick={() => alUsarNombre(sugerido)}>usar este nombre</button></p>
      <p className="mt-0.5 text-tenue">El código no trae precio, coste, IVA, categoría ni caducidad: ponlos tú.</p>
    </div>
  );
}

function Seccion({ children }: { children: ReactNode }) {
  return <h3 className="-mb-1 border-b border-borde pb-1 text-xs font-semibold uppercase tracking-wide text-tenue sm:col-span-2">{children}</h3>;
}

function Dato({ titulo, valor, color = "" }: { titulo: string; valor: string; color?: string }) {
  return <div><p className="text-xs text-tenue">{titulo}</p><p className={`font-semibold tabular-nums ${color}`}>{valor}</p></div>;
}

/* =====================================================================
   Categorías
   ===================================================================== */
function Categorias() {
  const { datos } = useDatos<Categoria[]>("/categorias/todas");
  const ejecutar = useEjecutar();
  const [form, setForm] = useState<{ id: number | null; nombre: string; activa: boolean } | null>(null);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const ok = form.id == null
      ? await ejecutar(() => post("/categorias", { nombre: form.nombre }), `Categoría "${form.nombre}" añadida`)
      : await ejecutar(() => patch(`/categorias/${form.id}`, { nombre: form.nombre, activa: form.activa }), `Categoría "${form.nombre}" guardada`);
    if (ok) setForm(null);
  }

  return (
    <>
      <div className="mb-4 flex justify-end"><button className="boton" onClick={() => setForm({ id: null, nombre: "", activa: true })}><FolderPlus className="size-4" /> Categoría</button></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {!datos ? Array.from({ length: 6 }, (_, i) => <Esqueleto key={i} className="h-20" />) : datos.map((c) => (
          <Fila key={c.id} inactivo={!c.activa} alEditar={() => setForm({ id: c.id, nombre: c.nombre, activa: !!c.activa })}>
            <p className="font-medium">{c.nombre} {!c.activa && <Insignia color="gris">oculta</Insignia>}</p>
            <p className="text-xs text-tenue">{c.productos} {c.productos === 1 ? "producto activo" : "productos activos"}</p>
          </Fila>
        ))}
      </div>

      <Modal abierto={!!form} alCerrar={() => setForm(null)} titulo={form?.id == null ? "Nueva categoría" : "Editar categoría"}>
        {form && (
          <form onSubmit={guardar} className="space-y-4">
            <div><label className="etiqueta" htmlFor="c-nombre">Nombre</label><input id="c-nombre" className="campo" required maxLength={50} autoFocus value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
            {form.id != null && (
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" className="size-4 accent-emerald-600" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
                Visible al crear productos
              </label>
            )}
            <div className="flex justify-end gap-2"><button type="button" className="boton-sec" onClick={() => setForm(null)}>Cancelar</button><button className="boton" disabled={!form.nombre.trim()}>Guardar</button></div>
          </form>
        )}
      </Modal>
    </>
  );
}

/* =====================================================================
   Proveedores
   ===================================================================== */
function Proveedores() {
  const { datos } = useDatos<Proveedor[]>("/proveedores?todos=true");
  const ejecutar = useEjecutar();
  const [form, setForm] = useState<{ id: number | null; datos: typeof proveedorVacio } | null>(null);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const { activo, ...d } = form.datos;
    const ok = form.id == null
      ? await ejecutar(() => post("/proveedores", d), `Proveedor "${d.nombre}" añadido`)
      : await ejecutar(() => patch(`/proveedores/${form.id}`, { ...d, activo: !!activo }), `Proveedor "${d.nombre}" guardado`);
    if (ok) setForm(null);
  }
  const campo = (k: keyof typeof proveedorVacio, v: string | number) => setForm((f) => f && { ...f, datos: { ...f.datos, [k]: v } });

  return (
    <>
      <div className="mb-4 flex justify-end"><button className="boton" onClick={() => setForm({ id: null, datos: { ...proveedorVacio } })}><Truck className="size-4" /> Proveedor</button></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {!datos ? Array.from({ length: 6 }, (_, i) => <Esqueleto key={i} className="h-24" />) : datos.map((p) => (
          <Fila key={p.id} inactivo={!p.activo} alEditar={() => setForm({ id: p.id, datos: {
            nombre: p.nombre, contacto: p.contacto ?? "", telefono: p.telefono ?? "", email: p.email ?? "", notas: p.notas ?? "", activo: p.activo } })}>
            <p className="font-medium">{p.nombre} {!p.activo && <Insignia color="gris">de baja</Insignia>}</p>
            <p className="text-xs text-tenue">{[p.contacto, p.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}</p>
            {p.telefono && <a href={`tel:${p.telefono}`} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-marca-fuerte"><Phone className="size-3" />{p.telefono}</a>}
          </Fila>
        ))}
      </div>

      <Modal abierto={!!form} alCerrar={() => setForm(null)} titulo={form?.id == null ? "Nuevo proveedor" : "Editar proveedor"}>
        {form && (
          <form onSubmit={guardar} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="etiqueta" htmlFor="v-nombre">Nombre</label><input id="v-nombre" className="campo" required maxLength={80} autoFocus value={form.datos.nombre} onChange={(e) => campo("nombre", e.target.value)} /></div>
            <div><label className="etiqueta" htmlFor="v-contacto">Persona de contacto</label><input id="v-contacto" className="campo" maxLength={80} value={form.datos.contacto} onChange={(e) => campo("contacto", e.target.value)} placeholder="p. ej. el repartidor" /></div>
            <div><label className="etiqueta" htmlFor="v-tel">Teléfono</label><input id="v-tel" className="campo" type="tel" maxLength={20} value={form.datos.telefono} onChange={(e) => campo("telefono", e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="etiqueta" htmlFor="v-email">Email</label><input id="v-email" className="campo" type="email" maxLength={120} value={form.datos.email} onChange={(e) => campo("email", e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="etiqueta" htmlFor="v-notas">Notas</label><input id="v-notas" className="campo" maxLength={255} value={form.datos.notas} onChange={(e) => campo("notas", e.target.value)} placeholder="p. ej. pasa los martes" /></div>
            {form.id != null && (
              <label className="flex cursor-pointer items-center gap-3 text-sm sm:col-span-2">
                <input type="checkbox" className="size-4 accent-emerald-600" checked={!!form.datos.activo} onChange={(e) => campo("activo", e.target.checked ? 1 : 0)} />
                Proveedor activo
              </label>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="boton-sec" onClick={() => setForm(null)}>Cancelar</button><button className="boton" disabled={!form.datos.nombre.trim()}>Guardar</button></div>
          </form>
        )}
      </Modal>
    </>
  );
}

function Fila({ children, inactivo, alEditar }: { children: ReactNode; inactivo: boolean; alEditar: () => void }) {
  return (
    <div className={`tarjeta flex items-start justify-between gap-3 p-4 ${inactivo ? "opacity-60" : ""}`}>
      <div className="min-w-0">{children}</div>
      <button className="rounded-lg p-1.5 text-tenue hover:bg-superficie-2 hover:text-texto" onClick={alEditar} aria-label="Editar"><Pencil className="size-4" /></button>
    </div>
  );
}

