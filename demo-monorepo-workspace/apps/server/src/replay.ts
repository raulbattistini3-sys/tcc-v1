// Puts the uploads still in the spool's pending/ into the database, oldest first, the same way the live
// routes store them (db/store.ts). Run it after the database comes back or after `pnpm db:migrate`:
//   pnpm spool:replay            (from demo-monorepo-workspace, or apps/server)
//   pnpm spool:replay --dry-run  just count what's pending
// Sweeps go before sweep results, so appends find their run.
import { resolve } from "node:path";
import { ZodError } from "zod";
import { loadConfig } from "./env.js";
import { createDb } from "./db/client.js";
import { appendSweepResults, NoSuchRun, storeScrape, storeSweep } from "./db/store.js";
import { Spool, SPOOL_KINDS, type SpoolEntry } from "./lib/spool.js";

const dryRun = process.argv.includes("--dry-run");
const config = loadConfig();
const spool = new Spool(resolve(config.SPOOL_DIR));
console.log(`spool: ${spool.dir}`);

const { db, pool } = createDb(config);
const store = (e: SpoolEntry) => {
  switch (e.kind) {
    case "sweeps":
      return storeSweep(db, e.body);
    case "sweep-results":
      return appendSweepResults(db, e.params?.runId ?? "", e.body);
    case "scrapes":
      return storeScrape(db, e.body);
  }
};

let stored = 0;
let rejected = 0;
let failed = 0;
try {
  for (const kind of SPOOL_KINDS) {
    const files = await spool.pending(kind);
    if (!files.length) continue;
    console.log(`${kind}: ${files.length} pending`);
    if (dryRun) continue;
    for (const file of files) {
      const name = spool.label(file);
      try {
        const out = await store(await spool.read(file));
        await spool.stored(file);
        stored++;
        console.log(`  stored ${name} → ${JSON.stringify(out)}`);
      } catch (err) {
        if (err instanceof NoSuchRun || err instanceof ZodError || err instanceof SyntaxError) {
          // it will never go in as is: set it aside rather than retrying it forever
          await spool.rejected(file);
          rejected++;
          console.log(`  rejected ${name}: ${err instanceof ZodError ? "invalid body" : err.message}`);
        } else {
          failed++;
          console.log(`  failed ${name}: ${(err as Error).message}`);
        }
      }
    }
  }
} finally {
  await pool.end();
}
if (!dryRun) console.log(`done: ${stored} stored, ${rejected} rejected (in rejected/), ${failed} still pending`);
if (failed) process.exitCode = 1;
