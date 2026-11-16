import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "./env.js";
import { createDb } from "./db/client.js";
import { createApp } from "./app.js";
import { Spool, SPOOL_KINDS } from "./lib/spool.js";
import { TelemetryLog } from "./lib/telemetry-log.js";
import { createHostTelemetry } from "@tcc/host-telemetry";
import { createWindowsCollector, loadNative, nativeLoadError } from "@tcc/win-telemetry";
import { rollupHostSamples, storeHostEnvelope } from "./lib/host-store.js";
import { joinNetwork, type NetworkMembership } from "./lib/network.js";

const config = loadConfig();
let membership: NetworkMembership | null = null;
const { db, pool } = createDb(config);
const spool = new Spool(resolve(config.SPOOL_DIR));
const telemetryLog = config.TELEMETRY_LOG_DIR ? new TelemetryLog(resolve(config.TELEMETRY_LOG_DIR)) : undefined;
telemetryLog?.start();
// the server is a Node service like sample-erp-api: it measures itself the same way, but stores its
// envelopes directly instead of POSTing them to itself
const winCollector = config.HOST_TELEMETRY === "on" && config.WIN_TELEMETRY !== "off" ? startWindowsCollector() : undefined;
const hostTelemetry =
  config.HOST_TELEMETRY === "on"
    ? createHostTelemetry({
        source: "tcc-server",
        instanceId: config.INSTANCE_ID,
        intervalMs: config.HOST_TELEMETRY_INTERVAL_MS,
        collectors: winCollector ? [winCollector.collect] : [],
        send: async (env) => void (await storeHostEnvelope(db, env)),
        onError: (err) => console.warn("[server] host telemetry not stored:", (err as Error).message),
      })
    : undefined;
hostTelemetry?.start();
const app = createApp(db, config, spool, telemetryLog, hostTelemetry);

// raw host samples → minute rollups, every 10 minutes
const rollupTimer = setInterval(() => {
  rollupHostSamples(db, config.HOST_RAW_RETENTION_HOURS)
    .then((n) => n && console.log(`[server] ${n} host samples older than ${config.HOST_RAW_RETENTION_HOURS} h folded into minute rollups`))
    .catch((err) => console.warn("[server] host rollup failed:", err.message));
}, 10 * 60_000);
rollupTimer.unref();

const server = app.listen(config.PORT, config.HOST, (err?: Error) => {
  if (err) {
    console.error(`[server] can't listen on ${config.HOST}:${config.PORT}:`, err.message);
    process.exit(1);
  }
  console.log(`[server] listening on ${config.HOST}:${config.PORT}`);
  console.log(`[server] uploads kept on disk in ${spool.dir}`);
  if (config.TCC_WEB_DIR) console.log(`[server] dashboard: http://${config.HOST === "0.0.0.0" ? "localhost" : config.HOST}:${config.PORT}/ (${resolve(config.TCC_WEB_DIR)})`);
  if (telemetryLog) console.log(`[server] extension telemetry written each second to ${telemetryLog.dir}/log<ms>.json`);
  void warnPending();
  hostTelemetry?.ready();
  if (hostTelemetry) console.log(`[server] host telemetry: tcc-server/${hostTelemetry.instanceId} boot ${hostTelemetry.bootId.slice(0, 8)}, every ${config.HOST_TELEMETRY_INTERVAL_MS} ms`);
  if (config.tokenGenerated) console.log(`[server] token (generated, set TCC_TOKEN to keep one): ${config.token}`);
  // the ERP's network service, as "tcc" (lib/network.ts); nothing without NETWORK_URL + NETWORK_TOKEN
  const advertise = process.env.NETWORK_ADVERTISE_HOST?.trim() || (config.HOST === "0.0.0.0" ? "127.0.0.1" : config.HOST);
  membership = joinNetwork("tcc", { address: `http://${advertise}:${config.PORT}`, health: "/health", meta: { protocol: "http", role: "telemetry" } });
  console.log("[server] the extension's Settings → Collector URL:");
  const addrs = config.HOST === "0.0.0.0" ? lanAddrs() : [config.HOST];
  for (const a of addrs) console.log(`  http://${a}:${config.PORT}/ingest`);
});

function startWindowsCollector() {
  if (process.platform !== "win32") return undefined;
  const native = loadNative();
  if (!native) {
    if (config.WIN_TELEMETRY === "on") console.warn(`[server] Windows telemetry unavailable: ${nativeLoadError()}`);
    return undefined;
  }
  const c = createWindowsCollector({
    native,
    etw: config.WIN_ETW === "1",
    onError: (err) => console.warn("[server] Windows telemetry:", (err as Error).message),
  });
  console.log(`[server] Windows telemetry on${c.etw.session ? `, ETW session ${c.etw.session}` : config.WIN_ETW === "1" ? " (no ETW)" : ""}`);
  return c;
}

async function warnPending() {
  const n = (await Promise.all(SPOOL_KINDS.map((k) => spool.pending(k)))).flat().length;
  if (n) console.log(`[server] ${n} upload(s) on disk not yet in the database: pnpm spool:replay`);
}

function lanAddrs() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.address.startsWith("169.254."))
    .map((a) => a!.address);
}

const shutdown = () => {
  server.close(() =>
    void Promise.all([telemetryLog?.stop(), hostTelemetry?.stop("SIGINT/SIGTERM"), membership?.stop()])
      .then(() => winCollector?.stop()) // the ETW session would otherwise outlive us until the next start
      .then(() => pool.end())
      .then(() => process.exit(0)),
  );
  setTimeout(() => process.exit(0), 5000).unref();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
