import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migraciones = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: { MIGRACIONES: migraciones, JWT_SECRET: "clave-solo-para-pruebas-0123456789", GOOGLE_API_KEY: "clave-falsa",
            // Clave de ejemplo del RFC 7515, solo para las pruebas
            VAPID_JWK: JSON.stringify({ kty: "EC", crv: "P-256", x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU", y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0", d: "jpsQnnGQmL-YBIffH1136cspYG6-0iY7X1fCE9-E9LI" }) },
        },
      }),
    ],
    test: { setupFiles: ["./test/preparar.ts"] },
  };
});
