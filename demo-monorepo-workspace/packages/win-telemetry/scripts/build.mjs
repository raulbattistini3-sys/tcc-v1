// Builds native/win_telemetry.cc into build/win_telemetry.node.
//
// No node-gyp, no node.lib: the addon finds the Node-API functions in the host process at load time, so it only
// needs the headers (node-api-headers) and a compiler. MSVC's cl.exe is used when it's on PATH (a "Developer
// PowerShell"), otherwise g++ (MinGW-w64; CXX=... picks another). Off Windows there is nothing to build.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("win-telemetry: not Windows, nothing to build");
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const include = join(dirname(require.resolve("node-api-headers/package.json")), "include");
const source = join(root, "native", "win_telemetry.cc");
const outDir = join(root, "build");
const out = join(outDir, "win_telemetry.node");
mkdirSync(outDir, { recursive: true });

const found = (cmd) => spawnSync("where", [cmd], { stdio: "ignore", shell: false }).status === 0;
const libs = ["pdh", "advapi32", "psapi", "user32"];

let cmd, args;
if (!process.env.CXX && found("cl")) {
  cmd = "cl";
  args = ["/nologo", "/LD", "/O2", "/EHsc", "/std:c++17", "/MT", `/I${include}`, source, `/Fe:${out}`, `/Fo:${outDir}\\`,
    "/link", ...libs.map((l) => `${l}.lib`)];
} else {
  cmd = process.env.CXX || "g++";
  if (!process.env.CXX && !found("g++")) {
    console.error("win-telemetry: no compiler found (cl.exe from a Developer PowerShell, or MinGW-w64 g++ on PATH, or CXX=...)");
    process.exit(1);
  }
  // static runtime: the .node depends on system DLLs only
  args = ["-shared", "-O2", "-std=c++17", "-Wall", "-Wno-unused-parameter", `-I${include}`, source, "-o", out,
    "-static", "-static-libgcc", "-static-libstdc++", ...libs.map((l) => `-l${l}`)];
}

console.log(`win-telemetry: ${cmd} ${args.join(" ")}`);
try {
  execFileSync(cmd, args, { stdio: "inherit" });
} catch {
  process.exit(1);
}
console.log(`win-telemetry: built ${out}`);
