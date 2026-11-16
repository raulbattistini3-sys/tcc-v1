import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createWindowsCollector, loadNative, nativeLoadError } from "@tcc/win-telemetry";
import * as schema from "./db/schema.js";
import { poolConfig } from "./env.js";
import { storeHostEnvelope } from "./lib/host-store.js";
import { serveIngest } from "./lib/ingest-ipc.js";

// TCC_MODE=ingest-ipc: tcc-v2.exe as a service's telemetry child instead of the HTTP server (see
// lib/ingest-ipc.ts for the protocol). The service spawns it with an "ipc" stdio slot and these:
//
//   TCC_INGEST_DATABASE_URL       the TCC database (else DATABASE_URL)
//   TCC_INGEST_DATABASE_SSL       verify | off (else DATABASE_SSL; default: off for a local host)
//   TCC_INGEST_DATABASE_CA_CERT   its CA (else DATABASE_CA_CERT)
//   TCC_INGEST_JOB_INTERVAL_MS    how often the job's readings go back (default 1000)
//
// It exits when the service disconnects or dies; it never listens on a port.

const log = (msg: string) => console.error(`[tcc-ingest] ${msg}`);

if (!process.send) {
  log("TCC_MODE=ingest-ipc needs an IPC channel: start it from the service with stdio [..., 'ipc']");
  process.exit(2);
}

const env = process.env;
const url = env.TCC_INGEST_DATABASE_URL || env.DATABASE_URL;
if (!url) {
  log("TCC_INGEST_DATABASE_URL (or DATABASE_URL) is not set");
  process.exit(2);
}
const ssl = (env.TCC_INGEST_DATABASE_SSL || env.DATABASE_SSL) as "verify" | "off" | undefined;
const pool = new pg.Pool({
  ...poolConfig(url, { DATABASE_SSL: ssl || undefined, DATABASE_CA_CERT: env.TCC_INGEST_DATABASE_CA_CERT || env.DATABASE_CA_CERT || undefined }),
  max: 2, // one envelope a second; the second covers a slow insert overlapping the next
  idleTimeoutMillis: 60_000,
});
pool.on("error", (err) => log(`idle client error: ${err.message}`));
const db = drizzle(pool, { schema });

// the job is the service's: this process was started by it and inherits its job object
const native = loadNative();
if (!native && process.platform === "win32") log(`no job readings: ${nativeLoadError()}`);
const win = native ? createWindowsCollector({ native, process: false, onError: (err) => log(`job reading: ${(err as Error).message}`) }) : undefined;

const ingest = serveIngest({
  channel: process as unknown as Parameters<typeof serveIngest>[0]["channel"],
  store: (e) => storeHostEnvelope(db, e),
  readJob: win?.available ? win.collect : undefined,
  jobIntervalMs: Number(env.TCC_INGEST_JOB_INTERVAL_MS) || 1000,
  onDisconnect: () => {
    win?.stop();
    const { stored, duplicates, rejected, failed } = ingest.stats;
    log(`service gone: ${stored} stored, ${duplicates} duplicate, ${rejected} rejected, ${failed} failed`);
    void pool.end().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  },
  onError: (err) => log((err as Error).message ?? String(err)),
});
