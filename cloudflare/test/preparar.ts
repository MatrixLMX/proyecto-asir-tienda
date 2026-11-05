import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

const e = env as unknown as { DB: D1Database; MIGRACIONES: Parameters<typeof applyD1Migrations>[1] };
await applyD1Migrations(e.DB, e.MIGRACIONES);
