import { networkInterfaces } from "node:os";
import { loadConfig } from "./env.js";
import { createDb } from "./db/client.js";
import { createApp } from "./app.js";

const config = loadConfig();
const { db, pool } = createDb(config);
const app = createApp(db, config);

const server = app.listen(config.PORT, config.HOST, (err?: Error) => {
  if (err) {
    console.error(`[server] can't listen on ${config.HOST}:${config.PORT}:`, err.message);
    process.exit(1);
  }
  console.log(`[server] listening on ${config.HOST}:${config.PORT}`);
  if (config.tokenGenerated) console.log(`[server] token (generated, set TCC_TOKEN to keep one): ${config.token}`);
  console.log("[server] the extension's Settings → Collector URL:");
  const addrs = config.HOST === "0.0.0.0" ? lanAddrs() : [config.HOST];
  for (const a of addrs) console.log(`  http://${a}:${config.PORT}/ingest`);
});

function lanAddrs() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.address.startsWith("169.254."))
    .map((a) => a!.address);
}

const shutdown = () => {
  server.close(() => void pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
