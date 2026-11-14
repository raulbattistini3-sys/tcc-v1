import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "./env.js";
import { createDb } from "./db/client.js";
import { createApp } from "./app.js";
import { Spool, SPOOL_KINDS } from "./lib/spool.js";
import { TelemetryLog } from "./lib/telemetry-log.js";

const config = loadConfig();
const { db, pool } = createDb(config);
const spool = new Spool(resolve(config.SPOOL_DIR));
const telemetryLog = config.TELEMETRY_LOG_DIR ? new TelemetryLog(resolve(config.TELEMETRY_LOG_DIR)) : undefined;
telemetryLog?.start();
const app = createApp(db, config, spool, telemetryLog);

const server = app.listen(config.PORT, config.HOST, (err?: Error) => {
  if (err) {
    console.error(`[server] can't listen on ${config.HOST}:${config.PORT}:`, err.message);
    process.exit(1);
  }
  console.log(`[server] listening on ${config.HOST}:${config.PORT}`);
  console.log(`[server] uploads kept on disk in ${spool.dir}`);
  if (telemetryLog) console.log(`[server] extension telemetry written each second to ${telemetryLog.dir}/log<ms>.json`);
  void warnPending();
  if (config.tokenGenerated) console.log(`[server] token (generated, set TCC_TOKEN to keep one): ${config.token}`);
  console.log("[server] the extension's Settings → Collector URL:");
  const addrs = config.HOST === "0.0.0.0" ? lanAddrs() : [config.HOST];
  for (const a of addrs) console.log(`  http://${a}:${config.PORT}/ingest`);
});

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
  server.close(() => void Promise.all([telemetryLog?.stop(), pool.end()]).then(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
