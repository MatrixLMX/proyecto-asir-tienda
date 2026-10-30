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

  useEffect(() => fin.current?.scrollIntoView({ behavior: "smooth" }), [mensajes, pensando]);

  async function enviar(pregunta: string) {
    if (!pregunta.trim() || pensando) return;
    setMensajes((m) => [...m, { de: "yo", texto: pregunta }]);
    setTexto("");
    setPensando(true);
    try {
      const r = await post<{ respuesta: string }>("/asistente", { mensaje: pregunta, conversacion });
      setMensajes((m) => [...m, { de: "asistente", texto: r.respuesta }]);
    } catch (e) {
      setMensajes((m) => [...m, { de: "asistente", texto: (e as Error).message, error: true }]);
    } finally {
      setPensando(false);
    }
  }

  const alEnviar = (e: FormEvent) => { e.preventDefault(); enviar(texto); };

  return (
    <>
      <button
        onClick={() => setAbierto((a) => !a)}
        className="fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-gradient-to-br from-marca-500 to-marca-700 text-white shadow-xl shadow-marca-700/30 transition hover:scale-105"
        title="Asistente"
      >
        {abierto ? <X className="size-6" /> : <Sparkles className="size-6" />}
      </button>

      {abierto && (
        <div className="fixed inset-x-3 bottom-24 z-40 flex h-[70vh] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[420px]">
          <div className="flex items-center gap-3 bg-gradient-to-r from-marca-600 to-marca-700 px-5 py-4 text-white">
            <Bot className="size-6" />
            <div className="flex-1">
              <p className="font-semibold">Asistente de la tienda</p>
              <p className="text-xs text-white/70">Pregunta por stock, caducidades{rol === "admin" ? " o beneficios" : ""}</p>
            </div>
            <button title="Nueva conversación" onClick={() => { setMensajes([]); setConversacion(nuevaConversacion()); }}>
              <RotateCcw className="size-4.5 text-white/80 hover:text-white" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
            {!disponible && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                El asistente no está activado. Añade tu clave en <code>ANTHROPIC_API_KEY</code> del fichero <code>.env</code> y reinicia el backend.
              </p>
            )}
            {disponible && mensajes.length === 0 && (
              <div className="space-y-2 pt-2">
                <p className="mb-3 text-center text-sm text-slate-500">¿En qué te ayudo?</p>
                {SUGERENCIAS[rol].map((s) => (
                  <button key={s} onClick={() => enviar(s)} className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-sm transition hover:border-marca-500">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {mensajes.map((m, i) => (
              <div key={i} className={`flex ${m.de === "yo" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`markdown max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                    m.de === "yo" ? "rounded-br-sm bg-marca-600 text-white"
                      : m.error ? "rounded-bl-sm bg-rose-50 text-rose-700"
                      : "rounded-bl-sm border border-slate-200 bg-white"
                  }`}
                >
                  {m.de === "yo" ? m.texto : <ReactMarkdown>{m.texto}</ReactMarkdown>}
                </div>
              </div>
            ))}
            {pensando && (
              <div className="flex gap-1 px-2 py-3">
                {[0, 150, 300].map((d) => <span key={d} className="size-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />)}
              </div>
            )}
            <div ref={fin} />
          </div>

          <form onSubmit={alEnviar} className="flex gap-2 border-t border-slate-100 p-3">
            <input className="campo" placeholder="Escribe tu pregunta…" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!disponible} />
            <button className="boton px-3" disabled={!disponible || !texto.trim() || pensando}><Send className="size-4" /></button>
          </form>
        </div>
      )}
    </>
  );
}
