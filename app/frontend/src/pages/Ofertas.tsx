import { useMemo, useState, type FormEvent } from "react";
import { BadgePercent, Plus, Search, Trash2 } from "lucide-react";
import { borrar, cantidad, euros, patch, post, type Oferta, type ProductoStock } from "../api";
import { BotonEscanear } from "../escaner";
import { Cabecera, CampoNumero, Confirmar, Esqueleto, Insignia, Modal, Vacio, emitirCambio, useAviso, useDatos } from "../ui";

export default function Ofertas() {
  const { datos } = useDatos<Oferta[]>("/ofertas");
  const productos = useDatos<ProductoStock[]>("/productos");
  const avisar = useAviso();
  const [nueva, setNueva] = useState(false);
  const [aBorrar, setABorrar] = useState<Oferta | null>(null);
  const [q, setQ] = useState("");
  const [productoId, setProductoId] = useState<number | "">("");
  const [minima, setMinima] = useState<number | null>(3);
  const [precio, setPrecio] = useState<number | null>(null);

  const elegibles = useMemo(() => (productos.datos ?? []).filter((p) => !p.precio_libre), [productos.datos]);
  const opciones = useMemo(() => elegibles.filter((p) => p.id === productoId || p.producto.toLowerCase().includes(q.toLowerCase())), [elegibles, q, productoId]);
  const producto = elegibles.find((p) => p.id === productoId);
  const ahorro = producto && precio != null && minima ? (producto.precio_venta - precio) * minima : null;

  function porCodigo(codigo: string) {
    const p = elegibles.find((x) => x.codigo_barras === codigo.trim());
    if (p) setProductoId(p.id); else avisar("error", "Ese código no está en el catálogo");
  }

  const ejecutar = async (accion: () => Promise<unknown>, ok: string) => {
    try { await accion(); avisar("ok", ok); emitirCambio(); return true; } catch (e) { avisar("error", (e as Error).message); return false; }
  };

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (await ejecutar(() => post("/ofertas", { producto_id: productoId, cantidad_minima: minima, precio }), "Oferta creada")) {
      setNueva(false); setProductoId(""); setPrecio(null); setMinima(3); setQ("");
    }
  }

  return (
    <>
      <Cabecera titulo="Ofertas" subtitulo="Si compra tantas, la unidad le sale a tal. Se aplica sola al vender, a todas las unidades del ticket.">
        <button className="boton" onClick={() => setNueva(true)}><Plus className="size-4" /> Oferta</button>
      </Cabecera>

      {!datos ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Esqueleto key={i} className="h-28" />)}</div>
        : !datos.length ? <div className="tarjeta"><Vacio icono={<BadgePercent className="size-6" />} titulo="Todavía no hay ofertas">Por ejemplo: 3 latas a 1,00 € la unidad.</Vacio></div> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {datos.map((o) => (
            <div key={o.id} className={`tarjeta p-4 ${o.activa ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-semibold">{o.producto}</p>
                {!o.activa && <Insignia color="gris">pausada</Insignia>}
              </div>
              <p className="mt-2 text-sm">Desde <b>{cantidad(o.cantidad_minima, o.unidad_medida)}</b>, a <b className="text-marca-fuerte">{euros(o.precio)}</b>{o.unidad_medida === "kg" ? "/kg" : " la unidad"}</p>
              <p className="text-xs text-tenue">Precio normal: {euros(o.precio_normal)}{o.precio >= o.precio_normal ? " · ahora la oferta no sale a cuenta" : ""}</p>
              <div className="mt-3 flex justify-end gap-2">
                <button className="boton-sec px-3 py-1.5 text-xs" onClick={() => ejecutar(() => patch(`/ofertas/${o.id}`, { activa: !o.activa }), o.activa ? "Oferta pausada" : "Oferta activada")}>{o.activa ? "Pausar" : "Activar"}</button>
                <button className="rounded-lg p-1.5 text-tenue hover:bg-superficie-2 hover:text-rose-500" onClick={() => setABorrar(o)} aria-label={`Borrar oferta de ${o.producto}`}><Trash2 className="size-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal abierto={nueva} alCerrar={() => setNueva(false)} titulo="Nueva oferta">
        <form onSubmit={crear} className="space-y-4">
          <div>
            <label className="etiqueta" htmlFor="o-buscar">Producto</label>
            <div className="mb-2 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" />
                <input id="o-buscar" className="campo pl-9" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <BotonEscanear alLeer={porCodigo} className="boton-sec shrink-0 px-3" />
            </div>
            <select className="campo" required aria-label="Producto" value={productoId} onChange={(e) => setProductoId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Elige…</option>
              {opciones.map((p) => <option key={p.id} value={p.id}>{p.producto} ({euros(p.precio_venta)})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiqueta" htmlFor="o-min">Si compra ({producto?.unidad_medida === "kg" ? "kg" : "uds."})</label>
              <CampoNumero id="o-min" decimales={producto?.unidad_medida === "kg" ? 3 : 0} required valor={minima} alCambiar={setMinima} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="o-precio">{producto?.unidad_medida === "kg" ? "El kg" : "La unidad"} le sale a (€)</label>
              <CampoNumero id="o-precio" required placeholder="0,00" valor={precio} alCambiar={setPrecio} />
            </div>
          </div>
          {ahorro != null && ahorro > 0 && (
            <p className="rounded-xl bg-marca-suave px-4 py-3 text-sm">Paga <b>{euros(precio! * minima!)}</b> en vez de {euros(producto!.precio_venta * minima!)}: el cliente ahorra <b>{euros(ahorro)}</b>.</p>
          )}
          {ahorro != null && ahorro <= 0 && <p className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">Tiene que ser menos que el precio normal ({euros(producto!.precio_venta)}).</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="boton-sec" onClick={() => setNueva(false)}>Cancelar</button>
            <button className="boton" disabled={!productoId || !minima || minima <= 1 || precio == null || (ahorro != null && ahorro <= 0)}>Crear oferta</button>
          </div>
        </form>
      </Modal>

      <Confirmar abierto={!!aBorrar} alCerrar={() => setABorrar(null)} alConfirmar={() => aBorrar && ejecutar(() => borrar(`/ofertas/${aBorrar.id}`), "Oferta borrada")}
        titulo="Borrar oferta" textoBoton="Borrar" peligro
        mensaje={aBorrar && <>Se borrará la oferta de <b>{aBorrar.producto}</b>. Las ventas ya hechas no cambian.</>} />
    </>
  );
}
