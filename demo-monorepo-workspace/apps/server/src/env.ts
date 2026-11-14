import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { PoolConfig } from "pg";

// Configuration from the environment (.env in apps/server, see .env.example). Exits with the list of
// problems instead of starting half-configured.

const Env = z.object({
  DATABASE_URL: z.string().url(),
  // drizzle-kit migrate only: Supabase's session pooler (port 5432) or the direct host; the transaction
  // pooler (6543) DATABASE_URL usually points at is fine for the app but not for DDL in a transaction
  DATABASE_MIGRATION_URL: z.string().url().optional(),
  // Supabase's CA (Dashboard → Database → SSL Configuration → download), to verify TLS. Without it a
  // remote database is refused rather than connected to unverified.
  DATABASE_CA_CERT: z.string().optional(),
  // "verify" (default for remote hosts), "off" (default for localhost)
  DATABASE_SSL: z.enum(["verify", "off"]).optional(),
  HOST: z.string().default("0.0.0.0"),
  // 8787: the old collector's port, so the extension's Settings keep working
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  // bearer token for every route except /health; empty means one is generated and printed at start
  TCC_TOKEN: z.string().default(""),
  // the dashboard's origins, comma-separated
  WEB_ORIGINS: z.string().default("http://localhost:5175"),
  // "1": GET routes need no token (a dashboard on a trusted machine)
  PUBLIC_READS: z.enum(["0", "1"]).default("0"),
  // uploads (sweeps, scrapes) are written here before the database; relative to apps/server
  SPOOL_DIR: z.string().default("spool"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "silent"]).default("info"),
});

export type Config = z.infer<typeof Env> & { token: string; tokenGenerated: boolean; origins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    console.error(`[config] invalid environment:\n${problems}\nSee apps/server/.env.example.`);
    process.exit(1);
  }
  const c = parsed.data;
  const tokenGenerated = c.TCC_TOKEN === "";
  return {
    ...c,
    token: tokenGenerated ? randomBytes(12).toString("hex") : c.TCC_TOKEN,
    tokenGenerated,
    origins: c.WEB_ORIGINS.split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean),
  };
}

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** pg pool settings for a URL: TLS verified for remote hosts, off for localhost. */
export function poolConfig(url: string, c: Pick<Config, "DATABASE_SSL" | "DATABASE_CA_CERT">): PoolConfig {
  const host = new URL(url).hostname;
  const ssl = c.DATABASE_SSL ?? (LOCAL.has(host) ? "off" : "verify");
  if (ssl === "off") return { connectionString: url };
  if (!c.DATABASE_CA_CERT) {
    console.error(
      `[config] ${host} needs TLS: set DATABASE_CA_CERT to the provider's CA file (Supabase: Dashboard → Database → SSL Configuration), or DATABASE_SSL=off for a local database.`,
    );
    process.exit(1);
  }
  // sslmode in the URL would override the ssl object below in pg; the object is the source of truth
  const clean = new URL(url);
  clean.searchParams.delete("sslmode");
  return { connectionString: clean.toString(), ssl: { rejectUnauthorized: true, ca: readFileSync(c.DATABASE_CA_CERT, "utf8") } };
}
