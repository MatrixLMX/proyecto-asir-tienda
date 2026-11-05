// Crea (o cambia la contraseña de) un usuario de la web.
//   node scripts/crear_usuario.mjs <usuario> <nombre> <admin|dependiente> [--remote]
// Genera una contraseña aleatoria y la guarda en el fichero indicado en
// SALIDA_CLAVE; si no se indica, la muestra por pantalla.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword } from "../src/claves.ts";

const [usuario, nombre, rol, destino] = process.argv.slice(2);
if (!/^[\w.-]{1,40}$/.test(usuario ?? "") || !nombre || !["admin", "dependiente"].includes(rol)) {
  console.error("Uso: node scripts/crear_usuario.mjs <usuario> <nombre> <admin|dependiente> [--remote]");
  process.exit(1);
}

const password = randomBytes(12).toString("base64url");
const hash = await hashPassword(password);
const texto = (s) => `'${s.replaceAll("'", "''")}'`;
const sql = `INSERT INTO usuarios_app (usuario, nombre, password_hash, rol)
VALUES (${texto(usuario)}, ${texto(nombre)}, ${texto(hash)}, ${texto(rol)})
ON CONFLICT(usuario) DO UPDATE SET nombre = excluded.nombre, password_hash = excluded.password_hash,
  rol = excluded.rol, activo = 1;`;

const carpeta = mkdtempSync(join(tmpdir(), "tienda-"));
const fichero = join(carpeta, "usuario.sql");
try {
  writeFileSync(fichero, sql);
  execFileSync("npx", ["wrangler", "d1", "execute", "tienda", destino === "--remote" ? "--remote" : "--local", `--file=${fichero}`],
    { stdio: "ignore", shell: process.platform === "win32" });
} finally {
  rmSync(carpeta, { recursive: true, force: true });
}

if (process.env.SALIDA_CLAVE) {
  writeFileSync(process.env.SALIDA_CLAVE, `${usuario}: ${password}\n`, { flag: "a" });
  console.log(`Usuario '${usuario}' guardado. Contraseña en ${process.env.SALIDA_CLAVE}`);
} else {
  console.log(`Usuario '${usuario}' guardado. Contraseña: ${password}`);
}
