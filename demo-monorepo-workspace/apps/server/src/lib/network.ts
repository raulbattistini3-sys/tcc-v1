import { createHash, createHmac, randomBytes } from "node:crypto";
import { hostname } from "node:os";

// The TCC server joins the ERP's network service (sample-ERP/network, Go) like the API, the importer and
// billing do: with NETWORK_URL (the private control address, http://127.0.0.1:7070) and NETWORK_TOKEN set,
// it registers as "tcc" under an instance id, keeps the registration alive every 5 s (TTL 15 s), and
// removes it on shutdown. The ERP's API then finds it by name. Without both variables nothing happens: the
// TCC runs on its own as before.
//
// Every call is signed exactly like network/registry/sign.go:
//   X-Network-Signature: t=<unix s>,n=<nonce>,s=hex(HMAC-SHA256(token, t\nn\nMETHOD\npath\nhex(sha256(body))))
// The token never crosses the wire, a signature is valid for 60 s and each nonce once.

const HEADER = "X-Network-Signature";

export function sign(token: string, method: string, path: string, body: string, now = Date.now()): string {
  const t = String(Math.floor(now / 1000));
  const n = randomBytes(12).toString("hex");
  const sum = createHash("sha256").update(body).digest("hex");
  const s = createHmac("sha256", token).update(`${t}\n${n}\n${method.toUpperCase()}\n${path}\n${sum}`).digest("hex");
  return `t=${t},n=${n},s=${s}`;
}

export type Registration = { address: string; health?: string; version?: string; meta?: Record<string, string> };

export type NetworkMembership = { service: string; id: string; stop(): Promise<void> };

/** registers `service` now and every `everyMs`; null when NETWORK_URL / NETWORK_TOKEN aren't set */
export function joinNetwork(service: string, reg: Registration, env: NodeJS.ProcessEnv = process.env, everyMs = 5_000): NetworkMembership | null {
  const base = env.NETWORK_URL?.trim().replace(/\/$/, "");
  const token = env.NETWORK_TOKEN?.trim();
  if (!base || !token) return null;
  if (token.length < 32) {
    console.warn("[network] NETWORK_TOKEN is shorter than 32 characters; the network refuses it (secrets: bun run network-token)");
    return null;
  }
  const id = env.NETWORK_INSTANCE_ID?.trim() || `${service}-${hostname().replace(/[^A-Za-z0-9-]/g, "-").slice(0, 24)}-${randomBytes(4).toString("hex")}`;
  const path = `/registry/${service}/${encodeURIComponent(id)}`;
  const body = { ttlSeconds: Math.ceil((3 * everyMs) / 1000), ...reg };

  const call = async (method: string, payload?: unknown) => {
    const text = payload === undefined ? "" : JSON.stringify(payload);
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", [HEADER]: sign(token, method, path, text) },
      body: payload === undefined ? undefined : text,
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  };

  // null until the first beat answers, so the first success and the first failure are both logged once
  let ok: boolean | null = null;
  const beat = () =>
    call("PUT", body).then(
      () => {
        if (ok !== true) console.log(`[network] registered as ${service}/${id} at ${reg.address}`);
        ok = true;
      },
      (err: Error) => {
        if (ok !== false) console.warn(`[network] registration failed; retrying: ${err.message}`);
        ok = false;
      },
    );
  void beat();
  const timer = setInterval(beat, everyMs);
  timer.unref();
  return {
    service,
    id,
    async stop() {
      clearInterval(timer);
      await call("DELETE").catch(() => undefined);
    },
  };
}
