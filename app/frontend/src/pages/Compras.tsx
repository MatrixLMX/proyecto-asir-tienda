import { useState } from "react";
import { CalendarClock, ClipboardList, Download, PackageCheck, Plus, Trash2, Truck } from "lucide-react";
import { borrar, cantidad, descargarCsv, euros, fecha, fechaHora, post } from "../api";
import { Cabecera, Confirmar, Esqueleto, Modal, Pestañas, Vacio, emitirCambio, useAviso, useDatos } from "../ui";

export interface ProductoAdmin {
  id: number;
  nombre: string;
  codigo_barras: string | null;
  categoria: string;
  categoria_id: number;
  proveedor: string | null;
  proveedor_id: number | null;
  unidad_medida: "unidad" | "kg";
  precio_venta: number;
  coste_medio: number;
  iva: number;
  stock_actual: number;
  stock_minimo: number;
  controla_caducidad: number;
  vida_util_dias: number | null;
  dias_aviso_caducidad: number;
  activo: number;
}
interface Proveedor { id: number; nombre: string }
interface Linea { clave: number; producto_id: number; cantidad: number; coste_unitario: number; fecha_caducidad: string }

interface Sugerencia {
  id: number; producto: string; proveedor: string | null; proveedor_id: number | null; unidad_medida: string;
  stock_actual: number; stock_minimo: number; cantidad_sugerida: number; coste_medio: number; coste_estimado: number;
}
interface Precarga { proveedor: number | ""; lineas: Linea[] }

let siguiente = 0;
const lineaVacia = (): Linea => ({ clave: siguiente++, producto_id: 0, cantidad: 1, coste_unitario: 0, fecha_caducidad: "" });

type Vista = "nueva" | "pedido" | "historial";

export default function Compras() {
  const [vista, setVista] = useState<Vista>("nueva");
  const [precarga, setPrecarga] = useState<Precarga | null>(null);
  const [version, setVersion] = useState(0);

  const cargarPedido = (p: Precarga) => { setPrecarga(p); setVersion((v) => v + 1); setVista("nueva"); };

  return (
    <>
      <Cabecera titulo="Compras" subtitulo="Lo que entra de los proveedores. Los costes van sin IVA.">
        <Pestañas<Vista> valor={vista} alCambiar={setVista} opciones={[
          { id: "nueva", nombre: "Registrar compra" }, { id: "pedido", nombre: "Qué pedir" }, { id: "historial", nombre: "Historial" },
        ]} />
      </Cabecera>
      {vista === "nueva" && <NuevaCompra key={version} inicial={precarga} />}
      {vista === "pedido" && <PedidoSugerido alCargar={cargarPedido} />}
      {vista === "historial" && <Historial />}
    </>
  );
}

function NuevaCompra({ inicial }: { inicial: Precarga | null }) {
  const productos = useDatos<ProductoAdmin[]>("/productos/admin");
  const proveedores = useDatos<Proveedor[]>("/proveedores");
  const avisar = useAviso();
  const [proveedor, setProveedor] = useState<number | "">(inicial?.proveedor ?? "");
  const [factura, setFactura] = useState("");
  const [lineas, setLineas] = useState<Linea[]>(inicial?.lineas.length ? inicial.lineas : [lineaVacia()]);
  const [guardando, setGuardando] = useState(false);

  const prod = (id: number) => productos.datos?.find((p) => p.id === id);
  // Primero los productos de este proveedor, después el resto
  const lista = (productos.datos ?? [])
    .filter((p) => p.activo)
    .sort((a, b) => Number(b.proveedor_id === proveedor) - Number(a.proveedor_id === proveedor) || a.nombre.localeCompare(b.nombre, "es"));
  const validas = lineas.filter((l) => l.producto_id && l.cantidad > 0);
  const total = validas.reduce((s, l) => s + l.cantidad * l.coste_unitario, 0);
  const editar = (clave: number, cambio: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));

  async function guardar() {
    setGuardando(true);
    try {
      const r = await post<{ id: number; total_sin_iva: number }>("/compras", {
        proveedor_id: proveedor || null,
        numero_factura: factura || null,
        lineas: validas.map(({ clave: _, ...l }) => ({ ...l, fecha_caducidad: l.fecha_caducidad || null })),
      });
      avisar("ok", `Compra nº ${r.id} guardada (${euros(r.total_sin_iva)} sin IVA). Stock actualizado.`);
      setLineas([lineaVacia()]);
      setFactura("");
      emitirCambio();
    } catch (e) {
      avisar("error", (e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="tarjeta p-5">
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="etiqueta" htmlFor="proveedor">Proveedor</label>
              <select id="proveedor" className="campo" value={proveedor} onChange={(e) => setProveedor(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Sin proveedor</option>
                {proveedores.datos?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="etiqueta" htmlFor="factura">Nº de factura o albarán</label>
              <input id="factura" className="campo" value={factura} onChange={(e) => setFactura(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <div className="space-y-3">
            {lineas.map((l, i) => {
              const p = prod(l.producto_id);
              return (
                <div key={l.clave} className="animar-entrada rounded-2xl border border-borde bg-superficie-2/50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-tenue">LÍNEA {i + 1}</span>
                    {lineas.length > 1 && (
                      <button className="text-tenue hover:text-rose-500" onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))} aria-label="Quitar línea">
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
                    <div>
                      <label className="etiqueta">Producto</label>
                      <select className="campo" value={l.producto_id} onChange={(e) => {
                        const np = prod(Number(e.target.value));
                        editar(l.clave, { producto_id: Number(e.target.value), coste_unitario: np ? Number(np.coste_medio.toFixed(2)) : 0, fecha_caducidad: "" });
                      }}>
                        <option value={0}>Elige un producto…</option>
                        {lista.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="etiqueta">Cantidad {p?.unidad_medida === "kg" ? "(kg)" : "(uds.)"}</label>
                      <input className="campo" type="number" inputMode="decimal" min="0" step={p?.unidad_medida === "kg" ? "0.001" : "1"} value={l.cantidad} onChange={(e) => editar(l.clave, { cantidad: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label className="etiqueta">Coste/ud. sin IVA</label>
                      <input className="campo" type="number" inputMode="decimal" min="0" step="0.01" value={l.coste_unitario} onChange={(e) => editar(l.clave, { coste_unitario: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label className="etiqueta">Caducidad</label>
                      <input className="campo" type="date" value={l.fecha_caducidad} disabled={!p?.controla_caducidad} onChange={(e) => editar(l.clave, { fecha_caducidad: e.target.value })} />
                    </div>
                  </div>
                  {p && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tenue">
                      <span>Stock actual: <b className="text-suave">{cantidad(p.stock_actual, p.unidad_medida)}</b></span>
                      <span>Coste medio: <b className="text-suave">{euros(p.coste_medio)}</b></span>
                      <span>Subtotal: <b className="text-suave">{euros(l.cantidad * l.coste_unitario)}</b></span>
                      {p.controla_caducidad && !l.fecha_caducidad ? (
                        <span className={`flex items-center gap-1 ${p.vida_util_dias ? "" : "font-medium text-amber-600 dark:text-amber-400"}`}>
                          <CalendarClock className="size-3.5" />
                          {p.vida_util_dias ? `Sin fecha: se calcula sola (hoy + ${p.vida_util_dias} días)` : "Este producto necesita fecha de caducidad"}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button className="boton-sec mt-3 w-full border-dashed" onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>
            <Plus className="size-4" /> Añadir línea
          </button>
        </div>

        <aside className="tarjeta h-fit p-5 xl:sticky xl:top-8">
          <h2 className="mb-4 flex items-center gap-2 font-semibold"><Truck className="size-5 text-marca-500" /> Resumen</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-suave">Proveedor</dt><dd className="font-medium">{proveedores.datos?.find((p) => p.id === proveedor)?.nombre ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-suave">Líneas</dt><dd className="font-medium">{validas.length}</dd></div>
          </dl>
          <div className="my-4 flex items-baseline justify-between border-t border-borde pt-4">
            <span className="text-sm text-suave">Total sin IVA</span>
            <span className="text-2xl font-bold tabular-nums">{euros(total)}</span>
          </div>
          <button className="boton w-full py-3" disabled={!validas.length || guardando} onClick={guardar}>Guardar compra</button>
          <p className="mt-3 text-center text-xs text-tenue">El stock, el coste medio y los lotes se actualizan solos.</p>
        </aside>
      </div>
    </>
  );
}

/* =====================================================================
   Qué pedir: productos con stock bajo agrupados por proveedor
   ===================================================================== */
function PedidoSugerido({ alCargar }: { alCargar: (p: Precarga) => void }) {
  const { datos } = useDatos<Sugerencia[]>("/pedido-sugerido");
  const grupos = new Map<string, Sugerencia[]>();
  (datos ?? []).forEach((s) => {
    const clave = s.proveedor ?? "Sin proveedor";
    grupos.set(clave, [...(grupos.get(clave) ?? []), s]);
  });

  const cargar = (lista: Sugerencia[]) => alCargar({
    proveedor: lista[0].proveedor_id ?? "",
    lineas: lista.map((s) => ({
      clave: siguiente++, producto_id: s.id, fecha_caducidad: "",
      cantidad: s.unidad_medida === "kg" ? s.cantidad_sugerida : Math.ceil(s.cantidad_sugerida) || 1,
      coste_unitario: s.coste_medio,
    })),
  });

  if (!datos) return <div className="grid gap-4 md:grid-cols-2">{[1, 2].map((i) => <Esqueleto key={i} className="h-48" />)}</div>;
  if (!datos.length) return <div className="tarjeta"><Vacio icono={<PackageCheck className="size-6" />} titulo="No falta nada">Ningún producto está por debajo de su stock mínimo.</Vacio></div>;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-suave">Cantidad sugerida: lo que falta para llegar al doble del stock mínimo. Ajústala al registrar la compra.</p>
        <button className="boton-sec" onClick={() => descargarCsv("pedido_sugerido", datos, [["proveedor", "Proveedor"], ["producto", "Producto"], ["stock_actual", "Stock"], ["cantidad_sugerida", "Pedir"], ["coste_estimado", "Coste estimado"]])}>
          <Download className="size-4" /> CSV
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[...grupos].map(([proveedor, lista]) => (
          <div key={proveedor} className="tarjeta flex flex-col">
            <div className="flex items-center justify-between border-b border-borde p-4">
              <h2 className="flex items-center gap-2 font-semibold"><Truck className="size-4 text-marca-500" />{proveedor}</h2>
              <span className="text-sm text-suave">aprox. {euros(lista.reduce((t, s) => t + s.coste_estimado, 0))}</span>
            </div>
            <ul className="flex-1 divide-y divide-borde">
              {lista.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span><span className="font-medium">{s.producto}</span><span className="block text-xs text-tenue">quedan {cantidad(s.stock_actual, s.unidad_medida)} · mínimo {cantidad(s.stock_minimo, s.unidad_medida)}</span></span>
                  <span className="whitespace-nowrap font-semibold tabular-nums">{cantidad(s.cantidad_sugerida, s.unidad_medida)}</span>
                </li>
              ))}
            </ul>
            <div className="p-4 pt-2"><button className="boton-sec w-full" onClick={() => cargar(lista)}><ClipboardList className="size-4" /> Registrar esta compra</button></div>
          </div>
        ))}
      </div>
    </>
  );
}

/* =====================================================================
   Historial de compras
   ===================================================================== */
interface CompraResumen { id: number; fecha: string; numero_factura: string | null; total_sin_iva: number; usuario: string | null; proveedor: string | null; lineas: number }
interface LineaCompraDetalle { id: number; producto: string; unidad_medida: string; cantidad: number; coste_unitario: number; fecha_caducidad: string | null; subtotal: number }
type CompraDetalle = Omit<CompraResumen, "lineas"> & { notas: string | null; lineas: LineaCompraDetalle[] };

function Historial() {
  const avisar = useAviso();
  const [dias, setDias] = useState(90);
  const { datos } = useDatos<CompraResumen[]>(`/compras?dias=${dias}`);
  const [abierta, setAbierta] = useState<number | null>(null);
  const detalle = useDatos<CompraDetalle>(abierta ? `/compras/${abierta}` : null, false);
  const [aBorrar, setABorrar] = useState<number | null>(null);

  async function borrarCompra(id: number) {
    try {
      await borrar(`/compras/${id}`);
      avisar("ok", `Compra nº ${id} borrada. El stock se ha descontado.`);
      setAbierta(null);
      emitirCambio();
    } catch (e) {
      avisar("error", (e as Error).message);
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="campo w-auto py-1.5" aria-label="Periodo" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
          <option value={30}>Últimos 30 días</option><option value={90}>Últimos 3 meses</option><option value={365}>Último año</option><option value={3650}>Todas</option>
        </select>
        {datos && <span className="text-sm text-suave">{datos.length} compras · {euros(datos.reduce((t, c) => t + c.total_sin_iva, 0))} sin IVA</span>}
      </div>
      <div className="tarjeta overflow-x-auto">
        {!datos ? <div className="p-5"><Esqueleto className="h-40" /></div> : !datos.length ? <Vacio icono={<Truck className="size-6" />} titulo="Sin compras en este periodo" /> : (
          <table className="tabla w-full text-sm">
            <thead><tr><th>Nº</th><th>Fecha</th><th>Proveedor</th><th className="hidden sm:table-cell">Factura</th><th className="hidden text-right sm:table-cell">Líneas</th><th className="text-right">Total sin IVA</th></tr></thead>
            <tbody>
              {datos.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-superficie-2/60" onClick={() => setAbierta(c.id)}>
                  <td className="font-medium tabular-nums">{c.id}</td>
                  <td className="text-suave">{fecha(c.fecha)}</td>
                  <td>{c.proveedor ?? "—"}</td>
                  <td className="hidden text-suave sm:table-cell">{c.numero_factura ?? "—"}</td>
                  <td className="hidden text-right tabular-nums sm:table-cell">{c.lineas}</td>
                  <td className="text-right font-semibold tabular-nums">{euros(c.total_sin_iva)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal abierto={abierta != null} alCerrar={() => setAbierta(null)} titulo={`Compra nº ${abierta ?? ""}`} ancho="max-w-xl">
        {!detalle.datos || detalle.datos.id !== abierta ? <Esqueleto className="h-40" /> : (
          <>
            <p className="mb-3 text-sm text-suave">
              {fechaHora(detalle.datos.fecha)} · {detalle.datos.proveedor ?? "Sin proveedor"}{detalle.datos.numero_factura ? ` · factura ${detalle.datos.numero_factura}` : ""} · {detalle.datos.usuario ?? "—"}
            </p>
            <ul className="mb-4 max-h-[45vh] divide-y divide-borde overflow-y-auto rounded-xl border border-borde">
              {detalle.datos.lineas.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                  <span><span className="font-medium">{l.producto}</span><span className="block text-xs text-tenue">{cantidad(l.cantidad, l.unidad_medida)} × {euros(l.coste_unitario)}{l.fecha_caducidad ? ` · caduca ${fecha(l.fecha_caducidad)}` : ""}</span></span>
                  <span className="font-semibold tabular-nums">{euros(l.subtotal)}</span>
                </li>
              ))}
            </ul>
            <div className="mb-5 flex items-baseline justify-between"><span className="text-suave">Total sin IVA</span><span className="text-2xl font-bold tabular-nums">{euros(detalle.datos.total_sin_iva)}</span></div>
            <div className="flex justify-end">
              <button className="boton-sec text-rose-600 dark:text-rose-400" onClick={() => setABorrar(detalle.datos!.id)}><Trash2 className="size-4" /> Borrar compra</button>
            </div>
          </>
        )}
      </Modal>

      <Confirmar abierto={aBorrar != null} alCerrar={() => setABorrar(null)} alConfirmar={() => aBorrar && borrarCompra(aBorrar)}
        titulo="Borrar compra" textoBoton="Borrar" peligro
        mensaje="Se quitará del stock todo lo que entró con esta compra (útil si se metió mal). Si parte ya se ha vendido, no se podrá borrar." />
    </>
  );
}
