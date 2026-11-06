// Copia de seguridad: descarga toda la base de datos de Cloudflare a este PC.
//   npm run copia
// Queda en cloudflare/backups/ (no se sube a GitHub: contiene los datos de la
// tienda). Se conservan las 30 últimas. Cópiala también a un USB de vez en cuando.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const carpeta = "backups";
mkdirSync(carpeta, { recursive: true });
const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const fichero = join(carpeta, `tienda-${sello}.sql`);

execFileSync("npx", ["wrangler", "d1", "export", "tienda", "--remote", `--output=${fichero}`],
  { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });

const tamano = statSync(fichero).size;
if (tamano < 1000) throw new Error(`La copia ha salido casi vacía (${tamano} bytes): revísala`);

const viejas = readdirSync(carpeta).filter((f) => /^tienda-.*\.sql$/.test(f)).sort().slice(0, -30);
for (const f of viejas) rmSync(join(carpeta, f));
console.log(`Copia guardada en ${fichero} (${Math.round(tamano / 1024)} KB)`);
