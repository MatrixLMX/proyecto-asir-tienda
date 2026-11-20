import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import { Bot, Mic, RotateCcw, Send, Sparkles, Square, Volume2, VolumeX, X } from "lucide-react";
import { post, type Rol } from "./api";
import type { AccionAsistente } from "./AccionAsistente";

// Las tarjetas solo se cargan cuando el asistente prepara algo
const TarjetaAccion = lazy(() => import("./AccionAsistente"));

interface Mensaje { de: "yo" | "asistente"; texto: string; error?: boolean; voz?: boolean; acciones?: AccionAsistente[] }
interface Respuesta { respuesta: string; transcripcion?: string; acciones?: AccionAsistente[] }

const SUGERENCIAS: Record<Rol, string[]> = {
  admin: [
    "¿Cuánto he ganado este mes de verdad?",
    "¿Qué tengo que pedir y a quién?",
    "Han llegado 24 aguas a 0,30 €",
    "Sube el aceite a 9,50 €",
  ],
  dependiente: [
    "¿Qué caduca esta semana?",
    "¿Qué está bajo mínimos?",
    "Se han roto 2 yogures",
  ],
};

const nuevaConversacion = () => Math.random().toString(36).slice(2, 10);
const MAX_SEGUNDOS = 90;
const CLAVE_LEER = "tienda_asistente_leer";

// Formatos que entiende Gemini, por orden de preferencia (Chrome y Android
// graban webm; Safari y el iPhone, mp4)
const FORMATOS = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/aac"];
const formatoAudio = () => FORMATOS.find((f) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(f)) ?? "";
const puedeGrabar = () => typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

const aBase64 = (b: Blob) => new Promise<string>((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",", 2)[1] ?? "");
  r.onerror = () => mal(r.error);
  r.readAsDataURL(b);
});

/** Lee en voz alta la respuesta (sin los símbolos del formato). */
function leerEnVoz(texto: string) {
  if (!("speechSynthesis" in window)) return;
  const limpio = texto.replace(/[*_`#>|]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/€/g, " euros").slice(0, 1500);
  const voz = new SpeechSynthesisUtterance(limpio);
  voz.lang = "es-ES";
  const es = speechSynthesis.getVoices().find((v) => v.lang.startsWith("es"));
  if (es) voz.voice = es;
  speechSynthesis.cancel();
  speechSynthesis.speak(voz);
}
const callar = () => { if ("speechSynthesis" in window) speechSynthesis.cancel(); };

export default function Asistente({ disponible, rol }: { disponible: boolean; rol: Rol }) {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [conversacion, setConversacion] = useState(nuevaConversacion);
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [leer, setLeer] = useState(() => { try { return localStorage.getItem(CLAVE_LEER) !== "no"; } catch { return true; } });
  const fin = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const grabadora = useRef<MediaRecorder | null>(null);
  const cancelada = useRef(false);

  // Con llaves: en Chrome reciente scrollIntoView devuelve una promesa y React
  // la tomaría por la función de limpieza (la app entera se caía)
  useEffect(() => { fin.current?.scrollIntoView({ behavior: "smooth" }); }, [mensajes, pensando]);
  useEffect(() => { if (abierto) entrada.current?.focus(); }, [abierto]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);
  // Contador de la grabación; se para sola al llegar al máximo
  useEffect(() => {
    if (!grabando) return;
    setSegundos(0);
    const t = setInterval(() => setSegundos((s) => {
      if (s + 1 >= MAX_SEGUNDOS) grabadora.current?.stop();
      return s + 1;
    }), 1000);
    return () => clearInterval(t);
  }, [grabando]);
  // Al cerrar el asistente se deja de grabar y de hablar
  useEffect(() => {
    if (abierto) return;
    cancelada.current = true;
    grabadora.current?.stop();
    callar();
  }, [abierto]);

  const cambiarLeer = () => {
    const v = !leer;
    setLeer(v);
    if (!v) callar();
    try { localStorage.setItem(CLAVE_LEER, v ? "si" : "no"); } catch { /* sin almacenamiento */ }
  };

  async function preguntar(cuerpo: { mensaje?: string; audio?: { tipo: string; datos: string } }) {
    setPensando(true);
    try {
      const r = await post<Respuesta>("/asistente", { ...cuerpo, conversacion });
      const respuesta = r.respuesta || "No he obtenido respuesta. Prueba otra vez.";
      setMensajes((m) => {
        const copia = [...m];
        // El mensaje de voz se cambia por lo que se ha entendido
        if (r.transcripcion) {
          const i = copia.map((x) => x.de === "yo" && !!x.voz).lastIndexOf(true);
          if (i >= 0) copia[i] = { ...copia[i]!, texto: r.transcripcion };
        }
        return [...copia, { de: "asistente", texto: respuesta, acciones: r.acciones }];
      });
      if (cuerpo.audio && leer) leerEnVoz(respuesta);
    } catch (e) {
      setMensajes((m) => [...m, { de: "asistente", texto: (e as Error).message, error: true }]);
    } finally {
      setPensando(false);
    }
  }

  async function enviar(pregunta: string) {
    if (!pregunta.trim() || pensando) return;
    setMensajes((m) => [...m, { de: "yo", texto: pregunta }]);
    setTexto("");
    await preguntar({ mensaje: pregunta });
    entrada.current?.focus();
  }

  async function empezarAGrabar() {
    if (pensando || grabando) return;
    callar();
    let flujo: MediaStream;
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setMensajes((m) => [...m, { de: "asistente", error: true,
        texto: "No puedo usar el micrófono. Dale permiso al navegador (el candado junto a la dirección) y vuelve a probar." }]);
      return;
    }
    const formato = formatoAudio();
    const rec = new MediaRecorder(flujo, formato ? { mimeType: formato } : undefined);
    const trozos: Blob[] = [];
    const inicio = Date.now();
    cancelada.current = false;
    rec.ondataavailable = (e) => { if (e.data.size) trozos.push(e.data); };
    rec.onstop = async () => {
      flujo.getTracks().forEach((t) => t.stop());
      grabadora.current = null;
      setGrabando(false);
      if (cancelada.current) return;
      if (Date.now() - inicio < 800 || !trozos.length) {
        setMensajes((m) => [...m, { de: "asistente", error: true, texto: "Ha sido muy corto. Pulsa el micrófono, habla y pulsa otra vez para enviar." }]);
        return;
      }
      const tipo = (rec.mimeType || formato || "audio/webm").split(";")[0]!;
      const audio = new Blob(trozos, { type: tipo });
      setMensajes((m) => [...m, { de: "yo", texto: "🎤 Mensaje de voz…", voz: true }]);
      try {
        await preguntar({ audio: { tipo, datos: await aBase64(audio) } });
      } catch { /* preguntar ya avisa */ }
    };
    grabadora.current = rec;
    rec.start();
    setGrabando(true);
  }

  const pararGrabacion = (enviarla: boolean) => {
    cancelada.current = !enviarla;
    grabadora.current?.stop();
  };

  const alEnviar = (e: FormEvent) => { e.preventDefault(); enviar(texto); };
  const conVoz = disponible && puedeGrabar();

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
        <div className="animar-modal fixed inset-x-3 bottom-[160px] top-16 z-40 flex flex-col overflow-hidden rounded-3xl border border-borde bg-superficie shadow-2xl sm:inset-x-auto sm:right-4 sm:top-auto sm:h-[640px] sm:max-h-[calc(100vh-180px)] sm:w-[440px] lg:bottom-24 lg:right-6">
          <div className="flex items-center gap-3 bg-gradient-to-r from-marca-600 to-marca-700 px-5 py-4 text-white">
            <div className="grid size-9 place-items-center rounded-xl bg-white/15"><Bot className="size-5" /></div>
            <div className="flex-1">
              <p className="font-semibold leading-tight">Asistente de la tienda</p>
              <p className="text-xs text-white/70">{rol === "admin" ? "Pregunta o pídele cambios, también hablando" : "Stock, caducidades, mermas y notas"}</p>
            </div>
            {conVoz && "speechSynthesis" in window && (
              <button title={leer ? "No leer las respuestas en voz alta" : "Leer en voz alta las respuestas a mensajes de voz"} aria-pressed={leer}
                aria-label="Leer las respuestas en voz alta" className="rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white" onClick={cambiarLeer}>
                {leer ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </button>
            )}
            {mensajes.length > 0 && (
              <button title="Nueva conversación" aria-label="Nueva conversación" className="rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
                onClick={() => { callar(); setMensajes([]); setConversacion(nuevaConversacion()); }}>
                <RotateCcw className="size-4" />
              </button>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain bg-fondo p-4">
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
                  <p className="text-sm text-tenue">
                    {rol === "admin" ? "Pregúntame lo que quieras o pídeme que apunte compras, productos nuevos o precios." : "Pregúntame lo que quieras de la tienda."}
                    {conVoz && <> Pulsa <Mic className="inline size-3.5" /> para hablar.</>}
                  </p>
                  <p className="mt-1 text-xs text-tenue">Nada se guarda hasta que pulses Confirmar.</p>
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
              <div key={i} className={`animar-entrada flex flex-col gap-2 ${m.de === "yo" ? "items-end" : "items-start"}`}>
                <div
                  className={`markdown max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                    m.de === "yo" ? "rounded-br-md bg-marca-600 text-white"
                      : m.error ? "rounded-bl-md bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                      : "rounded-bl-md border border-borde bg-superficie"
                  }`}
                >
                  {m.de === "yo" ? <>{m.voz && !m.texto.startsWith("🎤") && <Mic className="mr-1 inline size-3.5 opacity-70" />}{m.texto}</> : <ReactMarkdown>{m.texto}</ReactMarkdown>}
                </div>
                {m.acciones?.length ? (
                  <Suspense fallback={null}>
                    <div className="w-full space-y-2">
                      {m.acciones.map((a, j) => <TarjetaAccion key={j} inicial={a} id={`ac-${i}-${j}`} />)}
                    </div>
                  </Suspense>
                ) : null}
              </div>
            ))}
            {pensando && (
              <div className="flex w-fit gap-1 rounded-2xl rounded-bl-md border border-borde bg-superficie px-4 py-3.5">
                {[0, 150, 300].map((d) => <span key={d} className="size-2 animate-bounce rounded-full bg-tenue" style={{ animationDelay: `${d}ms` }} />)}
              </div>
            )}
            <div ref={fin} />
          </div>

          {grabando ? (
            <div className="flex items-center gap-2 border-t border-borde bg-superficie p-3">
              <button type="button" className="boton-sec px-3.5" onClick={() => pararGrabacion(false)} aria-label="Cancelar la grabación"><X className="size-4" /></button>
              <div className="flex flex-1 items-center gap-2 text-sm" aria-live="polite">
                <span className="size-2.5 animate-pulse rounded-full bg-rose-500" />
                Escuchando… <span className="tabular-nums text-tenue">{Math.floor(segundos / 60)}:{String(segundos % 60).padStart(2, "0")}</span>
              </div>
              <button type="button" className="boton bg-rose-600 px-4 hover:bg-rose-700" onClick={() => pararGrabacion(true)} aria-label="Parar y enviar">
                <Square className="size-3.5 fill-current" /> Enviar
              </button>
            </div>
          ) : (
            <form onSubmit={alEnviar} className="flex gap-2 border-t border-borde bg-superficie p-3">
              <input ref={entrada} className="campo" placeholder={disponible ? "Escribe o pulsa el micrófono…" : "Asistente desactivado"} value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!disponible} />
              {conVoz && !texto.trim() ? (
                <button type="button" className="boton px-3.5" disabled={pensando} onClick={empezarAGrabar} aria-label="Hablar" title="Hablar"><Mic className="size-4" /></button>
              ) : (
                <button className="boton px-3.5" disabled={!disponible || !texto.trim() || pensando} aria-label="Enviar"><Send className="size-4" /></button>
              )}
            </form>
          )}
        </div>
      )}
    </>
  );
}
