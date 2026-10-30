import { useState } from "react";
import { CalendarClock, PartyPopper, Trash2 } from "lucide-react";
import { cantidad, fecha, post, type Caducidad } from "../api";
import { Cabecera, Confirmar, Esqueleto, Insignia, Pestañas, Vacio, emitirCambio, useAviso, useDatos } from "../ui";

type Filtro = "todos" | "caducados" | "proximos";

export default function Caducidades() {
  const { datos } = useDatos<Caducidad[]>("/alertas/caducidades");
  const avisar = useAviso();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [aRetirar, setARetirar] = useState<Caducidad | null>(null);

  const caducados = (datos ?? []).filter((c) => c.estado !== "PROXIMO");
  const proximos = (datos ?? []).filter((c) => c.estado === "PROXIMO");
  const lista = filtro === "caducados" ? caducados : filtro === "proximos" ? proximos : datos ?? [];

  async function retirar(c: Caducidad) {
    try {
      await post("/mermas", { producto_id: c.producto_id, lote_id: c.lote_id, cantidad: c.cantidad_restante, motivo: "caducado" });
      avisar("ok", `${c.producto} retirado y registrado como merma`);
      emitirCambio();
    } catch (e) {
      avisar("error", (e as Error).message);
    }
  }

  return (
    <>
      <Cabecera titulo="Caducidades" subtitulo="Solo aparece lo caducado o lo que caduca pronto. No hace falta revisar producto por producto." />

      {datos && datos.length > 0 && (
        <div className="mb-5">
          <Pestañas<Filtro>
            valor={filtro}
            alCambiar={setFiltro}
            opciones={[
              { id: "todos", nombre: "Todos", cuenta: datos.length },
              { id: "caducados", nombre: "Retirar ya", cuenta: caducados.length },
              { id: "proximos", nombre: "Próximos días", cuenta: proximos.length },
            ]}
          />
        </div>
      )}

      {!datos ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Esqueleto key={i} className="h-36" />)}</div>
      ) : !datos.length ? (
        <div className="tarjeta"><Vacio icono={<PartyPopper className="size-6" />} titulo="Todo en orden">No hay nada caducado ni a punto de caducar.</Vacio></div>
      ) : !lista.length ? (
        <div className="tarjeta"><Vacio icono={<CalendarClock className="size-6" />} titulo="Nada en esta lista" /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((c) => {
            const urgente = c.estado !== "PROXIMO";
            return (
              <div key={c.lote_id} className="tarjeta relative overflow-hidden p-5">
                <div className={`absolute inset-y-0 left-0 w-1 ${urgente ? "bg-rose-500" : "bg-amber-400"}`} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.producto}</p>
                    <p className="text-xs text-tenue">{c.categoria}</p>
                  </div>
                  <Insignia color={urgente ? "rojo" : "ambar"}>
                    {c.estado === "CADUCADO" ? "caducado" : c.estado === "CADUCA HOY" ? "caduca hoy" : c.dias_restantes === 1 ? "mañana" : `en ${c.dias_restantes} días`}
                  </Insignia>
                </div>
                <div className="mt-5 flex items-end justify-between gap-3">
                  <div className="text-sm">
                    <p className="text-tenue">{c.estado === "CADUCADO" ? "Caducó" : "Caduca"} el {fecha(c.fecha_caducidad)}</p>
                    <p className="font-semibold">Quedan {cantidad(c.cantidad_restante, c.unidad_medida)}</p>
                  </div>
                  {urgente && (
                    <button className="boton-sec px-3 py-2 text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => setARetirar(c)}>
                      <Trash2 className="size-4" /> Retirar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Confirmar
        abierto={!!aRetirar}
        alCerrar={() => setARetirar(null)}
        alConfirmar={() => aRetirar && retirar(aRetirar)}
        titulo="Retirar producto caducado"
        textoBoton="Retirar"
        peligro
        mensaje={aRetirar && (
          <>Se quitarán <b>{cantidad(aRetirar.cantidad_restante, aRetirar.unidad_medida)}</b> de <b>{aRetirar.producto}</b> del stock y se registrarán como merma por caducidad.</>
        )}
      />
    </>
  );
}
