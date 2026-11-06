import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { api, post } from "./api";
import { useAviso } from "./ui";

const deB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const soportado = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
// En iPhone los avisos solo funcionan con la web instalada en la pantalla de inicio
const esIosSinInstalar = () => /iphone|ipad/i.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches;

/** Activa o quita el aviso de cada mañana en este móvil. */
export function AvisosMovil() {
  const avisar = useAviso();
  const [estado, setEstado] = useState<"cargando" | "activo" | "inactivo" | "no">("cargando");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!soportado()) { setEstado("no"); return; }
    navigator.serviceWorker.getRegistration("/sw.js")
      .then((r) => r?.pushManager.getSubscription())
      .then((s) => setEstado(s ? "activo" : "inactivo"))
      .catch(() => setEstado("inactivo"));
  }, []);

  async function activar() {
    setOcupado(true);
    try {
      if (await Notification.requestPermission() !== "granted") throw new Error("Hay que permitir las notificaciones en el navegador");
      const { clave } = await api<{ clave: string }>("/avisos/clave");
      const registro = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: deB64(clave) });
      await post("/avisos/suscribir", sub.toJSON());
      setEstado("activo");
      avisar("ok", "Avisos activados en este dispositivo");
    } catch (e) { avisar("error", (e as Error).message); } finally { setOcupado(false); }
  }

  async function quitar() {
    setOcupado(true);
    try {
      const registro = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await registro?.pushManager.getSubscription();
      if (sub) {
        await post("/avisos/quitar", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEstado("inactivo");
      avisar("ok", "Avisos quitados de este dispositivo");
    } catch (e) { avisar("error", (e as Error).message); } finally { setOcupado(false); }
  }

  async function probar() {
    setOcupado(true);
    try {
      await post("/avisos/probar", {});
      avisar("ok", "Aviso enviado: tiene que llegar en unos segundos");
    } catch (e) { avisar("error", (e as Error).message); } finally { setOcupado(false); }
  }

  if (estado === "cargando") return null;
  return (
    <div className="tarjeta mb-5 flex flex-wrap items-center gap-3 p-4 text-sm">
      {estado === "activo" ? <Bell className="size-5 text-marca-500" /> : <BellOff className="size-5 text-tenue" />}
      <p className="min-w-52 flex-1">
        <b>Aviso cada mañana</b>
        <span className="block text-xs text-tenue">
          {estado === "activo" ? "Activo en este dispositivo. Solo llega si hay algo que revisar."
            : estado === "no" ? (esIosSinInstalar() ? "En iPhone, instala primero la web: Compartir → Añadir a pantalla de inicio." : "Este navegador no admite avisos.")
            : "Te dice en el móvil qué retirar, qué caduca pronto y cuánto hay que pedir."}
        </span>
      </p>
      {estado === "activo" && <button className="boton-sec py-1.5" disabled={ocupado} onClick={probar}>Probar aviso</button>}
      {estado === "activo" && <button className="boton-sec py-1.5" disabled={ocupado} onClick={quitar}>Quitar</button>}
      {estado === "inactivo" && <button className="boton py-1.5" disabled={ocupado} onClick={activar}>Activar</button>}
    </div>
  );
}
