// Activa el asistente en Cloudflare con la clave de Gemini que ya está en el .env
// del proyecto. La guarda como secreto de Cloudflare, sin mostrarla ni escribirla
// en ningún otro fichero.
//   npm run activar-asistente
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const clave = readFileSync("../.env", "utf8").match(/^GOOGLE_API_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!clave) {
  console.error("No encuentro GOOGLE_API_KEY en el fichero .env del proyecto.");
  process.exit(1);
}
const r = spawnSync("npx", ["wrangler", "secret", "put", "GOOGLE_API_KEY"], {
  input: clave, stdio: ["pipe", "ignore", "inherit"], shell: process.platform === "win32",
});
console.log(r.status === 0 ? "Asistente activado." : "No se ha podido guardar la clave.");
process.exitCode = r.status ?? 1;
