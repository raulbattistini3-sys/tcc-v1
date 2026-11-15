import express, { Router } from "express";
import { sql } from "drizzle-orm";
import { HostTelemetryEnvelope, SAMPLE_CATEGORIES } from "@tcc/contracts";
import type { Db } from "../db/client.js";
import { hostBatches, hostRollups, hostSamples } from "../db/schema.js";
import { handle, rateLimit } from "../lib/http.js";
import { storeHostEnvelope } from "../lib/host-store.js";
import type { Timer } from "../lib/timer.js";

// POST /telemetry/host: a HostTelemetryEnvelope from a Node service (sample-erp-api, this server).
// 204 when stored, and also when it is a resend of a batch already stored (counted as a duplicate).
// The GET routes below are what the dashboard's "Servidor" views read.

const RATE_PER_MIN = 600;
const str = (v: unknown, max = 128) => (typeof v === "string" && v ? v.slice(0, max) : null);
const int = (v: unknown, def: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : def;
};

export function hostRoutes(db: Db, auth: express.RequestHandler, readAuth: express.RequestHandler, timer: Timer) {
  const r = Router();

  r.post(
    "/telemetry/host",
    auth,
    rateLimit(RATE_PER_MIN),
    express.json({ limit: "1mb", type: () => true }),
    handle(async (req, res) => {
      const env = HostTelemetryEnvelope.safeParse(req.body);
      if (!env.success) {
        res.status(400).json({ message: "bad schema", issues: env.error.issues.slice(0, 20) });
        return;
      }
      const e = env.data as HostTelemetryEnvelope;
      const out = await timer.query("host.store", () => storeHostEnvelope(db, e));
      req.log.debug({ source: e.source, instance: e.instanceId, seq: e.sequence, samples: out.samples, duplicate: out.duplicate }, "host telemetry");
      res.status(204).end();
    }),
  );

  // one row per boot of each instance: its sequence range, what's missing, what came twice, its last
  // lifecycle state. A boot after the first one of an instance is a restart.
  r.get(
    "/telemetry/host/boots",
    readAuth,
    handle(async (_req, res) => {
      const rows = await timer.query("host.boots", () =>
        db.execute(sql`
          WITH boots AS (
            SELECT source, instance_id, boot_id,
                   min(sent_at) AS first_at, max(sent_at) AS last_at, count(*)::int AS batches,
                   min(sequence) AS first_seq, max(sequence) AS last_seq, sum(duplicates)::int AS duplicates
            FROM ${hostBatches} GROUP BY source, instance_id, boot_id
          )
          SELECT b.source AS "source", b.instance_id AS "instanceId", b.boot_id AS "bootId",
                 b.first_at AS "firstAt", b.last_at AS "lastAt", b.batches, b.first_seq AS "firstSeq", b.last_seq AS "lastSeq",
                 -- sequences start at 0: a boot whose first batch we saw at 3 lost 0..2
                 (b.last_seq + 1 - b.batches)::int AS missing, b.duplicates,
                 row_number() OVER (PARTITION BY b.source, b.instance_id ORDER BY b.first_at)::int - 1 AS restarts,
                 (SELECT s.data->>'state' FROM ${hostSamples} s
                   WHERE s.boot_id = b.boot_id AND s.type = 'lifecycle' ORDER BY s.at DESC, s.id DESC LIMIT 1) AS "lastState"
          FROM boots b ORDER BY b.last_at DESC LIMIT 200
        `),
      );
      res.json(rows.rows);
    }),
  );

  // the newest sample of every (instance, type, name) in the last `minutes` (default 15)
  r.get(
    "/telemetry/host/latest",
    readAuth,
    handle(async (req, res) => {
      const minutes = int(req.query.minutes, 15, 24 * 60);
      const category = SAMPLE_CATEGORIES.find((c) => c === req.query.category) ?? null;
      const rows = await timer.query("host.latest", () =>
        db.execute(sql`
          SELECT DISTINCT ON (source, instance_id, type, name)
                 source, instance_id AS "instanceId", boot_id AS "bootId", at, category, type, name, data
          FROM ${hostSamples}
          WHERE at > now() - make_interval(mins => ${minutes}) AND category <> 'lifecycle'
            AND (${category}::text IS NULL OR category = ${category})
          ORDER BY source, instance_id, type, name, at DESC, id DESC
        `),
      );
      res.json(rows.rows);
    }),
  );

  // a time series: raw samples of the last `minutes` (default 60), then the minute rollups before them
  r.get(
    "/telemetry/host/series",
    readAuth,
    handle(async (req, res) => {
      const type = str(req.query.type, 64);
      if (!type) {
        res.status(400).type("text").send("type is required");
        return;
      }
      const minutes = int(req.query.minutes, 60, 7 * 24 * 60);
      const instance = str(req.query.instance);
      const name = str(req.query.name, 256);
      const rows = await timer.query("host.series", () =>
        db.execute(sql`
          SELECT 'raw' AS resolution, source, instance_id AS "instanceId", boot_id AS "bootId", at, name, data, 1 AS samples
          FROM ${hostSamples}
          WHERE type = ${type} AND at > now() - make_interval(mins => ${minutes})
            AND (${instance}::text IS NULL OR instance_id = ${instance}) AND (${name}::text IS NULL OR name = ${name})
          UNION ALL
          SELECT 'minute', source, instance_id, NULL, bucket, name,
                 (SELECT jsonb_object_agg(k, v->'avg') FROM jsonb_each(fields) AS f(k, v)), samples
          FROM ${hostRollups}
          WHERE type = ${type} AND bucket > now() - make_interval(mins => ${minutes})
            AND (${instance}::text IS NULL OR instance_id = ${instance}) AND (${name}::text IS NULL OR name = ${name})
          ORDER BY at LIMIT 5000
        `),
      );
      res.json(rows.rows);
    }),
  );

  // lifecycle events, newest first, plus a "restarted" row where an instance shows up with a new boot
  r.get(
    "/telemetry/host/lifecycle",
    readAuth,
    handle(async (req, res) => {
      const limit = int(req.query.limit, 100, 1000);
      const rows = await timer.query("host.lifecycle", () =>
        db.execute(sql`
          SELECT source, instance_id AS "instanceId", boot_id AS "bootId", at, data->>'state' AS state,
                 data->>'reason' AS reason, (data->>'uptimeMs')::float8 AS "uptimeMs"
          FROM ${hostSamples} WHERE type = 'lifecycle'
          UNION ALL
          SELECT source, instance_id, boot_id, first_at, 'restarted', 'new bootId (previous ' || left(prev, 8) || ')', NULL
          FROM (
            SELECT source, instance_id, boot_id, min(sent_at) AS first_at,
                   lag(boot_id) OVER (PARTITION BY source, instance_id ORDER BY min(sent_at)) AS prev
            FROM ${hostBatches} GROUP BY source, instance_id, boot_id
          ) b WHERE prev IS NOT NULL
          ORDER BY at DESC LIMIT ${limit}
        `),
      );
      res.json(rows.rows);
    }),
  );

  return r;
}
