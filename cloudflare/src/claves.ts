/** Contraseñas con PBKDF2 (WebCrypto). bcrypt, el de la versión FastAPI, no
 *  cabe en el límite de CPU del plan gratuito. El hash guarda sus iteraciones,
 *  así que se pueden cambiar sin invalidar las contraseñas existentes. */
export const ITERACIONES = 100_000; // máximo que admite WebCrypto en Workers

const aBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const deBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derivar(password: string, sal: Uint8Array, iteraciones: number): Promise<Uint8Array> {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iteraciones }, clave, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iteraciones = ITERACIONES): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iteraciones}$${aBase64(sal)}$${aBase64(await derivar(password, sal, iteraciones))}`;
}

export async function comprobarPassword(password: string, guardado: string): Promise<boolean> {
  const [tipo, iter, sal, hash] = guardado.split("$");
  if (tipo !== "pbkdf2" || !iter || !sal || !hash) return false;
  const esperado = deBase64(hash);
  const calculado = await derivar(password, deBase64(sal), Number(iter));
  if (calculado.length !== esperado.length) return false;
  // Comparación en tiempo constante
  let diferencia = 0;
  for (let i = 0; i < esperado.length; i++) diferencia |= calculado[i]! ^ esperado[i]!;
  return diferencia === 0;
}
