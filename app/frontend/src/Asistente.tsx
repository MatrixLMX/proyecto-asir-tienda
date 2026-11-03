import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import { Bot, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { post, type Rol } from "./api";

interface Mensaje { de: "yo" | "asistente"; texto: string; error?: boolean }

const SUGERENCIAS: Record<Rol, string[]> = {
  admin: [
    "¿Cuánto he ganado este mes de verdad?",
    "¿Qué productos me dejan menos margen?",
    "¿Qué tengo que pedir y a quién?",
    "¿Qué caduca esta semana?",
  ],
  dependiente: [
    "¿Qué caduca esta semana?",
    "¿Qué productos están agotados?",
    "¿Cuántas Coca-Colas quedan?",
  ],
};

const nuevaConversacion = () => Math.random().toString(36).slice(2, 10);

export default function Asistente({ disponible, rol }: { disponible: boolean; rol: Rol }) {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [conversacion, setConversacion] = useState(nuevaConversacion);
  const fin = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => fin.current?.scrollIntoView({ behavior: "smooth" }), [mensajes, pensando]);
  useEffect(() => { if (abierto) entrada.current?.focus(); }, [abierto]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  async function enviar(pregunta: string) {
    if (!pregunta.trim() || pensando) return;
    setMensajes((m) => [...m, { de: "yo", texto: pregunta }]);
    setTexto("");
    setPensando(true);
    try {
      const r = await post<{ respuesta: string }>("/asistente", { mensaje: pregunta, conversacion });
      setMensajes((m) => [...m, { de: "asistente", texto: r.respuesta || "No he obtenido respuesta. Prueba otra vez." }]);
    } catch (e) {
      setMensajes((m) => [...m, { de: "asistente", texto: (e as Error).message, error: true }]);
    } finally {
      setPensando(false);
      entrada.current?.focus();
    }
  }

  const alEnviar = (e: FormEvent) => { e.preventDefault(); enviar(texto); };

  return (
    <>
      <button
        onClick={() => setAbierto((a) => !a)}
        className="fixed bottom-[82px] right-4 z-40 grid size-14 place-items-center rounded-full bg-gradient-to-br from-marca-500 to-marca-700 text-white shadow-xl shadow-marca-700/30 transition hover:scale-105 active:scale-95 lg:bottom-6 lg:right-6"
        aria-label={abierto ? "Cerrar asistente" : "Abrir asistente"}
        title="Asistente"
      >
        {abierto ? <X className="size-6" /> : <Sparkles className="size-6" />}
      </button>

      {abierto && (
        <div className="animar-modal fixed inset-x-3 bottom-[160px] top-16 z-40 flex flex-col overflow-hidden rounded-3xl border border-borde bg-superficie shadow-2xl sm:inset-x-auto sm:right-4 sm:top-auto sm:h-[600px] sm:max-h-[calc(100vh-180px)] sm:w-[420px] lg:bottom-24 lg:right-6">
          <div className="flex items-center gap-3 bg-gradient-to-r from-marca-600 to-marca-700 px-5 py-4 text-white">
            <div className="grid size-9 place-items-center rounded-xl bg-white/15"><Bot className="size-5" /></div>
            <div className="flex-1">
              <p className="font-semibold leading-tight">Asistente de la tienda</p>
              <p className="text-xs text-white/70">Stock, caducidades{rol === "admin" ? " y beneficios" : ""}</p>
            </div>
            {mensajes.length > 0 && (
              <button title="Nueva conversación" aria-label="Nueva conversación" className="rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => { setMensajes([]); setConversacion(nuevaConversacion()); }}>
                <RotateCcw className="size-4" />
              </button>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-fondo p-4">
            {!disponible && (
              <div className="rounded-2xl border border-amber-300/50 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                <p className="mb-1 font-semibold">El asistente no está activado</p>
                Crea una clave gratuita en <b>aistudio.google.com/apikey</b>, ponla en <code>GOOGLE_API_KEY</code> del fichero <code>.env</code> y reinicia el backend.
              </div>
            )}
            {disponible && mensajes.length === 0 && (
              <div className="pt-4">
                <div className="mb-5 text-center">
                  <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-marca-suave text-marca-fuerte"><Sparkles className="size-6" /></div>
                  <p className="font-semibold">¿En qué te ayudo?</p>
                  <p className="text-sm text-tenue">Pregúntame lo que quieras de la tienda</p>
                </div>
                <div className="space-y-2">
                  {SUGERENCIAS[rol].map((s) => (
                    <button key={s} onClick={() => enviar(s)} className="block w-full rounded-xl border border-borde bg-superficie px-3.5 py-2.5 text-left text-sm transition hover:border-marca-500 hover:text-marca-fuerte">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {mensajes.map((m, i) => (
              <div key={i} className={`animar-entrada flex ${m.de === "yo" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`markdown max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                    m.de === "yo" ? "rounded-br-md bg-marca-600 text-white"
                      : m.error ? "rounded-bl-md bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                      : "rounded-bl-md border border-borde bg-superficie"
                  }`}
                >
                  {m.de === "yo" ? m.texto : <ReactMarkdown>{m.texto}</ReactMarkdown>}
                </div>
              </div>
            ))}
            {pensando && (
              <div className="flex w-fit gap-1 rounded-2xl rounded-bl-md border border-borde bg-superficie px-4 py-3.5">
                {[0, 150, 300].map((d) => <span key={d} className="size-2 animate-bounce rounded-full bg-tenue" style={{ animationDelay: `${d}ms` }} />)}
              </div>
            )}
            <div ref={fin} />
          </div>

          <form onSubmit={alEnviar} className="flex gap-2 border-t border-borde bg-superficie p-3">
            <input ref={entrada} className="campo" placeholder={disponible ? "Escribe tu pregunta…" : "Asistente desactivado"} value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!disponible} />
            <button className="boton px-3.5" disabled={!disponible || !texto.trim() || pensando} aria-label="Enviar"><Send className="size-4" /></button>
          </form>
        </div>
      )}
    </>
  );
}
