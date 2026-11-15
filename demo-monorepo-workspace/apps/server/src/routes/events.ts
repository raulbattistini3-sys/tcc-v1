import express, { Router } from "express";
import { sql } from "drizzle-orm";
import { AppEventBatch } from "@tcc/contracts";
import type { Db } from "../db/client.js";
import { appEvents } from "../db/schema.js";
import { handle, rateLimit } from "../lib/http.js";
import type { Timer } from "../lib/timer.js";

// POST /telemetry/events: an AppEventBatch (the ERP API's own events and the ones its web app posted to
// it). 204 when stored, also for a resend (the unique index skips rows already there).
// GET /telemetry/events: the latest events, filterable; GET /telemetry/events/summary: count and
// percentiles of `ms` per (service, source, type) over the last hours, split cold/warm when the events say.

const RATE_PER_MIN = 600;
const str = (v: unknown, max = 64) => (typeof v === "string" && v ? v.slice(0, max) : null);
const int = (v: unknown, def: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : def;
};

/** the duration an event measures: "ms", else the first of the known *Ms fields */
export function eventMs(data: Record<string, unknown>): number | null {
  for (const k of ["ms", "openMs", "queryMs", "durationMs"]) {
    const v = data[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export async function storeAppEvents(db: Db, b: AppEventBatch): Promise<number> {
  const rows = b.events.map((e, idx) => ({
    source: b.source,
    instanceId: b.instanceId,
    bootId: b.bootId,
    sequence: b.sequence,
    idx,
    service: e.service,
    eventSource: e.source,
    type: e.type,
    at: new Date(e.at),
    ts: e.ts,
    ms: eventMs(e.data),
    userHash: e.user ?? null,
    data: e.data,
  }));
  const out = await db.insert(appEvents).values(rows).onConflictDoNothing().returning({ id: appEvents.id });
  return out.length;
}

export function eventRoutes(db: Db, auth: express.RequestHandler, readAuth: express.RequestHandler, timer: Timer) {
  const r = Router();

  r.post(
    "/telemetry/events",
    auth,
    rateLimit(RATE_PER_MIN),
    express.json({ limit: "2mb", type: () => true }),
    handle(async (req, res) => {
      const parsed = AppEventBatch.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "bad schema", issues: parsed.error.issues.slice(0, 20) });
        return;
      }
      const b = parsed.data;
      const stored = await timer.query("events.store", () => storeAppEvents(db, b));
      req.log.debug({ source: b.source, seq: b.sequence, events: b.events.length, stored }, "app events");
      res.status(204).end();
    }),
  );

  r.get(
    "/telemetry/events",
    readAuth,
    handle(async (req, res) => {
      const service = str(req.query.service);
      const source = str(req.query.source);
      const type = str(req.query.type);
      const limit = int(req.query.limit, 200, 2000);
      const rows = await timer.query("events.latest", () =>
        db.execute(sql`
          SELECT id, at, source AS "app", instance_id AS "instanceId", service, event_source AS "source", type, ms, data
          FROM ${appEvents}
          WHERE (${service}::text IS NULL OR service = ${service})
            AND (${source}::text IS NULL OR event_source = ${source})
            AND (${type}::text IS NULL OR type = ${type})
          ORDER BY at DESC, id DESC
          LIMIT ${limit}`),
      );
      res.json(rows.rows);
    }),
  );

  r.get(
    "/telemetry/events/summary",
    readAuth,
    handle(async (req, res) => {
      const hours = Math.min(Number(req.query.hours) > 0 ? Number(req.query.hours) : 24, 24 * 90);
      const rows = await timer.query("events.summary", () =>
        db.execute(sql`
          SELECT service, event_source AS "source", type,
                 COALESCE(data->>'endpoint', '') AS endpoint,
                 CASE WHEN data ? 'cold' THEN (data->>'cold')::boolean END AS cold,
                 count(*)::int AS count,
                 count(ms)::int AS timed,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50,
                 percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95,
                 percentile_cont(0.99) WITHIN GROUP (ORDER BY ms) AS p99,
                 max(ms) AS max, max(at) AS "lastAt"
          FROM ${appEvents}
          WHERE at > now() - ${hours}::float8 * interval '1 hour'
          GROUP BY 1, 2, 3, 4, 5
          ORDER BY count(*) DESC
          LIMIT 500`),
      );
      res.json({ hours, rows: rows.rows });
    }),
  );

  return r;
}
