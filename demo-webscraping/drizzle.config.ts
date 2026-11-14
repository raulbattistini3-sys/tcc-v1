import { defineConfig } from "drizzle-kit";
import { dbEnv, poolConfig } from "./src/db/client.js";

// pnpm db:generate  → a new SQL file in drizzle/ from src/db/schema.ts (no database needed)
// pnpm db:migrate   → applies them; the session pooler URL (DATABASE_MIGRATION_URL) when set
// Tracked in drizzle.catalog_migrations, apart from the server's drizzle.__drizzle_migrations.
const isGenerate = process.argv.includes("generate");
const e = isGenerate ? null : dbEnv();
const cfg = e ? poolConfig(e.migrationUrl ?? e.url, e) : null;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(cfg ? { dbCredentials: { url: cfg.connectionString as string, ssl: cfg.ssl ?? false } } : {}),
  migrations: { table: "catalog_migrations", schema: "drizzle" },
  strict: true,
});
