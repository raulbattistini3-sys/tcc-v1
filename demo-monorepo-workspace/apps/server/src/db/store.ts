import { eq } from "drizzle-orm";
import { ScrapeUpload, SweepResultsAppend, SweepUpload } from "@tcc/contracts";
import type { Db } from "./client.js";
import { scrapedListings, scrapeRuns, sweepResults, sweepRuns } from "./schema.js";

// The writes behind POST /sweeps, POST /sweeps/:id/results and POST /scrapes, shared with the spool
// replay (src/replay.ts) so a replayed upload is stored exactly as a live one. Each is one transaction.

const CHUNK = 1000; // rows per INSERT: ~40 columns × 1000 stays under Postgres's 65,535 parameters

export class NoSuchRun extends Error {}

type SweepResults = ReturnType<typeof SweepUpload.parse>["results"];

async function insertResults(tx: Pick<Db, "insert">, runId: string, results: SweepResults) {
  const rows = results.map((r) => ({ ...r, runId }));
  for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(sweepResults).values(rows.slice(i, i + CHUNK));
  return rows.length;
}

export function storeSweep(db: Db, raw: unknown) {
  const body = SweepUpload.parse(raw);
  return db.transaction(async (tx) => {
    const [run] = await tx.insert(sweepRuns).values(body.run).returning({ id: sweepRuns.id });
    const n = await insertResults(tx, run!.id, body.results);
    return { id: run!.id, results: n };
  });
}

export function appendSweepResults(db: Db, runId: string, raw: unknown) {
  const body = SweepResultsAppend.parse(raw);
  return db.transaction(async (tx) => {
    const [run] = await tx.select({ id: sweepRuns.id }).from(sweepRuns).where(eq(sweepRuns.id, runId));
    if (!run) throw new NoSuchRun(runId);
    return { id: runId, results: await insertResults(tx, runId, body.results) };
  });
}

export function storeScrape(db: Db, raw: unknown) {
  const body = ScrapeUpload.parse(raw);
  return db.transaction(async (tx) => {
    const [run] = await tx.insert(scrapeRuns).values(body.run).returning({ id: scrapeRuns.id });
    const rows = body.listings.map((l) => ({ ...l, runId: run!.id, site: body.run.site }));
    for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(scrapedListings).values(rows.slice(i, i + CHUNK));
    return { id: run!.id, listings: rows.length };
  });
}
