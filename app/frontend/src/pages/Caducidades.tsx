import { useState } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";
import { cantidad, fecha, post, type Caducidad } from "../api";
import { Aviso, Cabecera, Insignia, Vacio, useDatos } from "../ui";

export default function Caducidades() {
  const { datos, recargar } = useDatos<Caducidad[]>("/alertas/caducidades");
  const [error, setError] = useState<string | null>(null);

  async function retirar(c: Caducidad) {
    setError(null);
    try {
      await post("/mermas", { producto_id: c.producto_id, lote_id: c.lote_id, cantidad: c.cantidad_restante, motivo: "caducado" });
      recargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <Cabecera
        titulo="Caducidades"
        subtitulo="Solo aparecen los lotes caducados o que caducan en los próximos días. No hace falta revisar producto por producto."
      />
      {error && <div className="mb-4"><Aviso tipo="error">{error}</Aviso></div>}
      {datos && !datos.length ? (
        <div className="tarjeta flex flex-col items-center p-12 text-center">
          <CheckCircle2 className="mb-3 size-10 text-marca-500" />
          <p className="font-semibold">Todo en orden</p>
          <p className="text-sm text-slate-500">No hay nada caducado ni a punto de caducar.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {datos?.map((c) => (
            <div key={c.lote_id} className={`tarjeta border-l-4 p-5 ${c.estado === "PROXIMO" ? "border-l-amber-400" : "border-l-rose-500"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{c.producto}</p>
                  <p className="text-xs text-slate-400">{c.categoria}</p>
                </div>
                <Insignia color={c.estado === "PROXIMO" ? "ambar" : "rojo"}>
                  {c.estado === "PROXIMO" ? `en ${c.dias_restantes} días` : c.estado.toLowerCase()}
                </Insignia>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div className="text-sm">
                  <p className="text-slate-500">Caduca el {fecha(c.fecha_caducidad)}</p>
                  <p className="font-medium">Quedan {cantidad(c.cantidad_restante, c.unidad_medida)}</p>
                </div>
                {c.estado !== "PROXIMO" && (
                  <button className="boton-sec text-rose-600" onClick={() => retirar(c)}>
                    <Trash2 className="size-4" /> Retirar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {datos && !datos.length ? null : <Vacio>{datos ? `${datos.length} lotes a revisar` : "Cargando…"}</Vacio>}
    </>
  );
}
