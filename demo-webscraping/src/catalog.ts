// Reads the saved runs in results/ and appends the products the catalog (catalog_items) doesn't have yet.
//
//   pnpm catalog                    results/, into the database (same one as demo-monorepo-workspace)
//   pnpm catalog results/shein      a folder or files
//   pnpm catalog --dry-run          parse and count only, no database
//
// Before the first run: pnpm db:migrate (creates catalog_items).
import { parseArgs } from "node:util";
import { identity, listingKey, readResults, toCatalogItems } from "./reader.js";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { "dry-run": { type: "boolean", default: false } } });
const paths = positionals.length ? positionals : ["results"];

const runs = [];
const skipped = [];
for (const p of paths) {
  const r = await readResults(p);
  runs.push(...r.runs);
  skipped.push(...r.skipped);
}
runs.sort((a, b) => a.upload.run.startedAt.getTime() - b.upload.run.startedAt.getTime());
for (const s of skipped) console.log(`skipped ${s.file}: ${s.why}`);

// per file, oldest first: how many of its listings no earlier file had
const seen = new Set<string>();
for (const { file, upload } of runs) {
  let fresh = 0;
  for (const l of upload.listings) {
    const id = identity(upload.run.site, listingKey(l));
    if (!seen.has(id)) {
      seen.add(id);
      fresh++;
    }
  }
  console.log(`${file}  ${upload.run.site} ${upload.run.status}: ${upload.listings.length} listings, ${fresh} not in earlier files`);
}

const items = toCatalogItems(runs);
console.log(`${runs.length} run(s), ${items.length} distinct item(s)`);
if (values["dry-run"] || !items.length) process.exit(0);

const { createDb } = await import("./db/client.js");
const { appendItems } = await import("./db/append.js");
const { db, pool } = createDb();
try {
  const { added, known } = await appendItems(db, items);
  const bySite = new Map<string, number>();
  for (const a of added) bySite.set(a.site, (bySite.get(a.site) ?? 0) + 1);
  console.log(`catalog: ${added.length} added, ${known} already there${bySite.size ? ` (${[...bySite].map(([s, n]) => `${s} +${n}`).join(", ")})` : ""}`);
} catch (err) {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  const why = e.cause?.message ?? e.message;
  console.error(`database write failed, nothing was added: ${why}`);
  if (e.cause?.code === "42P01") console.error("catalog_items doesn't exist yet: run pnpm db:migrate");
  process.exitCode = 1;
} finally {
  await pool.end();
}
