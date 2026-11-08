import express, { Router } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { SweepResultsAppend, SweepUpload } from "@tcc/contracts";
import type { Db } from "../db/client.js";
import { sweepResults, sweepRuns } from "../db/schema.js";
import { handle, page } from "../lib/http.js";

// Sweeps: POST a run with its results (the harness at the end of a sweep, the demo's "Run sweep", the
// shops' window.__shop.queries), then read them back with per-cell percentiles.

const CHUNK = 1000; // rows per INSERT: ~40 columns × 1000 stays under Postgres's 65,535 parameters

type ResultRow = typeof sweepResults.$inferInsert;

async function insertResults(tx: Pick<Db, "insert">, runId: string, results: ReturnType<typeof SweepUpload.parse>["results"]) {
  const rows: ResultRow[] = results.map((r) => ({ ...r, runId }));
  for (let i = 0; i < rows.length; i += CHUNK) await tx.insert(sweepResults).values(rows.slice(i, i + CHUNK));
  return rows.length;
}

export function sweepRoutes(db: Db, auth: express.RequestHandler, readAuth: express.RequestHandler) {
  const r = Router();
  const json = express.json({ limit: "25mb" });

  r.post(
    "/sweeps",
    auth,
    json,
    handle(async (req, res) => {
      const body = SweepUpload.parse(req.body);
      const out = await db.transaction(async (tx) => {
        const [run] = await tx.insert(sweepRuns).values(body.run).returning({ id: sweepRuns.id });
        const n = await insertResults(tx, run!.id, body.results);
        return { id: run!.id, results: n };
      });
      res.status(201).json(out);
    }),
  );

  // more results for a run that's still going (a long sweep uploading as it goes)
  r.post(
    "/sweeps/:id/results",
    auth,
    json,
    handle(async (req, res) => {
      const id = String(req.params.id);
      const body = SweepResultsAppend.parse(req.body);
      const [run] = await db.select({ id: sweepRuns.id }).from(sweepRuns).where(eq(sweepRuns.id, id));
      if (!run) {
        res.status(404).type("text").send("no such run");
        return;
      }
      const n = await db.transaction((tx) => insertResults(tx, id, body.results));
      res.status(201).json({ id, results: n });
    }),
  );

  r.get(
    "/sweeps",
    readAuth,
    handle(async (req, res) => {
      const { limit, offset } = page(req, 50, 500);
      const rows = await db
        .select({
          id: sweepRuns.id,
          createdAt: sweepRuns.createdAt,
          source: sweepRuns.source,
          app: sweepRuns.app,
          framework: sweepRuns.framework,
          throttling: sweepRuns.throttling,
          datasetRows: sweepRuns.datasetRows,
          condition: sweepRuns.condition,
          strategy: sweepRuns.strategy,
          transport: sweepRuns.transport,
          notes: sweepRuns.notes,
          // qualified by hand: drizzle prints bare column names here, and a bare "id" would be the result's
          results: sql<number>`(SELECT count(*)::int FROM sweep_results r WHERE r.run_id = sweep_runs.id)`,
        })
        .from(sweepRuns)
        .orderBy(desc(sweepRuns.createdAt))
        .limit(limit)
        .offset(offset);
      res.json(rows);
    }),
  );

  // the run, and per cell (strategy × target × size × query kind × cold): count, p50/p95 time to result,
  // p50 main-thread blocking and time to paint, and how far the chosen target's prediction was off
  r.get(
    "/sweeps/:id",
    readAuth,
    handle(async (req, res) => {
      const id = String(req.params.id);
      const [run] = await db.select().from(sweepRuns).where(eq(sweepRuns.id, id));
      if (!run) {
        res.status(404).type("text").send("no such run");
        return;
      }
      const cells = await db.execute(sql`
        SELECT strategy, target, size, query_kind AS "queryKind", cold, count(*)::int AS n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY compute_to_result_ms) AS "p50Ms",
               percentile_cont(0.95) WITHIN GROUP (ORDER BY compute_to_result_ms) AS "p95Ms",
               percentile_cont(0.5) WITHIN GROUP (ORDER BY main_blocked_ms) AS "p50BlockedMs",
               percentile_cont(0.5) WITHIN GROUP (ORDER BY to_paint_ms) AS "p50PaintMs",
               avg(abs(CASE target WHEN 'main' THEN pred_main_ms ELSE pred_worker_ms END - compute_to_result_ms)) AS "predErrorMs"
        FROM ${sweepResults} WHERE run_id = ${id}
        GROUP BY strategy, target, size, query_kind, cold
        ORDER BY size NULLS LAST, query_kind, strategy, target, cold
      `);
      res.json({ run, cells: cells.rows });
    }),
  );

  r.get(
    "/sweeps/:id/results",
    readAuth,
    handle(async (req, res) => {
      const { limit, offset } = page(req, 200, 5000);
      const rows = await db
        .select()
        .from(sweepResults)
        .where(eq(sweepResults.runId, String(req.params.id)))
        .orderBy(sweepResults.id)
        .limit(limit)
        .offset(offset);
      res.json(rows);
    }),
  );

  return r;
}
