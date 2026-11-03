/* Lectura de códigos de barras.
 *
 * 1. Lector USB o Bluetooth: funciona como un teclado muy rápido que
 *    escribe el código y pulsa Intro. useLectorGlobal lo detecta aunque
 *    el cursor no esté en ningún campo.
 * 2. Cámara del móvil, la tablet o el portátil: BarcodeDetector (Chrome
 *    en Android) o, si el navegador no lo tiene, la librería ZXing.
 *    El navegador solo deja usar la cámara por HTTPS o en localhost. */
import { useEffect, useRef, useState } from "react";
import { Camera, ScanBarcode } from "lucide-react";
import { Modal } from "./ui";

const FORMATOS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];
const MIN_CARACTERES = 4;
const MAX_PAUSA_MS = 60; // un lector escribe cada carácter en pocos milisegundos

function editable(el: EventTarget | null) {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable);
}

/** Recoge lo que escribe un lector de códigos cuando el foco NO está en un
 *  campo de texto (por ejemplo, después de tocar un producto). */
export function useLectorGlobal(alLeer: (codigo: string) => void, activo = true) {
  const ref = useRef(alLeer);
  ref.current = alLeer;
  useEffect(() => {
    if (!activo) return;
    let buffer = "";
    let ultimo = 0;
    const tecla = (e: KeyboardEvent) => {
      if (editable(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
      const ahora = performance.now();
      if (ahora - ultimo > MAX_PAUSA_MS) buffer = "";
      ultimo = ahora;
      if (e.key === "Enter") {
        if (buffer.length >= MIN_CARACTERES) {
          e.preventDefault(); // que no "pulse" el botón que tenga el foco
          ref.current(buffer);
        }
        buffer = "";
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [activo]);
}

function pitido() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 1400;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    osc.onended = () => ctx.close();
  } catch { /* sin audio */ }
  navigator.vibrate?.(60);
}

interface Detector { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> }
declare global {
  interface Window {
    BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> };
  }
}

/** Ventana con la cámara. Al leer un código pita, lo devuelve y se cierra. */
export function EscanerCamara({ abierto, alCerrar, alLeer }: {
  abierto: boolean; alCerrar: () => void; alLeer: (codigo: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setError(null);
    setListo(false);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("El navegador solo deja usar la cámara si la web se abre por HTTPS (https://…) o en este mismo equipo (localhost).");
      return;
    }
    let parar = () => {};
    let terminado = false;
    const leido = (codigo: string) => {
      if (terminado) return;
      terminado = true;
      pitido();
      parar();
      alLeer(codigo);
      alCerrar();
    };
    const camara: MediaStreamConstraints = {
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    };

    (async () => {
      try {
        const nativo = window.BarcodeDetector && (await window.BarcodeDetector.getSupportedFormats()).includes("ean_13");
        if (nativo && video.current) {
          const stream = await navigator.mediaDevices.getUserMedia(camara);
          if (terminado) { stream.getTracks().forEach((t) => t.stop()); return; }
          const v = video.current;
          v.srcObject = stream;
          await v.play();
          setListo(true);
          const detector = new window.BarcodeDetector!({ formats: FORMATOS });
          let marco = 0;
          const buscar = async () => {
            if (terminado) return;
            try {
              const [r] = await detector.detect(v);
              if (r?.rawValue) return leido(r.rawValue);
            } catch { /* fotograma no válido */ }
            marco = window.setTimeout(buscar, 150);
          };
          parar = () => { clearTimeout(marco); stream.getTracks().forEach((t) => t.stop()); };
          buscar();
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const lector = new BrowserMultiFormatReader();
          const controles = await lector.decodeFromConstraints(camara, video.current!, (r) => r && leido(r.getText()));
          parar = () => controles.stop();
          if (terminado) parar(); else setListo(true);
        }
      } catch (e) {
        const nombre = (e as Error).name;
        setError(nombre === "NotAllowedError"
          ? "No hay permiso para usar la cámara. Permítelo en el candado de la barra de direcciones y vuelve a intentarlo."
          : nombre === "NotFoundError" ? "Este dispositivo no tiene cámara." : `No se pudo abrir la cámara (${(e as Error).message}).`);
      }
    })();
    return () => { terminado = true; parar(); };
  }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal abierto={abierto} alCerrar={alCerrar} titulo="Escanear con la cámara">
      {error ? (
        <p className="rounded-xl bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">{error}</p>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-2xl bg-black">
            <video ref={video} className="aspect-[4/3] w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
            {!listo && <p className="absolute inset-0 grid place-items-center text-sm text-white/80">Abriendo la cámara…</p>}
          </div>
          <p className="mt-3 text-center text-sm text-suave">Pon el código de barras dentro del recuadro, con buena luz.</p>
        </>
      )}
    </Modal>
  );
}

/** Botón con icono de cámara que abre el escáner. */
export function BotonEscanear({ alLeer, texto, className = "boton-sec" }: {
  alLeer: (codigo: string) => void; texto?: string; className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setAbierto(true)} aria-label="Escanear con la cámara" title="Escanear con la cámara">
        {texto ? <><Camera className="size-4" /> {texto}</> : <ScanBarcode className="size-4" />}
      </button>
      <EscanerCamara abierto={abierto} alCerrar={() => setAbierto(false)} alLeer={alLeer} />
    </>
  );
}
