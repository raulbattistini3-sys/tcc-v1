import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";

// The dashboard's settings (VITE_API_URL) live in erp-v1/secrets/tcc-web.env, found from here upwards at
// <dir>/secrets/ or <dir>/erp-v1/secrets/ (TCC_SECRETS_DIR names the folder instead), like the server's
// tcc-server.env. Values already in the environment win; Vite then picks VITE_* up from process.env.
function loadSecrets(name: string) {
  const fixed = process.env.TCC_SECRETS_DIR?.trim();
  let file: string | null = null;
  if (fixed) file = existsSync(resolve(fixed, name)) ? resolve(fixed, name) : null;
  else
    for (let d = resolve(import.meta.dirname); !file; d = dirname(d)) {
      file = [join(d, "secrets", name), join(d, "erp-v1", "secrets", name)].find(existsSync) ?? null;
      if (dirname(d) === d) break;
    }
  if (!file) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    const i = line.indexOf("=");
    if (!line || line.startsWith("#") || i <= 0) continue;
    const k = line.slice(0, i).trim();
    if (process.env[k] === undefined) process.env[k] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

// The dev server joins the ERP's network service as "tcc-web" when NETWORK_URL and NETWORK_TOKEN are set,
// at whatever port it ended up on, the same way the ERP's web app joins as "web". Calls are signed like
// sample-ERP/network/registry/sign.go. A build (served by the server, tcc-v2.exe) doesn't register.
function networkRegistration(): Plugin {
  const base = process.env.NETWORK_URL?.trim().replace(/\/$/, "");
  const token = process.env.NETWORK_TOKEN?.trim();
  const sign = (method: string, path: string, body: string) => {
    const t = String(Math.floor(Date.now() / 1000));
    const n = randomBytes(12).toString("hex");
    const sum = createHash("sha256").update(body).digest("hex");
    const s = createHmac("sha256", token!).update(`${t}\n${n}\n${method}\n${path}\n${sum}`).digest("hex");
    return `t=${t},n=${n},s=${s}`;
  };
  const call = (method: string, path: string, payload?: unknown) => {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    return fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Network-Signature": sign(method, path, body) },
      body: payload === undefined ? undefined : body,
      signal: AbortSignal.timeout(3000),
    }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  };
  return {
    name: "tcc-network-registration",
    apply: "serve",
    configureServer(server) {
      if (!base || !token) return;
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address();
        if (!address || typeof address === "string") return;
        const host = process.env.NETWORK_ADVERTISE_HOST?.trim() || "127.0.0.1";
        const id = `tcc-web-${hostname().replace(/[^A-Za-z0-9-]/g, "-").slice(0, 24)}-${randomBytes(4).toString("hex")}`;
        const path = `/registry/tcc-web/${id}`;
        const reg = { address: `http://${host}:${address.port}`, health: "/", meta: { protocol: "http", dev: "vite", role: "telemetry-dashboard" }, ttlSeconds: 15 };
        let ok: boolean | null = null;
        const beat = () =>
          call("PUT", path, reg).then(
            () => {
              if (ok !== true) server.config.logger.info(`[network] registered as tcc-web/${id} at ${reg.address}`);
              ok = true;
            },
            (error: Error) => {
              if (ok !== false) server.config.logger.warn(`[network] registration failed; retrying: ${error.message}`);
              ok = false;
            },
          );
        void beat();
        const timer = setInterval(beat, 5000);
        timer.unref();
        server.httpServer?.once("close", () => {
          clearInterval(timer);
          void call("DELETE", path).catch(() => undefined);
        });
      });
    },
  };
}

loadSecrets("tcc-web.env");

// The server's WEB_ORIGINS defaults to this port.
export default defineConfig({
  plugins: [react(), networkRegistration()],
  server: { port: 5176, strictPort: true },
  build: { target: "es2023" },
});
