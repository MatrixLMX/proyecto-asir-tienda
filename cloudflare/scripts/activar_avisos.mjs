// Crea la clave con la que se firman los avisos al móvil y la guarda como
// secreto en Cloudflare. No se muestra ni se escribe en ningún fichero. Solo hay
// que ejecutarlo una vez: con otra clave, los móviles tendrían que volver a activarlos.
import { spawnSync } from "node:child_process";

const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", par.privateKey);

const r = spawnSync("npx", ["wrangler", "secret", "put", "VAPID_JWK"], {
  input: JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }),
  stdio: ["pipe", "inherit", "inherit"],
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
