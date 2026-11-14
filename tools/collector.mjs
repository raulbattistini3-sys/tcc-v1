#!/usr/bin/env node
// Zero-dependency telemetry collector for the extension's remote upload.
// Appends every accepted request as one JSON line to results/live/<date>.ndjson.
//
//   node tools/collector.mjs                       listen on 0.0.0.0:8787, random token
//   node tools/collector.mjs --port 9000 --token s3cret
//   TCC_TOKEN=s3cret node tools/collector.mjs
//
// It's plain HTTP: fine on a LAN or behind a tunnel that adds TLS (Tailscale,
// cloudflared). Don't port-forward it straight to the internet: the token
// would travel in clear text.

import { createServer } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (/** @type {string} */ name, /** @type {string} */ fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : (args[i + 1] ?? fallback);
};
const port = Number(opt("--port", "8787"));
const host = opt("--host", "0.0.0.0");
const token = opt("--token", process.env.TCC_TOKEN ?? randomBytes(12).toString("hex"));
const outDir = resolve(opt("--out", "results/live"));
const MAX_BODY = 2 * 1024 * 1024;
const RATE_PER_MIN = 240;

await mkdir(outDir, { recursive: true });

const expected = Buffer.from(`Bearer ${token}`);
/** @param {string | undefined} header */
const authorized = (header) => {
  const got = Buffer.from(header ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
};

/** @type {Map<string, { n: number, reset: number }>} */
const rate = new Map();
/** @param {string} ip */
function limited(ip) {
  const now = Date.now();
  const r = rate.get(ip);
  if (!r || now > r.reset) {
    rate.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  return ++r.n > RATE_PER_MIN;
}

const stats = { requests: 0, events: 0 };

createServer((req, res) => {
  const ip = req.socket.remoteAddress ?? "?";
  const send = (/** @type {number} */ code, /** @type {string} */ text) => res.writeHead(code, { "content-type": "text/plain" }).end(text);

  if (req.method === "GET" && req.url === "/health") return send(200, "ok");
  if (req.method !== "POST" || req.url !== "/ingest") return send(404, "not found");
  if (!authorized(req.headers.authorization)) return send(401, "bad token");
  if (limited(ip)) return send(429, "slow down");

  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      send(413, "too large");
      req.destroy();
    } else chunks.push(c);
  });
  req.on("end", async () => {
    if (size > MAX_BODY) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(400, "invalid json");
    }
    if (typeof body !== "object" || body === null || body.v !== 1 || typeof body.kind !== "string") return send(400, "bad schema");

    const n =
      body.kind === "stream" && Array.isArray(body.batches)
        ? body.batches.reduce((/** @type {number} */ s, /** @type {any} */ b) => s + (Array.isArray(b?.events) ? b.events.length : 0), 0)
        : Array.isArray(body.events)
          ? body.events.length
          : 0;
    const day = new Date().toISOString().slice(0, 10);
    await appendFile(join(outDir, `${day}.ndjson`), JSON.stringify({ receivedAt: Date.now(), ip, ...body }) + "\n");
    stats.requests++;
    stats.events += n;
    console.log(`${new Date().toISOString()} ${ip} ${body.label || body.installId?.slice(0, 8) || "?"} ${body.kind} ${n} events (total ${stats.events})`);
    send(204, "");
  });
}).listen(port, host, () => {
  console.log(`collector listening on ${host}:${port}, writing to ${outDir}`);
  console.log(`token: ${token}`);
  console.log("paste one of these into the extension's Settings → Collector URL:");
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4") console.log(`  http://${a.address}:${port}/ingest`);
  }
});
