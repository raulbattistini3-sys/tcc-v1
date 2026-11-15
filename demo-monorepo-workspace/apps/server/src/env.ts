import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { PoolConfig } from "pg";
import { findSecretsFile, loadSecretsEnv } from "./lib/secrets-env.js";

// Configuration from the environment, filled in from erp-v1/secrets/tcc-server.env (see .env.example for
// the keys). Exits with the list of problems instead of starting half-configured.

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
  // the extension's uploads, one log<Date.now()>.json a second (seconds without uploads write nothing);
  // relative to apps/server; empty turns it off
  TELEMETRY_LOG_DIR: z.string().default("logs"),
  // the built dashboard (apps/web/dist, built with VITE_API_URL="") served at / by this server, so one
  // process and one port is the whole TCC (tcc-v2.exe); unset: the dashboard runs on its own (vite)
  TCC_WEB_DIR: z.string().optional(),
  // the server's own host telemetry (memory, GC, event loop, request and query durations, lifecycle),
  // stored straight into host_batches/host_samples as source "tcc-server"; "off" disables it
  HOST_TELEMETRY: z.enum(["on", "off"]).default("on"),
  // this replica's name in host telemetry (default: the machine's host name)
  INSTANCE_ID: z.string().optional(),
  HOST_TELEMETRY_INTERVAL_MS: z.coerce.number().int().min(1000).default(10_000),
  // host samples older than this are folded into one-minute rollups (lifecycle samples are kept)
  HOST_RAW_RETENTION_HOURS: z.coerce.number().positive().default(24),
  // Windows only, needs the @tcc/win-telemetry addon built: "on" adds win.process/win.job/win.system
  // samples to the server's host telemetry; "auto" (default) does that when the addon is there
  WIN_TELEMETRY: z.enum(["auto", "on", "off"]).default("auto"),
  // "1": also an ETW session (Kernel-Process + Kernel-Network) as win.etw; needs elevation or the
  // "Performance Log Users" group, otherwise a warning and the other samples only
  WIN_ETW: z.enum(["0", "1"]).default("0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "silent"]).default("info"),
});

export type Config = z.infer<typeof Env> & { token: string; tokenGenerated: boolean; origins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // erp-v1/secrets/tcc-server.env (lib/secrets-env.ts); the environment wins over the file
  if (env === process.env) {
    const file = loadSecretsEnv("tcc-server.env");
    if (file) console.log(`[config] settings from ${file}`);
  }
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
// Supabase's CA under either name, looked for when DATABASE_CA_CERT is unset: apps/server ships prod-ca-2021.crt,
// erp-v1/secrets holds supabase-telemetry-ca.crt (the same certificate)
const DEFAULT_CA_CERTS = ["prod-ca-2021.crt", "supabase-telemetry-ca.crt"];
// apps/server, apps, the workspace, and one more
const CA_SEARCH_DEPTH = 3;
const INSECURE_SSLMODES = new Set(["disable", "allow", "prefer", "no-verify"]);

function fatal(message: string): never {
  console.error(`[config] ${message}`);
  process.exit(1);
}

/** the CA file: DATABASE_CA_CERT (relative to the working directory, else to apps/server), else a default
 *  name found upwards from the working directory and apps/server, in each directory or its secrets/ */
export function findCaCert(explicit?: string): string {
  const server = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const given = explicit?.trim();
  if (given) {
    // a path written in secrets/tcc-server.env is relative to that folder
    const secrets = findSecretsFile("tcc-server.env");
    const bases = [process.cwd(), ...(secrets ? [dirname(secrets)] : []), server];
    for (const base of bases) {
      const p = resolve(base, given);
      if (existsSync(p)) return p;
    }
    fatal(`DATABASE_CA_CERT=${given} does not exist (looked in ${bases.join(", ")})`);
  }
  const starts = [process.cwd(), server];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i <= CA_SEARCH_DEPTH; i++) {
      for (const name of DEFAULT_CA_CERTS) {
        for (const p of [join(dir, name), join(dir, "secrets", name)]) if (existsSync(p)) return p;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return "";
}

function readCa(path: string): string {
  let pem: string;
  try {
    pem = readFileSync(path, "utf8");
  } catch (error) {
    fatal(`cannot read the database CA certificate ${path}: ${(error as Error).message}`);
  }
  if (!pem.includes("-----BEGIN CERTIFICATE-----")) fatal(`DATABASE_CA_CERT (${path}) is not a PEM certificate`);
  return pem;
}

/** pg pool settings for a URL: TLS verified against Supabase's CA for remote hosts, off for localhost. */
export function poolConfig(url: string, c: Pick<Config, "DATABASE_SSL" | "DATABASE_CA_CERT">): PoolConfig {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const sslmode = parsed.searchParams.get("sslmode")?.toLowerCase();
  // ssl* in the URL would override the ssl object below in pg; the object is the source of truth
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith("ssl") || key === "uselibpqcompat") parsed.searchParams.delete(key);
  }
  const ssl = c.DATABASE_SSL ?? (LOCAL.has(host) ? "off" : "verify");
  if (ssl === "off") return { connectionString: url };
  if (sslmode && INSECURE_SSLMODES.has(sslmode)) {
    fatal(`DATABASE_URL has sslmode=${sslmode}, but ${host} is verified with TLS; remove it or set DATABASE_SSL=off`);
  }
  const ca = findCaCert(c.DATABASE_CA_CERT);
  if (!ca) {
    fatal(
      `${host} needs TLS: put ${DEFAULT_CA_CERTS.join(" or ")} in apps/server (or erp-v1/secrets), set DATABASE_CA_CERT, or DATABASE_SSL=off for a local database.`,
    );
  }
  return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: true, ca: readCa(ca) } };
}
