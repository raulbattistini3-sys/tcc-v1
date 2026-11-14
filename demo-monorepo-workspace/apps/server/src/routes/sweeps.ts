import express, { Router } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { SweepResultsAppend, SweepUpload } from "@tcc/contracts";
import type { Db } from "../db/client.js";
import { sweepResults, sweepRuns } from "../db/schema.js";
import { appendSweepResults, storeSweep } from "../db/store.js";
import { handle, page } from "../lib/http.js";
import type { Spool } from "../lib/spool.js";
import { spoolThenStore } from "../lib/spooled.js";

// Sweeps: POST a run with its results (tools/upload-sweep.mjs for the harness, the demo's "Run sweep",
// the shops' window.__shop.queries), then read them back with per-cell percentiles. Uploads are kept on
// disk first (lib/spool.ts), so a database failure answers 202 instead of losing the run.

export function sweepRoutes(db: Db, spool: Spool, auth: express.RequestHandler, readAuth: express.RequestHandler) {
  const r = Router();
  const json = express.json({ limit: "25mb" });

  r.post(
    "/sweeps",
    auth,
    json,
    handle((req, res) => spoolThenStore(spool, "sweeps", SweepUpload, req, res, () => storeSweep(db, req.body))),
  );

  // more results for a run that's still going (a long sweep uploading as it goes)
  r.post(
    "/sweeps/:id/results",
    auth,
    json,
    handle((req, res) => {
      const id = String(req.params.id);
      return spoolThenStore(spool, "sweep-results", SweepResultsAppend, req, res, () => appendSweepResults(db, id, req.body), { runId: id });
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
