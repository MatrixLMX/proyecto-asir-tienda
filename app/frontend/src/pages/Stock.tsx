import { useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, PackageMinus, PackageSearch, Search } from "lucide-react";
import { cantidad, euros, post, type ProductoStock } from "../api";
import { Cabecera, Esqueleto, Insignia, Modal, Pestañas, Vacio, emitirCambio, useAviso, useDatos } from "../ui";

const MOTIVOS = [
  { id: "roto", nombre: "Roto o estropeado" },
  { id: "caducado", nombre: "Caducado" },
  { id: "consumo_propio", nombre: "Consumo propio" },
  { id: "robo", nombre: "Robo o desaparecido" },
  { id: "otro", nombre: "Otro motivo" },
] as const;

type Filtro = "todos" | "BAJO" | "AGOTADO";
type Orden = "producto" | "categoria" | "precio_venta" | "stock_actual";

export default function Stock() {
  const { datos } = useDatos<ProductoStock[]>("/productos");
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [orden, setOrden] = useState<{ campo: Orden; asc: boolean }>({ campo: "producto", asc: true });
  const [merma, setMerma] = useState<ProductoStock | null>(null);

  const cuenta = (e: Filtro) => (datos ?? []).filter((p) => e === "todos" || p.estado === e).length;
  const filas = useMemo(() => {
    const texto = q.toLowerCase();
    return (datos ?? [])
      .filter((p) => (filtro === "todos" || p.estado === filtro) &&
        (p.producto.toLowerCase().includes(texto) || p.categoria.toLowerCase().includes(texto)))
      .sort((a, b) => {
        const x = a[orden.campo], y = b[orden.campo];
        const r = typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y), "es");
        return orden.asc ? r : -r;
      });
  }, [datos, q, filtro, orden]);

  const Columna = ({ campo, children, derecha }: { campo: Orden; children: string; derecha?: boolean }) => (
    <th className={derecha ? "text-right" : ""}>
      <button
        onClick={() => setOrden((o) => ({ campo, asc: o.campo === campo ? !o.asc : true }))}
        className={`inline-flex items-center gap-1 uppercase hover:text-texto ${orden.campo === campo ? "text-texto" : ""}`}
      >
        {children}
        {orden.campo === campo && (orden.asc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  return (
    <>
      <Cabecera titulo="Stock" subtitulo="Se actualiza solo con cada compra, venta o merma" />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-tenue" />
          <input className="campo pl-10" placeholder="Buscar producto o categoría…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Pestañas<Filtro>
          valor={filtro}
          alCambiar={setFiltro}
          opciones={[
            { id: "todos", nombre: "Todos", cuenta: cuenta("todos") },
            { id: "BAJO", nombre: "Bajo", cuenta: cuenta("BAJO") },
            { id: "AGOTADO", nombre: "Agotado", cuenta: cuenta("AGOTADO") },
          ]}
        />
      </div>

      <div className="tarjeta overflow-x-auto">
        {!datos ? (
          <div className="space-y-2 p-5">{Array.from({ length: 8 }, (_, i) => <Esqueleto key={i} className="h-10" />)}</div>
        ) : filas.length ? (
          <table className="tabla w-full text-sm">
            <thead>
              <tr>
                <Columna campo="producto">Producto</Columna>
                <Columna campo="categoria">Categoría</Columna>
                <Columna campo="precio_venta" derecha>PVP</Columna>
                <Columna campo="stock_actual" derecha>Stock</Columna>
                <th className="hidden sm:table-cell">Nivel</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((p) => {
                const nivel = p.stock_minimo ? Math.min(p.stock_actual / (p.stock_minimo * 3), 1) : 1;
                const color = p.estado === "OK" ? "verde" : p.estado === "BAJO" ? "ambar" : "rojo";
                return (
                  <tr key={p.id}>
                    <td className="font-medium">{p.producto}</td>
                    <td className="text-suave">{p.categoria}</td>
                    <td className="text-right tabular-nums">{euros(p.precio_venta)}</td>
                    <td className="text-right font-semibold tabular-nums">{cantidad(p.stock_actual, p.unidad_medida)}</td>
                    <td className="hidden w-48 sm:table-cell">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-superficie-2">
                          <div
                            className={`h-full rounded-full ${color === "verde" ? "bg-emerald-500" : color === "ambar" ? "bg-amber-400" : "bg-rose-500"}`}
                            style={{ width: `${Math.max(nivel * 100, 3)}%` }}
                          />
                        </div>
                        {p.estado !== "OK" && <Insignia color={color}>{p.estado.toLowerCase()}</Insignia>}
                      </div>
                    </td>
                    <td className="w-10 text-right">
                      <button
                        className="rounded-lg p-1.5 text-tenue hover:bg-superficie-2 hover:text-rose-500 disabled:opacity-30"
                        disabled={p.stock_actual <= 0} onClick={() => setMerma(p)}
                        title="Registrar merma (roto, caducado…)" aria-label={`Registrar merma de ${p.producto}`}
                      >
                        <PackageMinus className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Vacio icono={<PackageSearch className="size-6" />} titulo="Sin resultados" />}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-tenue">
        <PackageMinus className="size-3.5" /> Usa este botón para quitar del stock lo que se rompe, se gasta en casa o desaparece.
      </p>

      <RegistrarMerma producto={merma} alCerrar={() => setMerma(null)} />
    </>
  );
}

function RegistrarMerma({ producto: p, alCerrar }: { producto: ProductoStock | null; alCerrar: () => void }) {
  const avisar = useAviso();
  const [n, setN] = useState("1");
  const [motivo, setMotivo] = useState<(typeof MOTIVOS)[number]["id"]>("roto");
  const [notas, setNotas] = useState("");
  const valor = Number(n.replace(",", ".")) || 0;
  const valido = p && valor > 0 && valor <= p.stock_actual && (p.unidad_medida === "kg" || Number.isInteger(valor));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!p) return;
    try {
      await post("/mermas", { producto_id: p.id, cantidad: valor, motivo, notas: notas || null });
      avisar("ok", `${cantidad(valor, p.unidad_medida)} de ${p.producto} retirado del stock`);
      emitirCambio();
      setN("1"); setNotas(""); alCerrar();
    } catch (err) {
      avisar("error", (err as Error).message);
    }
  }

  return (
    <Modal abierto={!!p} alCerrar={alCerrar} titulo="Registrar merma">
      {p && (
        <form onSubmit={guardar} className="space-y-4">
          <p className="rounded-xl bg-superficie-2 px-4 py-3 text-sm">
            <b>{p.producto}</b><span className="block text-xs text-tenue">Hay {cantidad(p.stock_actual, p.unidad_medida)} en stock</span>
          </p>
          <div>
            <label className="etiqueta" htmlFor="m-cant">Cantidad {p.unidad_medida === "kg" ? "(kg)" : "(unidades)"}</label>
            <input id="m-cant" className="campo" inputMode="decimal" autoFocus value={n} onChange={(e) => setN(e.target.value)} />
          </div>
          <div>
            <span className="etiqueta">Motivo</span>
            <div className="grid grid-cols-2 gap-2">
              {MOTIVOS.map((m) => (
                <button type="button" key={m.id} onClick={() => setMotivo(m.id)}
                  className={`rounded-xl border px-3 py-2 text-sm ${motivo === m.id ? "border-marca-500 bg-marca-suave font-medium text-marca-fuerte" : "border-borde text-suave"}`}>
                  {m.nombre}
                </button>
              ))}
            </div>
          </div>
          <div><label className="etiqueta" htmlFor="m-notas">Notas (opcional)</label><input id="m-notas" className="campo" maxLength={255} value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          <p className="text-xs text-tenue">Cuenta como pérdida en los beneficios y queda en el registro de cambios.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="boton-sec" onClick={alCerrar}>Cancelar</button>
            <button className="boton-peligro" disabled={!valido}>Quitar del stock</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
