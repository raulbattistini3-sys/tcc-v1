import express, { Router } from "express";
import { sql, desc } from "drizzle-orm";
import { ExtensionUpload } from "@tcc/contracts";
import type { Db } from "../db/client.js";
import { ingestBatches, telemetryEvents } from "../db/schema.js";
import { handle, page, rateLimit } from "../lib/http.js";
import type { TelemetryLog } from "../lib/telemetry-log.js";
import { noTimer, type Timer } from "../lib/timer.js";

// POST /ingest: the WebExtension's uploads, the old log-listener's protocol (v: 1, kind, batches or
// events), 204 when stored. The body is kept twice (text, exact; jsonb, queryable), and its events are
// expanded into telemetry_events by Postgres itself: the raw text goes to Postgres as one parameter and
// is parsed there ($1::jsonb), so Node never re-encodes it (no JSON.stringify of a parsed copy, no
// precision lost on numbers). Node parses it once, to validate the envelope.
//
// An upload with bootId + sequence (extension 0.4+) that the server already has (a retry after a
// timeout whose first attempt did arrive) is acknowledged with 204 and not stored again.

const MAX_BODY = "2mb";
const RATE_PER_MIN = 240;

export function ingestRoutes(db: Db, auth: express.RequestHandler, readAuth: express.RequestHandler, telemetryLog?: TelemetryLog, timer: Timer = noTimer) {
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
      // to disk first (readable JSON, one file a second), so a database failure below loses nothing there
      telemetryLog?.push({
        receivedAt: new Date().toISOString(),
        ip: req.ip ?? null,
        kind: u.kind,
        installId: u.installId ?? null,
        label: u.label ?? null,
        events,
        body: parsed,
      });

      const result = await timer.query("ingest.store", () => db.execute<{ id: string | null; events: number }>(sql`
        WITH b AS (
          INSERT INTO ${ingestBatches} (ip, kind, install_id, label, ext_version, user_agent, sent_at, boot_id, sequence, event_count, body_text, body)
          VALUES (${req.ip ?? null}, ${u.kind}, ${u.installId ?? null}, ${u.label ?? null}, ${u.ext ?? null}, ${u.ua ?? null},
                  ${u.sentAt ? new Date(u.sentAt) : null}, ${u.bootId ?? null}, ${u.sequence ?? null}, ${events}, ${raw}, ${raw}::jsonb)
          ON CONFLICT (install_id, boot_id, sequence) WHERE boot_id IS NOT NULL AND sequence IS NOT NULL DO NOTHING
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
      `));
      const row = result.rows[0];
      const who = u.label || u.installId?.slice(0, 8) || "?";
      if (!row?.id) req.log.debug({ who, kind: u.kind, bootId: u.bootId, sequence: u.sequence }, "ingest duplicate");
      else req.log.debug({ batch: row.id, who, kind: u.kind, sequence: u.sequence, events: row.events }, "ingest");
      res.status(204).end();
    }),
  );

  // recent uploads, without their bodies
  r.get(
    "/ingest/batches",
    readAuth,
    handle(async (req, res) => {
      const { limit, offset } = page(req, 50, 500);
      const rows = await timer.query("ingest.batches", () => db
        .select({
          id: ingestBatches.id,
          receivedAt: ingestBatches.receivedAt,
          kind: ingestBatches.kind,
          installId: ingestBatches.installId,
          label: ingestBatches.label,
          extVersion: ingestBatches.extVersion,
          bootId: ingestBatches.bootId,
          sequence: ingestBatches.sequence,
          eventCount: ingestBatches.eventCount,
          bytes: sql<number>`octet_length(${ingestBatches.bodyText})`,
        })
        .from(ingestBatches)
        .orderBy(desc(ingestBatches.receivedAt))
        .limit(limit)
        .offset(offset));
      res.json(rows);
    }),
  );

  // how many events of each source/type arrived
  r.get(
    "/ingest/stats",
    readAuth,
    handle(async (_req, res) => {
      const rows = await timer.query("ingest.stats", () =>
        db.execute<{ source: string; type: string; events: number; last_at: string }>(sql`
          SELECT e.source, e.type, count(*)::int AS events, max(b.received_at) AS last_at
          FROM ${telemetryEvents} e JOIN ${ingestBatches} b ON b.id = e.batch_id
          GROUP BY e.source, e.type ORDER BY events DESC LIMIT 200
        `),
      );
      res.json(rows.rows);
    }),
  );

  // ─── browser timing, from the probe's events ──────────────────────────────────────────────────────

  // every page load (type "page"), newest first, with what separates it from the previous load in the
  // same tab: time since the previous navigation started and since the previous page finished loading
  r.get(
    "/ingest/navigation",
    readAuth,
    handle(async (req, res) => {
      const { limit, offset } = page(req, 100, 1000);
      const rows = await timer.query("ingest.navigation", () =>
        db.execute(sql`
          SELECT e.install_id AS "installId", e.tab_id AS "tabId", e.page,
                 to_timestamp(e.time_origin / 1000) AS "navigatedAt", e.data,
                 row_number() OVER w AS "nthInTab",
                 e.time_origin - lag(e.time_origin) OVER w AS "sincePrevNavMs",
                 e.time_origin - lag(e.time_origin + NULLIF((e.data->>'load')::float8, 0)) OVER w AS "sincePrevLoadMs",
                 row_number() OVER (PARTITION BY e.install_id, split_part(e.page, '/', 3) ORDER BY e.time_origin) = 1 AS "firstForOrigin"
          FROM ${telemetryEvents} e
          WHERE e.type = 'page' AND e.time_origin IS NOT NULL
          WINDOW w AS (PARTITION BY e.install_id, e.tab_id ORDER BY e.time_origin)
          ORDER BY e.time_origin DESC LIMIT ${limit} OFFSET ${offset}
        `),
      );
      res.json(rows.rows);
    }),
  );

  // Web Vitals per page: the last value each page view reported (LCP and CLS grow until the page is
  // hidden), then p50/p75/max over the views. p75 is the threshold Web Vitals are judged by.
  r.get(
    "/ingest/vitals",
    readAuth,
    handle(async (_req, res) => {
      const rows = await timer.query("ingest.vitals", () =>
        db.execute(sql`
          WITH last AS (
            SELECT DISTINCT ON (e.install_id, e.tab_id, e.time_origin, e.data->>'name')
                   e.page, e.data->>'name' AS name, (e.data->>'value')::float8 AS value
            FROM ${telemetryEvents} e WHERE e.type = 'vital'
            ORDER BY e.install_id, e.tab_id, e.time_origin, e.data->>'name', e.ts DESC
          )
          SELECT page, name, count(*)::int AS views,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS p50,
                 percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
                 max(value) AS max
          FROM last GROUP BY page, name ORDER BY page, name LIMIT 500
        `),
      );
      res.json(rows.rows);
    }),
  );

  // resources (fetch/XHR to the API first of all), the first request of each URL in an install against
  // the ones after it: the first pays DNS/TCP/TLS and a cold server, the later ones reuse all of it.
  // network ≈ TTFB - Server-Timing app: what the browser waited that the server didn't spend working.
  r.get(
    "/ingest/resources",
    readAuth,
    handle(async (req, res) => {
      const initiator = typeof req.query.initiator === "string" ? req.query.initiator.slice(0, 32) : null;
      const rows = await timer.query("ingest.resources", () =>
        db.execute(sql`
          WITH r AS (
            SELECT e.data->>'url' AS url, e.data->>'initiator' AS initiator,
                   (e.data->>'ttfb')::float8 AS ttfb, (e.data->>'duration')::float8 AS duration,
                   (e.data->>'connect')::float8 AS connect, (e.data->>'transferSize')::float8 AS size,
                   (e.data->'serverTiming'->>'app')::float8 AS app, (e.data->'serverTiming'->>'db')::float8 AS db,
                   (e.data->>'cached')::boolean AS cached,
                   row_number() OVER (PARTITION BY e.install_id, e.data->>'url' ORDER BY e.time_origin + e.ts) AS n
            FROM ${telemetryEvents} e
            WHERE e.type = 'resource' AND (${initiator}::text IS NULL OR e.data->>'initiator' = ${initiator})
          )
          SELECT url, initiator, count(*)::int AS requests,
                 avg(ttfb) FILTER (WHERE n = 1) AS "firstTtfb",
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY ttfb) FILTER (WHERE n > 1) AS "laterTtfb",
                 avg(duration) FILTER (WHERE n = 1) AS "firstDuration",
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY duration) FILTER (WHERE n > 1) AS "laterDuration",
                 avg(connect) FILTER (WHERE n = 1) AS "firstConnect",
                 avg(app) AS app, avg(db) AS db,
                 avg(ttfb - app) FILTER (WHERE app IS NOT NULL) AS network,
                 avg(size) AS "avgBytes",
                 avg(CASE WHEN cached THEN 1 ELSE 0 END) AS "cachedShare"
          FROM r GROUP BY url, initiator ORDER BY requests DESC LIMIT 200
        `),
      );
      res.json(rows.rows);
    }),
  );

  // the extension's upload counters per service-worker boot: missing sequence numbers are lost uploads
  r.get(
    "/ingest/sequences",
    readAuth,
    handle(async (_req, res) => {
      const rows = await timer.query("ingest.sequences", () =>
        db.execute(sql`
          SELECT install_id AS "installId", label, boot_id AS "bootId", count(*)::int AS uploads,
                 min(sequence) AS "firstSeq", max(sequence) AS "lastSeq",
                 (max(sequence) - min(sequence) + 1 - count(*))::int AS missing,
                 min(received_at) AS "firstAt", max(received_at) AS "lastAt"
          FROM ${ingestBatches} WHERE boot_id IS NOT NULL AND sequence IS NOT NULL
          GROUP BY install_id, label, boot_id ORDER BY max(received_at) DESC LIMIT 200
        `),
      );
      res.json(rows.rows);
    }),
  );

  return r;
}
