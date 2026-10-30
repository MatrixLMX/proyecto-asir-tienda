import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, PackageSearch, Search } from "lucide-react";
import { cantidad, euros, type ProductoStock } from "../api";
import { Cabecera, Esqueleto, Insignia, Pestañas, Vacio, useDatos } from "../ui";

type Filtro = "todos" | "BAJO" | "AGOTADO";
type Orden = "producto" | "categoria" | "precio_venta" | "stock_actual";

export default function Stock() {
  const { datos } = useDatos<ProductoStock[]>("/productos");
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [orden, setOrden] = useState<{ campo: Orden; asc: boolean }>({ campo: "producto", asc: true });

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
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Vacio icono={<PackageSearch className="size-6" />} titulo="Sin resultados" />}
      </div>
    </>
  );
}
