/** Tarjeta con algo que ha preparado el asistente (una compra, un producto
 *  nuevo, un precio, una merma o una nota). No se guarda nada hasta pulsar
 *  Confirmar; entonces se envía a la ruta normal de la API, que lo valida igual
 *  que si se hubiera hecho desde su pantalla. */
import { useState } from "react";
import { Check, Loader2, PackagePlus, StickyNote, Tag, Trash2, Truck, X } from "lucide-react";
import { euros, patch, post } from "./api";
import { CampoNumero, emitirCambio, useDatos } from "./ui";

export type AccionAsistente =
  | { tipo: "compra"; proveedor_id: number | null; proveedor: string | null;
      lineas: { producto_id: number; nombre: string; unidad_medida: string; cantidad: number; coste_unitario: number; necesita_fecha: boolean; fecha_caducidad?: string }[] }
  | { tipo: "producto"; nombre: string; categoria_id: number | null; iva_id: number | null; unidad_medida: "unidad" | "kg";
      precio_venta: number | null; coste_compra: number | null; stock_inicial: number; codigo_barras: string | null }
  | { tipo: "precio"; producto_id: number; nombre: string; antes: number; precio_venta: number }
  | { tipo: "merma"; producto_id: number; nombre: string; unidad_medida: string; cantidad: number; motivo: string }
  | { tipo: "nota"; texto: string };

type Estado = "pendiente" | "guardando" | "hecho" | "descartado";
interface Opcion { id: number; nombre: string; porcentaje?: number }

const MOTIVOS: Record<string, string> = { caducado: "Caducado", roto: "Roto", robo: "Robo", consumo_propio: "Consumo propio", otro: "Otro" };
const TITULOS = { compra: "Entrada de mercancía", producto: "Producto nuevo", precio: "Cambio de precio", merma: "Retirar stock (merma)", nota: "Nota para el tablón" };
const ICONOS = { compra: Truck, producto: PackagePlus, precio: Tag, merma: Trash2, nota: StickyNote };
const uds = (u: string) => (u === "kg" ? "kg" : "uds.");

export default function TarjetaAccion({ inicial, id }: { inicial: AccionAsistente; id: string }) {
  const [a, setA] = useState<AccionAsistente>(inicial);
  const [estado, setEstado] = useState<Estado>("pendiente");
  const [error, setError] = useState("");
  const editar = (cambio: Partial<AccionAsistente>) => setA((x) => ({ ...x, ...cambio }) as AccionAsistente);
  const Icono = ICONOS[a.tipo];

  const falta = (() => {
    switch (a.tipo) {
      case "compra": return !a.lineas.length ? "No queda ningún producto"
        : a.lineas.some((l) => !(l.cantidad > 0)) ? "Revisa las cantidades"
        : a.lineas.some((l) => l.necesita_fecha && !l.fecha_caducidad) ? "Pon la fecha de caducidad" : "";
      case "producto": return !a.nombre.trim() ? "Pon el nombre" : !a.categoria_id ? "Elige la categoría" : !a.iva_id ? "Elige el IVA" : "";
      case "precio": return a.precio_venta > 0 ? "" : "Pon el precio";
      case "merma": return a.cantidad > 0 ? "" : "Pon la cantidad";
      case "nota": return a.texto.trim() ? "" : "Escribe la nota";
    }
  })();

  async function confirmar() {
    setEstado("guardando");
    setError("");
    try {
      switch (a.tipo) {
        case "compra":
          await post("/compras", {
            proveedor_id: a.proveedor_id, notas: "Desde el asistente",
            lineas: a.lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, coste_unitario: l.coste_unitario, fecha_caducidad: l.fecha_caducidad || null })),
          });
          break;
        case "producto":
          await post("/productos", {
            nombre: a.nombre.trim(), categoria_id: a.categoria_id, iva_id: a.iva_id, unidad_medida: a.unidad_medida, codigo_barras: a.codigo_barras,
            precio_venta: a.precio_venta ?? 0, coste_compra: a.coste_compra ?? 0, stock_inicial: a.stock_inicial || 0,
          });
          break;
        case "precio": await patch(`/productos/${a.producto_id}`, { precio_venta: a.precio_venta }); break;
        case "merma": await post("/mermas", { producto_id: a.producto_id, cantidad: a.cantidad, motivo: a.motivo }); break;
        case "nota": await post("/notas", { texto: a.texto.trim() }); break;
      }
      emitirCambio();
      setEstado("hecho");
    } catch (e) {
      setError((e as Error).message);
      setEstado("pendiente");
    }
  }

  if (estado !== "pendiente" && estado !== "guardando") {
    return (
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${estado === "hecho"
        ? "border-marca-500/30 bg-marca-suave text-marca-fuerte" : "border-borde text-tenue line-through"}`}>
        {estado === "hecho" ? <Check className="size-4 shrink-0" /> : <X className="size-4 shrink-0" />}
        <span className="truncate">{TITULOS[a.tipo]}: {resumen(a)}</span>
        {estado === "hecho" && <span className="ml-auto shrink-0 font-semibold no-underline">Hecho</span>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-marca-500/40 bg-superficie p-3 text-sm shadow-sm">
      <p className="mb-2 flex items-center gap-2 font-semibold"><Icono className="size-4 text-marca-fuerte" /> {TITULOS[a.tipo]}</p>

      {a.tipo === "compra" && <Compra a={a} editar={editar} id={id} />}
      {a.tipo === "producto" && <Producto a={a} editar={editar} id={id} />}
      {a.tipo === "precio" && (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{a.nombre}</p>
            <p className="text-xs text-tenue">Ahora {a.antes ? euros(a.antes) : "sin precio"}</p>
          </div>
          <div className="w-24">
            <label className="etiqueta" htmlFor={`${id}-pvp`}>Nuevo (€)</label>
            <CampoNumero id={`${id}-pvp`} valor={a.precio_venta} alCambiar={(n) => editar({ precio_venta: n ?? 0 })} />
          </div>
        </div>
      )}
      {a.tipo === "merma" && (
        <div className="space-y-2">
          <p className="truncate font-medium">{a.nombre}</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="etiqueta" htmlFor={`${id}-c`}>Cantidad ({uds(a.unidad_medida)})</label>
              <CampoNumero id={`${id}-c`} decimales={a.unidad_medida === "kg" ? 3 : 0} valor={a.cantidad} alCambiar={(n) => editar({ cantidad: n ?? 0 })} />
            </div>
            <div>
              <label className="etiqueta" htmlFor={`${id}-m`}>Motivo</label>
              <select id={`${id}-m`} className="campo" value={a.motivo} onChange={(e) => editar({ motivo: e.target.value })}>
                {Object.entries(MOTIVOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}
      {a.tipo === "nota" && (
        <textarea className="campo min-h-16" maxLength={1000} aria-label="Texto de la nota" value={a.texto} onChange={(e) => editar({ texto: e.target.value })} />
      )}

      {error && <p className="mt-2 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className="boton flex-1 py-2" disabled={!!falta || estado === "guardando"} onClick={confirmar}>
          {estado === "guardando" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {falta || "Confirmar"}
        </button>
        <button type="button" className="boton-sec py-2" disabled={estado === "guardando"} onClick={() => setEstado("descartado")}>Cancelar</button>
      </div>
    </div>
  );
}

function resumen(a: AccionAsistente) {
  switch (a.tipo) {
    case "compra": return a.lineas.map((l) => `${l.nombre} +${String(l.cantidad).replace(".", ",")}`).join(", ");
    case "producto": return a.nombre;
    case "precio": return `${a.nombre} a ${euros(a.precio_venta)}`;
    case "merma": return `${a.nombre} −${String(a.cantidad).replace(".", ",")} ${uds(a.unidad_medida)}`;
    case "nota": return a.texto;
  }
}

type Editar = (cambio: Partial<AccionAsistente>) => void;

function Compra({ a, editar, id }: { a: Extract<AccionAsistente, { tipo: "compra" }>; editar: Editar; id: string }) {
  const proveedores = useDatos<Opcion[]>("/proveedores");
  const cambiarLinea = (i: number, cambio: Partial<typeof a.lineas[number]>) =>
    editar({ lineas: a.lineas.map((l, j) => (j === i ? { ...l, ...cambio } : l)) });
  const total = a.lineas.reduce((s, l) => s + l.cantidad * l.coste_unitario, 0);
  return (
    <div className="space-y-2">
      <div>
        <label className="etiqueta" htmlFor={`${id}-prov`}>Proveedor</label>
        <select id={`${id}-prov`} className="campo" value={a.proveedor_id ?? ""} onChange={(e) => editar({ proveedor_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Sin proveedor</option>
          {proveedores.datos?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        {!a.proveedor_id && a.proveedor && <p className="mt-1 text-xs text-tenue">Has dicho «{a.proveedor}», pero no está en tus proveedores.</p>}
      </div>
      <ul className="space-y-2">
        {a.lineas.map((l, i) => (
          <li key={l.producto_id + "-" + i} className="rounded-xl bg-superficie-2/60 p-2">
            <div className="mb-1 flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate font-medium">{l.nombre}</p>
              <button type="button" className="-m-1 rounded p-1 text-tenue hover:text-rose-500" aria-label={`Quitar ${l.nombre}`}
                onClick={() => editar({ lineas: a.lineas.filter((_, j) => j !== i) })}><X className="size-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="etiqueta" htmlFor={`${id}-c${i}`}>Entran ({uds(l.unidad_medida)})</label>
                <CampoNumero id={`${id}-c${i}`} decimales={l.unidad_medida === "kg" ? 3 : 0} valor={l.cantidad} alCambiar={(n) => cambiarLinea(i, { cantidad: n ?? 0 })} />
              </div>
              <div>
                <label className="etiqueta" htmlFor={`${id}-k${i}`}>Coste sin IVA</label>
                <CampoNumero id={`${id}-k${i}`} decimales={4} valor={l.coste_unitario} alCambiar={(n) => cambiarLinea(i, { coste_unitario: n ?? 0 })} />
              </div>
              {l.necesita_fecha && (
                <div className="col-span-2">
                  <label className="etiqueta" htmlFor={`${id}-f${i}`}>Caduca el</label>
                  <input id={`${id}-f${i}`} type="date" className="campo" value={l.fecha_caducidad ?? ""} onChange={(e) => cambiarLinea(i, { fecha_caducidad: e.target.value })} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-right text-xs text-tenue">Total sin IVA <b className="text-suave">{euros(total)}</b></p>
    </div>
  );
}

function Producto({ a, editar, id }: { a: Extract<AccionAsistente, { tipo: "producto" }>; editar: Editar; id: string }) {
  const categorias = useDatos<Opcion[]>("/categorias");
  const ivas = useDatos<Opcion[]>("/tipos-iva");
  const kg = a.unidad_medida === "kg";
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="col-span-2">
        <label className="etiqueta" htmlFor={`${id}-n`}>Nombre</label>
        <input id={`${id}-n`} className="campo" maxLength={100} value={a.nombre} onChange={(e) => editar({ nombre: e.target.value })} />
      </div>
      <div>
        <label className="etiqueta" htmlFor={`${id}-cat`}>Categoría</label>
        <select id={`${id}-cat`} className="campo" value={a.categoria_id ?? ""} onChange={(e) => editar({ categoria_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Elige…</option>{categorias.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>
      <div>
        <label className="etiqueta" htmlFor={`${id}-iva`}>IVA</label>
        <select id={`${id}-iva`} className="campo" value={a.iva_id ?? ""} onChange={(e) => editar({ iva_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Elige…</option>{ivas.datos?.map((c) => <option key={c.id} value={c.id}>{c.porcentaje} %</option>)}
        </select>
      </div>
      <div>
        <label className="etiqueta" htmlFor={`${id}-pvp`}>Venta con IVA</label>
        <CampoNumero id={`${id}-pvp`} placeholder="Luego" valor={a.precio_venta} alCambiar={(n) => editar({ precio_venta: n })} />
      </div>
      <div>
        <label className="etiqueta" htmlFor={`${id}-k`}>Compra sin IVA</label>
        <CampoNumero id={`${id}-k`} decimales={4} placeholder="Luego" valor={a.coste_compra} alCambiar={(n) => editar({ coste_compra: n })} />
      </div>
      <div>
        <label className="etiqueta" htmlFor={`${id}-s`}>Entran ({kg ? "kg" : "uds."})</label>
        <CampoNumero id={`${id}-s`} decimales={kg ? 3 : 0} valor={a.stock_inicial} alCambiar={(n) => editar({ stock_inicial: n ?? 0 })} />
      </div>
      <label className="flex items-end gap-2 pb-2 text-sm text-suave">
        <input type="checkbox" className="size-4 accent-emerald-600" checked={kg} onChange={(e) => editar({ unidad_medida: e.target.checked ? "kg" : "unidad" })} /> Se vende por kg
      </label>
    </div>
  );
}
