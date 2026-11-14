import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

// The same database as demo-monorepo-workspace, configured the same way (apps/server/src/env.ts):
// DATABASE_URL, DATABASE_MIGRATION_URL (drizzle-kit only), DATABASE_SSL ("verify" | "off"),
// DATABASE_CA_CERT. Taken from this project's .env when set there, otherwise from
// ../demo-monorepo-workspace/apps/server/.env, so one machine needs the credentials in one place.

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../demo-monorepo-workspace/apps/server");
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type DbEnv = { url: string; migrationUrl?: string; ssl?: "verify" | "off"; caCert?: string; from: string };

export function dbEnv(): DbEnv {
  if (process.env.DATABASE_URL) return pick(process.env, process.cwd(), ".env / environment");
  const file = resolve(SERVER_DIR, ".env");
  if (!existsSync(file)) throw new Error(`no DATABASE_URL: set it in .env, or in ${file}`);
  return pick(readDotEnv(file), SERVER_DIR, file);
}

function pick(env: Record<string, string | undefined>, baseDir: string, from: string): DbEnv {
  if (!env.DATABASE_URL) throw new Error(`no DATABASE_URL in ${from}`);
  const ssl = env.DATABASE_SSL === "off" || env.DATABASE_SSL === "verify" ? env.DATABASE_SSL : undefined;
  // a relative CA path means relative to the .env that named it
  const caCert = env.DATABASE_CA_CERT ? (isAbsolute(env.DATABASE_CA_CERT) ? env.DATABASE_CA_CERT : resolve(baseDir, env.DATABASE_CA_CERT)) : undefined;
  return { url: env.DATABASE_URL, migrationUrl: env.DATABASE_MIGRATION_URL, ssl, caCert, from };
}

/** pg settings for a URL: TLS verified against the CA for remote hosts, off for localhost. */
export function poolConfig(url: string, e: Pick<DbEnv, "ssl" | "caCert">): pg.PoolConfig {
  const host = new URL(url).hostname;
  const ssl = e.ssl ?? (LOCAL.has(host) ? "off" : "verify");
  if (ssl === "off") return { connectionString: url };
  if (!e.caCert) throw new Error(`${host} needs TLS: set DATABASE_CA_CERT to the provider's CA file, or DATABASE_SSL=off for a local database`);
  // sslmode in the URL would override the ssl object in pg; the object is the source of truth
  const clean = new URL(url);
  clean.searchParams.delete("sslmode");
  return { connectionString: clean.toString(), ssl: { rejectUnauthorized: true, ca: readFileSync(e.caCert, "utf8") } };
}

export function createDb(e: DbEnv = dbEnv()) {
  const pool = new pg.Pool({ ...poolConfig(e.url, e), max: 4, idleTimeoutMillis: 10_000 });
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  return { db: drizzle(pool, { schema }), pool };
}

export type Db = ReturnType<typeof createDb>["db"];

function readDotEnv(file: string) {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}
