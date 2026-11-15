import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The server's settings live in erp-v1/secrets/tcc-server.env (the dashboard's in tcc-web.env), not in an
// apps/server/.env: one folder holds every secret of the ERP and the TCC. The file is found from the
// working directory upwards, at <dir>/secrets/<name> or <dir>/erp-v1/secrets/<name>, so both this copy
// (erp-v1/tcc-v2/tcc-v1) and the source one beside erp-v1 reach it. TCC_SECRETS_DIR names the folder
// instead. What is already in the environment wins: the Makefile, the API (which starts this server in
// development) or the launcher decide, the file fills in the rest. In production (tcc-v2.exe under the
// launcher) nothing is read unless TCC_SECRETS_DIR is set: the launcher passes everything itself.

export function findSecretsFile(name: string, from = process.cwd()): string | null {
  const dir = process.env.TCC_SECRETS_DIR?.trim();
  if (dir) {
    const p = resolve(dir, name);
    return existsSync(p) ? p : null;
  }
  for (let d = resolve(from); ; d = dirname(d)) {
    for (const p of [join(d, "secrets", name), join(d, "erp-v1", "secrets", name)]) if (existsSync(p)) return p;
    if (dirname(d) === d) return null;
  }
}

/** KEY=value lines (# comments, optional quotes); no multi-line values */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

/** loads secrets/<name> into process.env without overriding; returns the file used, or null */
export function loadSecretsEnv(name = "tcc-server.env"): string | null {
  if (process.env.NODE_ENV === "production" && !process.env.TCC_SECRETS_DIR?.trim()) return null;
  const file = findSecretsFile(name);
  if (!file) return null;
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, "utf8")))) if (process.env[k] === undefined) process.env[k] = v;
  return file;
}
