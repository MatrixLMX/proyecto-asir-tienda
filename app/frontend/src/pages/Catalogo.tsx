import { useMemo, useState, type FormEvent } from "react";
import { FolderPlus, PackagePlus, Pencil, Search, Truck } from "lucide-react";
import { api, cantidad, euros, post } from "../api";
import { Cabecera, Esqueleto, Insignia, Modal, emitirCambio, useAviso, useDatos } from "../ui";
import type { ProductoAdmin } from "./Compras";

interface Opcion { id: number; nombre: string; porcentaje?: number }

const productoVacio = {
  nombre: "", codigo_barras: "", categoria_id: 0, proveedor_id: 0, iva_id: 0, unidad_medida: "unidad",
  precio_venta: 0, stock_minimo: 0, controla_caducidad: false, vida_util_dias: 0, dias_aviso_caducidad: 5,
};

const margenDe = (p: ProductoAdmin) => {
  const base = p.precio_venta / (1 + p.iva / 100);
  return base ? ((base - p.coste_medio) / base) * 100 : 0;
};

export default function Catalogo() {
  const productos = useDatos<ProductoAdmin[]>("/productos/admin");
  const categorias = useDatos<Opcion[]>("/categorias");
  const proveedores = useDatos<Opcion[]>("/proveedores");
  const ivas = useDatos<Opcion[]>("/tipos-iva");
  const avisar = useAviso();
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState(productoVacio);
  const [modal, setModal] = useState<null | "producto" | "categoria" | "proveedor">(null);
  const [nombre, setNombre] = useState("");
  const [editando, setEditando] = useState<ProductoAdmin | null>(null);

  const filas = useMemo(() => (productos.datos ?? []).filter((p) =>
    `${p.nombre} ${p.categoria} ${p.proveedor ?? ""}`.toLowerCase().includes(q.toLowerCase())), [productos.datos, q]);

  async function ejecutar(accion: () => Promise<unknown>, ok: string) {
    try {
      await accion();
      avisar("ok", ok);
      emitirCambio();
      return true;
    } catch (e) {
      avisar("error", (e as Error).message);
      return false;
    }
  }

  async function crearProducto(e: FormEvent) {
    e.preventDefault();
    const ok = await ejecutar(() => post("/productos", {
      ...nuevo,
      proveedor_id: nuevo.proveedor_id || null,
      vida_util_dias: nuevo.controla_caducidad && nuevo.vida_util_dias ? nuevo.vida_util_dias : null,
    }), `Producto "${nuevo.nombre}" creado. Registra una compra para darle stock.`);
    if (ok) { setNuevo(productoVacio); setModal(null); }
  }

  async function crearNombre(e: FormEvent) {
    e.preventDefault();
    const tipo = modal === "categoria" ? "Categoría" : "Proveedor";
    const ok = await ejecutar(() => post(modal === "categoria" ? "/categorias" : "/proveedores", { nombre }), `${tipo} "${nombre}" añadido`);
    if (ok) { setNombre(""); setModal(null); }
  }

  async function guardarCambios(e: FormEvent) {
    e.preventDefault();
    if (!editando) return;
    const ok = await ejecutar(() => api(`/productos/${editando.id}`, {
      method: "PATCH",
      body: JSON.stringify({ precio_venta: editando.precio_venta, stock_minimo: editando.stock_minimo, activo: !!editando.activo }),
    }), `${editando.nombre} actualizado`);
    if (ok) setEditando(null);
  }

  const campo = <K extends keyof typeof nuevo>(k: K, v: (typeof nuevo)[K]) => setNuevo((n) => ({ ...n, [k]: v }));

  return (
    <>
      <Cabecera titulo="Catálogo" subtitulo="Productos, categorías y proveedores">
        <div className="flex flex-wrap gap-2">
          <button className="boton-sec" onClick={() => setModal("categoria")}><FolderPlus className="size-4" /> Categoría</button>
          <button className="boton-sec" onClick={() => setModal("proveedor")}><Truck className="size-4" /> Proveedor</button>
          <button className="boton" onClick={() => setModal("producto")}><PackagePlus className="size-4" /> Producto</button>
        </div>
      </Cabecera>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-tenue" />
        <input className="campo pl-10" placeholder="Buscar por producto, categoría o proveedor…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                const margen = margenDe(p);
                return (
                  <tr key={p.id} className={p.activo ? "" : "opacity-50"}>
                    <td>
                      <p className="font-medium">{p.nombre} {!p.activo && <Insignia color="gris">de baja</Insignia>}</p>
                      <p className="text-xs text-tenue">{p.categoria} · IVA {p.iva} %{p.controla_caducidad ? " · caduca" : ""}</p>
                    </td>
                    <td className="hidden text-suave md:table-cell">{p.proveedor ?? "—"}</td>
                    <td className="text-right tabular-nums text-suave">{euros(p.coste_medio)}</td>
                    <td className="text-right font-semibold tabular-nums">{euros(p.precio_venta)}</td>
                    <td className="text-right"><Insignia color={margen >= 25 ? "verde" : margen >= 10 ? "ambar" : "rojo"}>{margen.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %</Insignia></td>
                    <td className="hidden text-right tabular-nums sm:table-cell">{cantidad(p.stock_actual, p.unidad_medida)}</td>
                    <td className="text-right">
                      <button className="rounded-lg p-1.5 text-tenue hover:bg-superficie-2 hover:text-texto" onClick={() => setEditando({ ...p })} aria-label={`Editar ${p.nombre}`}>
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

      {/* Nueva categoría o proveedor */}
      <Modal abierto={modal === "categoria" || modal === "proveedor"} alCerrar={() => setModal(null)} titulo={modal === "categoria" ? "Nueva categoría" : "Nuevo proveedor"}>
        <form onSubmit={crearNombre}>
          <label className="etiqueta" htmlFor="nombre">Nombre</label>
          <input id="nombre" className="campo mb-6" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus required maxLength={80} />
          <div className="flex justify-end gap-2">
            <button type="button" className="boton-sec" onClick={() => setModal(null)}>Cancelar</button>
            <button className="boton" disabled={!nombre.trim()}>Añadir</button>
          </div>
        </form>
      </Modal>

      {/* Nuevo producto */}
      <Modal abierto={modal === "producto"} alCerrar={() => setModal(null)} titulo="Nuevo producto" ancho="max-w-2xl">
        <form onSubmit={crearProducto} className="grid max-h-[70vh] gap-4 overflow-y-auto sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="etiqueta">Nombre</label><input className="campo" required autoFocus value={nuevo.nombre} onChange={(e) => campo("nombre", e.target.value)} /></div>
          <div><label className="etiqueta">Código de barras</label><input className="campo" placeholder="Opcional" value={nuevo.codigo_barras} onChange={(e) => campo("codigo_barras", e.target.value)} /></div>
          <div>
            <label className="etiqueta">Se vende por</label>
            <div className="grid grid-cols-2 gap-2">
              {(["unidad", "kg"] as const).map((u) => (
                <button type="button" key={u} onClick={() => campo("unidad_medida", u)} className={`rounded-xl border py-2.5 text-sm font-medium ${nuevo.unidad_medida === u ? "border-marca-500 bg-marca-suave text-marca-fuerte" : "border-borde text-suave"}`}>
                  {u === "unidad" ? "Unidades" : "Peso (kg)"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="etiqueta">Categoría</label>
            <select className="campo" required value={nuevo.categoria_id || ""} onChange={(e) => campo("categoria_id", Number(e.target.value))}>
              <option value="">Elige…</option>{categorias.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="etiqueta">Proveedor habitual</label>
            <select className="campo" value={nuevo.proveedor_id || ""} onChange={(e) => campo("proveedor_id", Number(e.target.value))}>
              <option value="">Ninguno</option>{proveedores.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="etiqueta">IVA</label>
            <select className="campo" required value={nuevo.iva_id || ""} onChange={(e) => campo("iva_id", Number(e.target.value))}>
              <option value="">Elige…</option>{ivas.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.porcentaje} %)</option>)}
            </select>
          </div>
          <div><label className="etiqueta">PVP con IVA (€{nuevo.unidad_medida === "kg" ? "/kg" : ""})</label><input className="campo" type="number" inputMode="decimal" step="0.01" min="0" required value={nuevo.precio_venta} onChange={(e) => campo("precio_venta", Number(e.target.value))} /></div>
          <div><label className="etiqueta">Stock mínimo (aviso)</label><input className="campo" type="number" inputMode="decimal" step="0.001" min="0" value={nuevo.stock_minimo} onChange={(e) => campo("stock_minimo", Number(e.target.value))} /></div>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-borde p-3 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-emerald-600" checked={nuevo.controla_caducidad} onChange={(e) => campo("controla_caducidad", e.target.checked)} />
            <span><b>Controlar caducidad</b><span className="block text-xs text-tenue">Para lácteos, pan, bollería, embutido…</span></span>
          </label>
          {nuevo.controla_caducidad && (
            <>
              <div><label className="etiqueta">Vida útil en días (opcional)</label><input className="campo" type="number" min="0" value={nuevo.vida_util_dias} onChange={(e) => campo("vida_util_dias", Number(e.target.value))} /></div>
              <div><label className="etiqueta">Avisar con (días de antelación)</label><input className="campo" type="number" min="0" value={nuevo.dias_aviso_caducidad} onChange={(e) => campo("dias_aviso_caducidad", Number(e.target.value))} /></div>
            </>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="boton-sec" onClick={() => setModal(null)}>Cancelar</button>
            <button className="boton">Crear producto</button>
          </div>
        </form>
      </Modal>

      {/* Editar producto */}
      <Modal abierto={!!editando} alCerrar={() => setEditando(null)} titulo={editando ? `Editar ${editando.nombre}` : ""}>
        {editando && (
          <form onSubmit={guardarCambios} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="etiqueta">PVP con IVA</label><input className="campo" type="number" inputMode="decimal" step="0.01" min="0" autoFocus value={editando.precio_venta} onChange={(e) => setEditando({ ...editando, precio_venta: Number(e.target.value) })} /></div>
              <div><label className="etiqueta">Stock mínimo</label><input className="campo" type="number" inputMode="decimal" step="0.001" min="0" value={editando.stock_minimo} onChange={(e) => setEditando({ ...editando, stock_minimo: Number(e.target.value) })} /></div>
            </div>
            <p className="rounded-xl bg-superficie-2 px-4 py-3 text-sm text-suave">
              Con este precio el margen sería <b className="text-texto">{margenDe(editando).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %</b> (coste medio {euros(editando.coste_medio)} sin IVA).
            </p>
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" className="size-4 accent-emerald-600" checked={!!editando.activo} onChange={(e) => setEditando({ ...editando, activo: e.target.checked ? 1 : 0 })} />
              Producto activo (si lo desmarcas, deja de aparecer para vender)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="boton-sec" onClick={() => setEditando(null)}>Cancelar</button>
              <button className="boton">Guardar</button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
