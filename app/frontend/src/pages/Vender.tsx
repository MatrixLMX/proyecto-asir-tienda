import { useMemo, useState } from "react";
import { Banknote, CreditCard, Minus, Plus, Search, Smartphone, Trash2 } from "lucide-react";
import { euros, post, type ProductoStock } from "../api";
import { Aviso, Cabecera, Vacio, useDatos } from "../ui";

interface Linea { producto: ProductoStock; cantidad: number }

const PAGOS = [
  { id: "efectivo", nombre: "Efectivo", icono: Banknote },
  { id: "tarjeta", nombre: "Tarjeta", icono: CreditCard },
  { id: "bizum", nombre: "Bizum", icono: Smartphone },
] as const;

export default function Vender() {
  const { datos: productos, recargar } = useDatos<ProductoStock[]>("/productos");
  const [busqueda, setBusqueda] = useState("");
  const [carrito, setCarrito] = useState<Linea[]>([]);
  const [pago, setPago] = useState<(typeof PAGOS)[number]["id"]>("efectivo");
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    return (productos ?? []).filter(
      (p) => !q || p.producto.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q) || p.codigo_barras === q,
    );
  }, [productos, busqueda]);

  const total = carrito.reduce((s, l) => s + l.cantidad * l.producto.precio_venta, 0);

  function añadir(p: ProductoStock) {
    setMensaje(null);
    setCarrito((c) => {
      const i = c.findIndex((l) => l.producto.id === p.id);
      if (i >= 0) return c.map((l, j) => (j === i && p.unidad_medida === "unidad" ? { ...l, cantidad: l.cantidad + 1 } : l));
      return [...c, { producto: p, cantidad: p.unidad_medida === "kg" ? 0.5 : 1 }];
    });
  }

  const cambiar = (id: number, cantidad: number) =>
    setCarrito((c) => c.map((l) => (l.producto.id === id ? { ...l, cantidad } : l)).filter((l) => l.cantidad > 0));

  async function cobrar() {
    setEnviando(true);
    try {
      const r = await post<{ id: number; total: number }>("/ventas", {
        metodo_pago: pago,
        lineas: carrito.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad })),
      });
      setMensaje({ tipo: "ok", texto: `Venta nº ${r.id} registrada: ${euros(r.total)}` });
      setCarrito([]);
      setBusqueda("");
      recargar();
    } catch (e) {
      setMensaje({ tipo: "error", texto: (e as Error).message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Cabecera titulo="Vender" subtitulo="Toca un producto para añadirlo al ticket" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="relative mb-4">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              className="campo pl-10"
              placeholder="Buscar por nombre, categoría o código de barras…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && filtrados.length === 1) añadir(filtrados[0]); }}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {filtrados.map((p) => (
              <button
                key={p.id}
                onClick={() => añadir(p)}
                disabled={p.stock_actual <= 0}
                className="tarjeta flex flex-col items-start p-4 text-left transition hover:-translate-y-0.5 hover:border-marca-500 hover:shadow-md disabled:opacity-40"
              >
                <span className="text-xs text-slate-400">{p.categoria}</span>
                <span className="mt-1 line-clamp-2 text-sm font-semibold">{p.producto}</span>
                <span className="mt-auto pt-3 text-lg font-bold text-marca-700">
                  {euros(p.precio_venta)}
                  {p.unidad_medida === "kg" && <span className="text-xs font-medium text-slate-400"> /kg</span>}
                </span>
              </button>
            ))}
          </div>
          {productos && !filtrados.length && <Vacio>No hay productos con ese nombre</Vacio>}
        </div>

        <aside className="tarjeta flex h-fit flex-col p-5 lg:sticky lg:top-8">
          <h2 className="mb-4 font-semibold">Ticket</h2>
          {carrito.length === 0 ? <Vacio>Vacío</Vacio> : (
            <ul className="mb-4 divide-y divide-slate-100">
              {carrito.map(({ producto: p, cantidad }) => (
                <li key={p.id} className="py-3">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-medium">{p.producto}</span>
                    <span className="font-semibold">{euros(cantidad * p.precio_venta)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {p.unidad_medida === "kg" ? (
                      <label className="flex items-center gap-2 text-xs text-slate-500">
                        Peso
                        <input
                          type="number" step="0.005" min="0" value={cantidad}
                          onChange={(e) => cambiar(p.id, Number(e.target.value))}
                          className="campo w-24 py-1.5"
                        /> kg
                      </label>
                    ) : (
                      <>
                        <button className="boton-sec p-1.5" onClick={() => cambiar(p.id, cantidad - 1)}><Minus className="size-3.5" /></button>
                        <span className="w-8 text-center text-sm font-semibold">{cantidad}</span>
                        <button className="boton-sec p-1.5" onClick={() => cambiar(p.id, cantidad + 1)}><Plus className="size-3.5" /></button>
                      </>
                    )}
                    <button className="ml-auto text-slate-400 hover:text-rose-600" onClick={() => cambiar(p.id, 0)}><Trash2 className="size-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mb-4 grid grid-cols-3 gap-2">
            {PAGOS.map(({ id, nombre, icono: Icono }) => (
              <button
                key={id}
                onClick={() => setPago(id)}
                className={`flex flex-col items-center gap-1 rounded-xl border py-2.5 text-xs font-medium transition ${
                  pago === id ? "border-marca-500 bg-marca-50 text-marca-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <Icono className="size-4" /> {nombre}
              </button>
            ))}
          </div>

          <div className="mb-4 flex items-baseline justify-between border-t border-slate-100 pt-4">
            <span className="text-sm text-slate-500">Total</span>
            <span className="text-3xl font-bold tracking-tight">{euros(total)}</span>
          </div>
          <button className="boton w-full py-3 text-base" disabled={!carrito.length || enviando} onClick={cobrar}>
            Cobrar
          </button>
          {mensaje && <div className="mt-4"><Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso></div>}
        </aside>
      </div>
    </>
  );
}
