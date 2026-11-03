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
// The two shops are mounted from their production builds, so React and
// Angular get the same server, headers and /data file:
//   /react/    apps/shop-react/dist           (npm run build in apps/shop-react)
//   /angular/  apps/shop-angular/dist/browser (npm run build in apps/shop-angular)
//   /angular-zone/  same app with zone.js     (npm run build:zone)
//
// base-uri is 'self', not 'none': Angular needs its <base href>.
//
// Workers get their own CSP from their own response (CSP Level 3), so the
// header is sent on every file, worker.js included.
//
// Style nonces: MUI (emotion) and Angular both inject <style> elements at
// runtime, and `style-src 'self'` blocks them. Each HTML response gets a fresh
// nonce: it is added to style-src and replaces the __CSP_NONCE__ placeholder
// in the page, where emotion's cache (meta tag) and Angular (ngCspNonce) read it.

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
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
  strict: "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'",
  "no-worker": "default-src 'self'; script-src 'self'; worker-src 'none'; connect-src 'self'; style-src 'self'; object-src 'none'; base-uri 'self'",
};
if (!(csp in POLICIES)) {
  console.error(`--csp must be one of: ${Object.keys(POLICIES).join(", ")}`);
  process.exit(2);
}

/** URL prefix → build folder. Unknown paths without an extension fall back to the app's index.html. */
const MOUNTS = {
  "/react/": "apps/shop-react/dist",
  "/angular/": "apps/shop-angular/dist/browser",
  "/angular-zone/": "apps/shop-angular/dist-zone/browser",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".bin": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = decodeURIComponent(url.pathname);
  // Redirect rather than rewrite, so the page's relative URLs resolve under /demo/.
  if (path === "/" || path === "/demo") {
    res.writeHead(302, { Location: "/demo/" + url.search }).end();
    return;
  }
  if (path === "/react" || path === "/angular" || path === "/angular-zone") {
    res.writeHead(302, { Location: path + "/" + url.search }).end();
    return;
  }
  const mount = Object.keys(MOUNTS).find((m) => path.startsWith(m));
  if (mount) path = "/" + MOUNTS[mount] + "/" + path.slice(mount.length);
  if (path.endsWith("/")) path += "index.html";
  let file = normalize(join(root, path));
  if (mount && !extname(file)) file = normalize(join(root, MOUNTS[mount], "index.html"));
  if (!file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }

  /** @type {Record<string, string | number>} */
  const headers = {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": file.endsWith(".bin") ? "max-age=3600" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
  const isHtml = extname(file) === ".html";
  const nonce = isHtml ? randomBytes(16).toString("base64") : null;
  const policy = POLICIES[csp];
  if (policy) headers["Content-Security-Policy"] = nonce ? policy.replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`) : policy;
  if (coi) {
    headers["Cross-Origin-Opener-Policy"] = "same-origin";
    headers["Cross-Origin-Embedder-Policy"] = "require-corp";
    headers["Cross-Origin-Resource-Policy"] = "same-origin";
  }

  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error("not a file");
    if (isHtml && nonce) {
      const body = Buffer.from((await readFile(file, "utf8")).replaceAll("__CSP_NONCE__", nonce));
      res.writeHead(200, { ...headers, "Content-Length": body.length });
      return res.end(req.method === "HEAD" ? undefined : body);
    }
    res.writeHead(200, { ...headers, "Content-Length": s.size });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }
}).listen(port, () => {
  console.log(`http://localhost:${port}/  csp=${csp}  cross-origin-isolated=${coi}`);
});
