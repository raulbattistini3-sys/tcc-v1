#!/usr/bin/env node
// Zero-dependency static server for the demo, with switchable security
// headers so each CSP / isolation case can be reproduced:
//
//   node tools/serve.mjs                      no CSP
//   node tools/serve.mjs --csp strict         worker-src 'self': workers allowed, blob: and inline denied
//   node tools/serve.mjs --csp no-worker      worker-src 'none': the scheduler must fall back to main
//   node tools/serve.mjs --coi                COOP+COEP: SharedArrayBuffer path
//   node tools/serve.mjs --port 8080
//
// Workers get their own CSP from their own response (CSP Level 3), so the
// header is sent on every file, worker.js included.

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : (args[i + 1] ?? fallback);
};
const port = Number(opt("--port", 5173));
const csp = opt("--csp", "none");
const coi = args.includes("--coi");
const root = resolve(".");

const POLICIES = {
  none: null,
  strict: "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'",
  "no-worker": "default-src 'self'; script-src 'self'; worker-src 'none'; connect-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'",
};
if (!(csp in POLICIES)) {
  console.error(`--csp must be one of: ${Object.keys(POLICIES).join(", ")}`);
  process.exit(2);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".bin": "application/octet-stream",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = decodeURIComponent(url.pathname);
  // Redirect rather than rewrite, so the page's relative URLs resolve under /demo/.
  if (path === "/" || path === "/demo") {
    res.writeHead(302, { Location: "/demo/" + url.search }).end();
    return;
  }
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(root, path));
  if (!file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }

  const headers = {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": file.endsWith(".bin") ? "max-age=3600" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
  if (POLICIES[csp]) headers["Content-Security-Policy"] = POLICIES[csp];
  if (coi) {
    headers["Cross-Origin-Opener-Policy"] = "same-origin";
    headers["Cross-Origin-Embedder-Policy"] = "require-corp";
    headers["Cross-Origin-Resource-Policy"] = "same-origin";
  }

  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error("not a file");
    res.writeHead(200, { ...headers, "Content-Length": s.size });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
}).listen(port, () => {
  console.log(`http://localhost:${port}/  csp=${csp}  cross-origin-isolated=${coi}`);
});
