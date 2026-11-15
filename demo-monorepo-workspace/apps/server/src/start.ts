import * as nodeModule from "node:module";

// Node entry (pnpm start / dev): turns on V8's on-disk code cache before the server's modules load, so
// they're parsed and compiled from cache on the next start of an unchanged build. NODE_COMPILE_CACHE picks
// the folder (default: the OS temp dir). It doesn't remove JIT warm-up or the database's cold cache; the
// readiness probe and warm-up requests deal with those. tcc-v2.exe (Bun) starts index.ts directly, with
// the bytecode compiled in instead.
type CompileCache = { enableCompileCache?: (dir?: string) => unknown };
if (!process.versions.bun) (nodeModule as CompileCache).enableCompileCache?.(process.env.NODE_COMPILE_CACHE || undefined);

await import("./index.js");
