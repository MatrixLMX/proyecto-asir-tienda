import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { api, cantidad, euros, post } from "../api";
import { Aviso, Cabecera, Insignia, useDatos } from "../ui";
import type { ProductoAdmin } from "./Compras";

interface Opcion { id: number; nombre: string; porcentaje?: number }

const productoVacio = {
  nombre: "", codigo_barras: "", categoria_id: 0, proveedor_id: 0, iva_id: 0, unidad_medida: "unidad",
  precio_venta: 0, stock_minimo: 0, controla_caducidad: false, vida_util_dias: 0, dias_aviso_caducidad: 5,
};

export default function Catalogo() {
  const productos = useDatos<ProductoAdmin[]>("/productos/admin");
  const categorias = useDatos<Opcion[]>("/categorias");
  const proveedores = useDatos<Opcion[]>("/proveedores");
  const ivas = useDatos<Opcion[]>("/tipos-iva");
  const [nuevo, setNuevo] = useState(productoVacio);
  const [abierto, setAbierto] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  async function ejecutar(accion: () => Promise<unknown>, ok: string) {
    setMensaje(null);
    try {
      await accion();
      setMensaje({ tipo: "ok", texto: ok });
    } catch (e) {
      setMensaje({ tipo: "error", texto: (e as Error).message });
    }
  }

  function crearProducto(e: FormEvent) {
    e.preventDefault();
    ejecutar(async () => {
      await post("/productos", {
        ...nuevo,
        proveedor_id: nuevo.proveedor_id || null,
        vida_util_dias: nuevo.controla_caducidad && nuevo.vida_util_dias ? nuevo.vida_util_dias : null,
      });
      setNuevo(productoVacio);
      setAbierto(false);
      productos.recargar();
    }, `Producto "${nuevo.nombre}" creado`);
  }

  function añadirNombre(ruta: string, tipo: string, recargar: () => void) {
    const nombre = prompt(`Nombre de la nueva ${tipo}:`);
    if (nombre?.trim()) ejecutar(async () => { await post(ruta, { nombre }); recargar(); }, `${tipo[0].toUpperCase() + tipo.slice(1)} "${nombre}" añadida`);
  }

  function cambiarPrecio(p: ProductoAdmin) {
    const v = prompt(`Nuevo PVP (con IVA) de ${p.nombre}:`, String(p.precio_venta));
    const precio = Number(v?.replace(",", "."));
    if (v && !isNaN(precio))
      ejecutar(async () => { await api(`/productos/${p.id}`, { method: "PATCH", body: JSON.stringify({ precio_venta: precio }) }); productos.recargar(); }, "Precio actualizado");
  }

  const campo = <K extends keyof typeof nuevo>(k: K, v: (typeof nuevo)[K]) => setNuevo((n) => ({ ...n, [k]: v }));

  return (
    <>
      <Cabecera titulo="Catálogo" subtitulo="Productos, categorías y proveedores">
        <div className="flex flex-wrap gap-2">
          <button className="boton-sec" onClick={() => añadirNombre("/categorias", "categoría", categorias.recargar)}><Plus className="size-4" /> Categoría</button>
          <button className="boton-sec" onClick={() => añadirNombre("/proveedores", "proveedor", proveedores.recargar)}><Plus className="size-4" /> Proveedor</button>
          <button className="boton" onClick={() => setAbierto((a) => !a)}><Plus className="size-4" /> Producto</button>
        </div>
      </Cabecera>
      {mensaje && <div className="mb-4"><Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso></div>}

      {abierto && (
        <form onSubmit={crearProducto} className="tarjeta mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2"><label className="etiqueta">Nombre</label><input className="campo" required value={nuevo.nombre} onChange={(e) => campo("nombre", e.target.value)} /></div>
          <div><label className="etiqueta">Código de barras</label><input className="campo" value={nuevo.codigo_barras} onChange={(e) => campo("codigo_barras", e.target.value)} /></div>
          <div>
            <label className="etiqueta">Se vende por</label>
            <select className="campo" value={nuevo.unidad_medida} onChange={(e) => campo("unidad_medida", e.target.value)}>
              <option value="unidad">Unidades</option><option value="kg">Peso (kg)</option>
            </select>
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
              <option value="">—</option>{proveedores.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="etiqueta">IVA</label>
            <select className="campo" required value={nuevo.iva_id || ""} onChange={(e) => campo("iva_id", Number(e.target.value))}>
              <option value="">Elige…</option>{ivas.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.porcentaje} %)</option>)}
            </select>
          </div>
          <div><label className="etiqueta">PVP con IVA (€{nuevo.unidad_medida === "kg" ? "/kg" : ""})</label><input className="campo" type="number" step="0.01" min="0" required value={nuevo.precio_venta} onChange={(e) => campo("precio_venta", Number(e.target.value))} /></div>
          <div><label className="etiqueta">Stock mínimo</label><input className="campo" type="number" step="0.001" min="0" value={nuevo.stock_minimo} onChange={(e) => campo("stock_minimo", Number(e.target.value))} /></div>
          <label className="flex items-center gap-2 self-center text-sm"><input type="checkbox" className="size-4 accent-emerald-600" checked={nuevo.controla_caducidad} onChange={(e) => campo("controla_caducidad", e.target.checked)} /> Controlar caducidad</label>
          {nuevo.controla_caducidad && (
            <>
              <div><label className="etiqueta">Vida útil (días, opcional)</label><input className="campo" type="number" min="0" value={nuevo.vida_util_dias} onChange={(e) => campo("vida_util_dias", Number(e.target.value))} /></div>
              <div><label className="etiqueta">Avisar con (días)</label><input className="campo" type="number" min="0" value={nuevo.dias_aviso_caducidad} onChange={(e) => campo("dias_aviso_caducidad", Number(e.target.value))} /></div>
            </>
          )}
          <div className="flex items-end sm:col-span-2 lg:col-span-4"><button className="boton">Crear producto</button></div>
        </form>
      )}

      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-5 py-3 font-medium">Producto</th>
              <th className="px-5 py-3 font-medium">Proveedor</th>
              <th className="px-5 py-3 text-right font-medium">Coste (sin IVA)</th>
              <th className="px-5 py-3 text-right font-medium">PVP</th>
              <th className="px-5 py-3 text-right font-medium">Margen</th>
              <th className="px-5 py-3 text-right font-medium">Stock</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {productos.datos?.map((p) => {
              const base = p.precio_venta / (1 + p.iva / 100);
              const margen = base ? ((base - p.coste_medio) / base) * 100 : 0;
              return (
                <tr key={p.id} className={p.activo ? "" : "opacity-50"}>
                  <td className="px-5 py-3"><p className="font-medium">{p.nombre}</p><p className="text-xs text-slate-400">{p.categoria} · IVA {p.iva} %</p></td>
                  <td className="px-5 py-3 text-slate-500">{p.proveedor ?? "—"}</td>
                  <td className="px-5 py-3 text-right">{euros(p.coste_medio)}</td>
                  <td className="px-5 py-3 text-right"><button className="font-semibold text-marca-700 hover:underline" onClick={() => cambiarPrecio(p)}>{euros(p.precio_venta)}</button></td>
                  <td className="px-5 py-3 text-right"><Insignia color={margen >= 25 ? "verde" : margen >= 10 ? "ambar" : "rojo"}>{margen.toFixed(1)} %</Insignia></td>
                  <td className="px-5 py-3 text-right">{cantidad(p.stock_actual, p.unidad_medida)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
