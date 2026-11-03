import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Download, FolderPlus, PackagePlus, Pencil, Phone, Search, Truck } from "lucide-react";
import { cantidad, descargarCsv, euros, patch, post } from "../api";
import { Cabecera, Esqueleto, Insignia, Modal, Pestañas, emitirCambio, useAviso, useDatos } from "../ui";
import type { ProductoAdmin } from "./Compras";

interface Opcion { id: number; nombre: string; porcentaje?: number }
interface Categoria { id: number; nombre: string; activa: number; productos: number }
interface Proveedor { id: number; nombre: string; contacto: string | null; telefono: string | null; email: string | null; notas: string | null; activo: number }

interface FormProducto {
  nombre: string; codigo_barras: string; categoria_id: number; proveedor_id: number; iva_id: number; unidad_medida: "unidad" | "kg";
  precio_venta: number; stock_minimo: number; controla_caducidad: boolean; vida_util_dias: number; dias_aviso_caducidad: number; activo: boolean;
}
const productoVacio: FormProducto = {
  nombre: "", codigo_barras: "", categoria_id: 0, proveedor_id: 0, iva_id: 0, unidad_medida: "unidad",
  precio_venta: 0, stock_minimo: 0, controla_caducidad: false, vida_util_dias: 0, dias_aviso_caducidad: 5, activo: true,
};
const proveedorVacio = { nombre: "", contacto: "", telefono: "", email: "", notas: "", activo: 1 };

const margenDe = (precio: number, iva: number, coste: number) => {
  const base = precio / (1 + iva / 100);
  return base ? ((base - coste) / base) * 100 : 0;
};
const pct = (n: number) => `${n.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;

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

/* =====================================================================
   Productos
   ===================================================================== */
function Productos() {
  const productos = useDatos<ProductoAdmin[]>("/productos/admin");
  const categorias = useDatos<Opcion[]>("/categorias");
  const proveedores = useDatos<Opcion[]>("/proveedores");
  const ivas = useDatos<Opcion[]>("/tipos-iva");
  const ejecutar = useEjecutar();
  const [q, setQ] = useState("");
  const [bajas, setBajas] = useState(false);
  // null: cerrado · {id: null}: nuevo · {id: n}: editando
  const [form, setForm] = useState<{ id: number | null; datos: FormProducto; actual?: ProductoAdmin } | null>(null);

  const filas = useMemo(() => (productos.datos ?? []).filter((p) => (bajas || p.activo) &&
    `${p.nombre} ${p.categoria} ${p.proveedor ?? ""} ${p.codigo_barras ?? ""}`.toLowerCase().includes(q.toLowerCase())), [productos.datos, q, bajas]);

  const editar = (p: ProductoAdmin) => setForm({
    id: p.id, actual: p, datos: {
      nombre: p.nombre, codigo_barras: p.codigo_barras ?? "", categoria_id: p.categoria_id, proveedor_id: p.proveedor_id ?? 0,
      iva_id: (ivas.datos ?? []).find((i) => i.porcentaje === p.iva)?.id ?? 0, unidad_medida: p.unidad_medida,
      precio_venta: p.precio_venta, stock_minimo: p.stock_minimo, controla_caducidad: !!p.controla_caducidad,
      vida_util_dias: p.vida_util_dias ?? 0, dias_aviso_caducidad: p.dias_aviso_caducidad ?? 5, activo: !!p.activo,
    },
  });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const { activo, unidad_medida, ...d } = form.datos;
    const cuerpo = {
      ...d,
      proveedor_id: d.proveedor_id || null,
      vida_util_dias: d.controla_caducidad && d.vida_util_dias ? d.vida_util_dias : null,
    };
    const ok = form.id == null
      ? await ejecutar(() => post("/productos", { ...cuerpo, unidad_medida }), `Producto "${d.nombre}" creado. Registra una compra para darle stock.`)
      : await ejecutar(() => patch(`/productos/${form.id}`, { ...cuerpo, activo }), `${d.nombre} guardado`);
    if (ok) setForm(null);
  }

  const campo = <K extends keyof FormProducto>(k: K, v: FormProducto[K]) => setForm((f) => f && { ...f, datos: { ...f.datos, [k]: v } });
  const ivaElegido = ivas.datos?.find((i) => i.id === form?.datos.iva_id)?.porcentaje ?? 0;

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
          <button className="boton" onClick={() => setForm({ id: null, datos: { ...productoVacio } })}><PackagePlus className="size-4" /> Producto</button>
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
                      <p className="text-xs text-tenue">{p.categoria} · IVA {p.iva} %{p.controla_caducidad ? " · caduca" : ""}</p>
                    </td>
                    <td className="hidden text-suave md:table-cell">{p.proveedor ?? "—"}</td>
                    <td className="text-right tabular-nums text-suave">{euros(p.coste_medio)}</td>
                    <td className="text-right font-semibold tabular-nums">{euros(p.precio_venta)}</td>
                    <td className="text-right"><Insignia color={margen >= 25 ? "verde" : margen >= 10 ? "ambar" : "rojo"}>{pct(margen)}</Insignia></td>
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
        {form && (
          <form onSubmit={guardar} className="grid max-h-[72vh] gap-4 overflow-y-auto px-0.5 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="etiqueta" htmlFor="p-nombre">Nombre</label><input id="p-nombre" className="campo" required maxLength={100} autoFocus value={form.datos.nombre} onChange={(e) => campo("nombre", e.target.value)} /></div>
            <div><label className="etiqueta" htmlFor="p-codigo">Código de barras</label><input id="p-codigo" className="campo" placeholder="Opcional: escanéalo aquí" maxLength={20} value={form.datos.codigo_barras} onChange={(e) => campo("codigo_barras", e.target.value)} /></div>
            <div>
              <span className="etiqueta">Se vende por</span>
              <div className="grid grid-cols-2 gap-2">
                {(["unidad", "kg"] as const).map((u) => (
                  <button type="button" key={u} disabled={form.id != null} onClick={() => campo("unidad_medida", u)}
                    className={`rounded-xl border py-2.5 text-sm font-medium disabled:cursor-not-allowed ${form.datos.unidad_medida === u ? "border-marca-500 bg-marca-suave text-marca-fuerte" : "border-borde text-suave disabled:opacity-50"}`}>
                    {u === "unidad" ? "Unidades" : "Peso (kg)"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="etiqueta" htmlFor="p-cat">Categoría</label>
              <select id="p-cat" className="campo" required value={form.datos.categoria_id || ""} onChange={(e) => campo("categoria_id", Number(e.target.value))}>
                <option value="">Elige…</option>{categorias.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="p-prov">Proveedor habitual</label>
              <select id="p-prov" className="campo" value={form.datos.proveedor_id || ""} onChange={(e) => campo("proveedor_id", Number(e.target.value))}>
                <option value="">Ninguno</option>{proveedores.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="p-iva">IVA</label>
              <select id="p-iva" className="campo" required value={form.datos.iva_id || ""} onChange={(e) => campo("iva_id", Number(e.target.value))}>
                <option value="">Elige…</option>{ivas.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.porcentaje} %)</option>)}
              </select>
            </div>
            <div><label className="etiqueta" htmlFor="p-pvp">PVP con IVA (€{form.datos.unidad_medida === "kg" ? "/kg" : ""})</label><input id="p-pvp" className="campo" type="number" inputMode="decimal" step="0.01" min="0" required value={form.datos.precio_venta} onChange={(e) => campo("precio_venta", Number(e.target.value))} /></div>
            <div><label className="etiqueta" htmlFor="p-min">Stock mínimo (aviso)</label><input id="p-min" className="campo" type="number" inputMode="decimal" step="0.001" min="0" value={form.datos.stock_minimo} onChange={(e) => campo("stock_minimo", Number(e.target.value))} /></div>
            {form.actual && (
              <p className="self-end rounded-xl bg-superficie-2 px-4 py-3 text-sm text-suave">
                Margen con este precio: <b className="text-texto">{pct(margenDe(form.datos.precio_venta, ivaElegido, form.actual.coste_medio))}</b>
                <span className="block text-xs">coste medio {euros(form.actual.coste_medio)} sin IVA</span>
              </p>
            )}
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-borde p-3 text-sm sm:col-span-2">
              <input type="checkbox" className="size-4 accent-emerald-600" checked={form.datos.controla_caducidad} onChange={(e) => campo("controla_caducidad", e.target.checked)} />
              <span><b>Controlar caducidad</b><span className="block text-xs text-tenue">Para lácteos, pan, bollería, embutido…</span></span>
            </label>
            {form.datos.controla_caducidad && (
              <>
                <div><label className="etiqueta" htmlFor="p-vida">Vida útil en días (opcional)</label><input id="p-vida" className="campo" type="number" min="0" value={form.datos.vida_util_dias} onChange={(e) => campo("vida_util_dias", Number(e.target.value))} /><p className="mt-1 text-xs text-tenue">Si la pones, al comprar no hace falta escribir la fecha.</p></div>
                <div><label className="etiqueta" htmlFor="p-aviso">Avisar con (días de antelación)</label><input id="p-aviso" className="campo" type="number" min="0" max="255" value={form.datos.dias_aviso_caducidad} onChange={(e) => campo("dias_aviso_caducidad", Number(e.target.value))} /></div>
              </>
            )}
            {form.id != null && (
              <label className="flex cursor-pointer items-center gap-3 text-sm sm:col-span-2">
                <input type="checkbox" className="size-4 accent-emerald-600" checked={form.datos.activo} onChange={(e) => campo("activo", e.target.checked)} />
                Producto activo (si lo desmarcas, deja de aparecer para vender)
              </label>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" className="boton-sec" onClick={() => setForm(null)}>Cancelar</button>
              <button className="boton">{form.id == null ? "Crear producto" : "Guardar"}</button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
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

