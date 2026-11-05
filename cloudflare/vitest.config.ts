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
          bindings: { MIGRACIONES: migraciones, JWT_SECRET: "clave-solo-para-pruebas-0123456789" },
        },
      }),
    ],
    test: { setupFiles: ["./test/preparar.ts"] },
  };
});
