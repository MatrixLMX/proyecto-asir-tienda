/** Avisos al móvil con Web Push, sin correo ni cuentas externas. Cada mañana un
 *  cron de Cloudflare manda el resumen de caducidades y de lo que hay que pedir.
 *
 *  El mensaje va cifrado para ese navegador (RFC 8291) y firmado (VAPID, RFC 8292):
 *  el servicio de push del móvil lo transporta, pero no puede leerlo. */
import { Hono } from "hono";
import { type C, type Ctx, type Entorno, cuerpo, fallo, filas } from "./comun";

export const avisos = new Hono<Ctx>();

const texto = new TextEncoder();
const unir = (...partes: Uint8Array[]) => {
  const r = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { r.set(p, i); i += p.length; }
  return r;
};
export const aB64 = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const deB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hkdf(sal: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const clave = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sal, info }, clave, bytes * 8));
}

/** Cifra el mensaje para una suscripción (aes128gcm, RFC 8291). */
export async function cifrar(mensaje: string, p256dh: string, auth: string, sal = crypto.getRandomValues(new Uint8Array(16))) {
  const publicaUA = deB64(p256dh);
  const claveUA = await crypto.subtle.importKey("raw", publicaUA, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const publicaAS = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey) as ArrayBuffer);
  const secreto = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: claveUA } as unknown as SubtleCryptoDeriveKeyAlgorithm, par.privateKey, 256));

  const ikm = await hkdf(deB64(auth), secreto, unir(texto.encode("WebPush: info\0"), publicaUA, publicaAS), 32);
  const cek = await hkdf(sal, ikm, texto.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sal, ikm, texto.encode("Content-Encoding: nonce\0"), 12);

  const clave = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, clave, unir(texto.encode(mensaje), new Uint8Array([2]))));
  const tamano = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return unir(sal, tamano, new Uint8Array([publicaAS.length]), publicaAS, cifrado);
}

const clavePublica = (jwk: JsonWebKey) => aB64(unir(new Uint8Array([4]), deB64(jwk.x!), deB64(jwk.y!)));

/** Cabecera VAPID: demuestra al servicio de push que el envío es nuestro. */
export async function firmaVapid(endpoint: string, jwk: JsonWebKey) {
  const clave = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const cabecera = aB64(texto.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const datos = aB64(texto.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: "https://tienda.matrixvlogsgg.workers.dev",
  })));
  const firma = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, clave, texto.encode(`${cabecera}.${datos}`));
  return `vapid t=${cabecera}.${datos}.${aB64(firma)}, k=${clavePublica(jwk)}`;
}

interface Suscripcion { endpoint: string; p256dh: string; auth: string }

/** Devuelve cuántos móviles lo han recibido. Las suscripciones caducadas se borran. */
async function enviar(env: Entorno, subs: Suscripcion[], mensaje: { titulo: string; cuerpo: string; url: string }) {
  if (!env.VAPID_JWK) return 0;
  const jwk = JSON.parse(env.VAPID_JWK) as JsonWebKey;
  let enviados = 0;
  for (const s of subs) {
    try {
      const r = await fetch(s.endpoint, {
        method: "POST",
        headers: {
          Authorization: await firmaVapid(s.endpoint, jwk),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "43200",
        },
        body: await cifrar(JSON.stringify(mensaje), s.p256dh, s.auth),
        signal: AbortSignal.timeout(8000),
      });
      await r.body?.cancel();
      if (r.ok) enviados++;
      else if (r.status === 404 || r.status === 410) await env.DB.prepare("DELETE FROM suscripciones_push WHERE endpoint = ?").bind(s.endpoint).run();
      else console.error("push rechazado:", r.status);
    } catch (e) {
      console.error("push fallido:", String(e));
    }
  }
  return enviados;
}

/** Lo que dice el aviso de la mañana. Sin costes: también lo recibe el dependiente. */
export async function componerResumen(db: D1Database) {
  const { results: cad } = await db.prepare("SELECT producto, estado FROM v_caducidades ORDER BY fecha_caducidad").all<{ producto: string; estado: string }>();
  const { results: stock } = await db.prepare("SELECT producto FROM v_alertas_stock").all();
  const urgentes = cad.filter((c) => c.estado !== "PROXIMO");
  const proximos = cad.length - urgentes.length;
  const partes: string[] = [];
  const nombres = [...new Set(urgentes.map((c) => c.producto))];
  if (nombres.length) partes.push(`Retirar ya: ${nombres.slice(0, 4).join(", ")}${nombres.length > 4 ? "…" : ""}`);
  if (proximos) partes.push(`${proximos} ${proximos === 1 ? "lote caduca" : "lotes caducan"} pronto`);
  if (stock.length) partes.push(`${stock.length} por pedir`);
  if (!partes.length) return null;
  return { titulo: "Revisión de la tienda", cuerpo: partes.join(" · "), url: urgentes.length || proximos ? "/#caducidades" : "/#compras/pedido" };
}

/** Lo lanza el cron. Si no hay nada que revisar, no molesta. */
export async function avisoDiario(env: Entorno) {
  const { results: subs } = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM suscripciones_push").all<Suscripcion>();
  if (!subs.length) return 0;
  const resumen = await componerResumen(env.DB);
  return resumen ? enviar(env, subs, resumen) : 0;
}

// ---------------------------------------------------------------------
//  Rutas
// ---------------------------------------------------------------------
avisos.get("/avisos/clave", (c) => {
  if (!c.env.VAPID_JWK) throw fallo(503, "Los avisos no están configurados");
  return c.json({ clave: clavePublica(JSON.parse(c.env.VAPID_JWK) as JsonWebKey) });
});

// El Worker hará peticiones a esta dirección: solo se admiten los servicios de
// push de los navegadores, para que nadie la use para llamar a otros sitios.
const SERVICIOS_PUSH = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[\w.-]+\.push\.apple\.com|[\w.-]+\.notify\.windows\.com)$/;

avisos.post("/avisos/suscribir", async (c) => {
  const d = await cuerpo(c);
  const claves = d.keys as { p256dh?: unknown; auth?: unknown } | undefined;
  let url: URL | null = null;
  try { url = new URL(String(d.endpoint)); } catch { /* se rechaza abajo */ }
  if (!url || url.protocol !== "https:" || !SERVICIOS_PUSH.test(url.hostname)) throw fallo(400, "Servicio de avisos no admitido");
  if (typeof claves?.p256dh !== "string" || typeof claves.auth !== "string" || claves.p256dh.length > 200 || claves.auth.length > 100) {
    throw fallo(400, "Suscripción no válida");
  }
  await c.env.DB.prepare("INSERT OR REPLACE INTO suscripciones_push (endpoint, p256dh, auth, usuario) VALUES (?, ?, ?, ?)")
    .bind(url.href, claves.p256dh, claves.auth, c.get("u").usuario).run();
  return c.json({ ok: true });
});

avisos.post("/avisos/quitar", async (c) => {
  const d = await cuerpo(c);
  await c.env.DB.prepare("DELETE FROM suscripciones_push WHERE endpoint = ? AND usuario = ?").bind(String(d.endpoint), c.get("u").usuario).run();
  return c.json({ ok: true });
});

avisos.post("/avisos/probar", async (c: C) => {
  const subs = await filas<Suscripcion>(c, "SELECT endpoint, p256dh, auth FROM suscripciones_push WHERE usuario = ?", c.get("u").usuario);
  if (!subs.length) throw fallo(400, "Este usuario no tiene avisos activados");
  const resumen = await componerResumen(c.env.DB);
  const enviados = await enviar(c.env, subs, resumen ?? { titulo: "Revisión de la tienda", cuerpo: "Los avisos funcionan. Hoy no hay nada que revisar.", url: "/" });
  if (!enviados) throw fallo(503, "El servicio de avisos no ha aceptado el mensaje");
  return c.json({ enviados });
});
