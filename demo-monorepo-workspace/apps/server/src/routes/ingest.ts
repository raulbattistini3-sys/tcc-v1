import express, { Router } from "express";
import { sql, desc } from "drizzle-orm";
import { ExtensionUpload } from "@tcc/contracts";
import type { Db } from "../db/client.js";
import { ingestBatches, telemetryEvents } from "../db/schema.js";
import { handle, page, rateLimit } from "../lib/http.js";

// POST /ingest: the WebExtension's uploads, the old log-listener's protocol (v: 1, kind, batches or
// events), 204 when stored. The body is kept twice (text, exact; jsonb, queryable), and its events are
// expanded into telemetry_events by Postgres itself: the raw text goes to Postgres as one parameter and
// is parsed there ($1::jsonb), so Node never re-encodes it (no JSON.stringify of a parsed copy, no
// precision lost on numbers). Node parses it once, to validate the envelope.

const MAX_BODY = "2mb";
const RATE_PER_MIN = 240;

export function ingestRoutes(db: Db, auth: express.RequestHandler, readAuth: express.RequestHandler) {
  const r = Router();

  r.post(
    "/ingest",
    auth,
    rateLimit(RATE_PER_MIN),
    // the raw text whatever the content type: the extension sends application/json
    express.text({ type: () => true, limit: MAX_BODY }),
    handle(async (req, res) => {
      const raw = typeof req.body === "string" ? req.body : "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        res.status(400).type("text").send("bad schema");
        return;
      }
      const env = ExtensionUpload.safeParse(parsed);
      if (!env.success) {
        res.status(400).type("text").send("bad schema");
        return;
      }
      const u = env.data;
      const events = (u.events?.length ?? 0) + (u.batches ?? []).reduce((n, b) => n + b.events.length, 0);

      const result = await db.execute<{ id: string; events: number }>(sql`
        WITH b AS (
          INSERT INTO ${ingestBatches} (ip, kind, install_id, label, ext_version, user_agent, sent_at, event_count, body_text, body)
          VALUES (${req.ip ?? null}, ${u.kind}, ${u.installId ?? null}, ${u.label ?? null}, ${u.ext ?? null}, ${u.ua ?? null},
                  ${u.sentAt ? new Date(u.sentAt) : null}, ${events}, ${raw}, ${raw}::jsonb)
          RETURNING id, body, install_id
        ), ins AS (
          INSERT INTO ${telemetryEvents} (batch_id, install_id, tab_id, page, world, source, type, ts, time_origin, data)
          SELECT b.id, b.install_id,
                 COALESCE((ev.batch->>'tabId')::int, (b.body->>'tabId')::int),
                 COALESCE(ev.batch->>'page', b.body->>'page'),
                 COALESCE(ev.e->>'world', ev.batch->>'world'),
                 ev.e->>'source', ev.e->>'type', (ev.e->>'ts')::float8,
                 (ev.batch->>'timeOrigin')::float8,
                 COALESCE(ev.e->'data', '{}'::jsonb)
          FROM b, LATERAL (
            SELECT bt AS batch, e
            FROM jsonb_array_elements(COALESCE(b.body->'batches', '[]'::jsonb)) bt,
                 jsonb_array_elements(COALESCE(bt->'events', '[]'::jsonb)) e
            UNION ALL
            SELECT '{}'::jsonb, e FROM jsonb_array_elements(COALESCE(b.body->'events', '[]'::jsonb)) e
          ) ev
          RETURNING 1
        )
        SELECT (SELECT id FROM b) AS id, (SELECT count(*)::int FROM ins) AS events
      `);
      const row = result.rows[0];
      const who = u.label || u.installId?.slice(0, 8) || "?";
      req.log.info({ batch: row?.id, who, kind: u.kind, events: row?.events }, "ingest");
      res.status(204).end();
    }),
  );

  // recent uploads, without their bodies
  r.get(
    "/ingest/batches",
    readAuth,
    handle(async (req, res) => {
      const { limit, offset } = page(req, 50, 500);
      const rows = await db
        .select({
          id: ingestBatches.id,
          receivedAt: ingestBatches.receivedAt,
          kind: ingestBatches.kind,
          installId: ingestBatches.installId,
          label: ingestBatches.label,
          extVersion: ingestBatches.extVersion,
          eventCount: ingestBatches.eventCount,
          bytes: sql<number>`octet_length(${ingestBatches.bodyText})`,
        })
        .from(ingestBatches)
        .orderBy(desc(ingestBatches.receivedAt))
        .limit(limit)
        .offset(offset);
      res.json(rows);
    }),
  );

  // how many events of each source/type arrived
  r.get(
    "/ingest/stats",
    readAuth,
    handle(async (_req, res) => {
      const rows = await db.execute<{ source: string; type: string; events: number; last_at: string }>(sql`
        SELECT e.source, e.type, count(*)::int AS events, max(b.received_at) AS last_at
        FROM ${telemetryEvents} e JOIN ${ingestBatches} b ON b.id = e.batch_id
        GROUP BY e.source, e.type ORDER BY events DESC LIMIT 200
      `);
      res.json(rows.rows);
    }),
  );

  return r;
}
