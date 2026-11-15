import { sql } from "drizzle-orm";
import { sampleCategory, type HostTelemetryEnvelope, type TelemetrySample } from "@tcc/contracts";
import type { Db } from "../db/client.js";
import { hostBatches, hostRollups, hostSamples } from "../db/schema.js";

/** what a sample aggregates over: "GET /clientes 2xx" for a request, the query name for a query, else '' */
export function sampleName(s: TelemetrySample): string {
  const r = s as Record<string, unknown>;
  if (s.type === "http.request") return `${r.method} ${r.route} ${r.status}`;
  if (typeof r.name === "string") return r.name.slice(0, 256);
  if (s.type === "lifecycle" && typeof r.state === "string") return r.state;
  return "";
}

/**
 * Stores one envelope and its samples in one statement. The same (source, instance, boot, sequence)
 * again is a resend: the batch's `duplicates` goes up and nothing else is stored.
 */
export async function storeHostEnvelope(db: Db, env: HostTelemetryEnvelope): Promise<{ id: string; duplicate: boolean; samples: number }> {
  const rows = env.samples.map((s) => {
    const { type, category: _c, ...data } = s as Record<string, unknown> & { type: string };
    return { category: sampleCategory(s), type, name: sampleName(s), data };
  });
  const result = await db.execute<{ id: string; duplicate: boolean; samples: number }>(sql`
    WITH b AS (
      INSERT INTO ${hostBatches} (source, instance_id, boot_id, sequence, sent_at, sample_count, body)
      VALUES (${env.source}, ${env.instanceId}, ${env.bootId}, ${env.sequence}, ${env.timestamp}::timestamptz, ${env.samples.length}, ${JSON.stringify(env)}::jsonb)
      ON CONFLICT (source, instance_id, boot_id, sequence) DO UPDATE SET duplicates = ${hostBatches.duplicates} + 1
      -- xmax is set on a row this statement updated, i.e. on a conflict
      RETURNING id, sent_at, (xmax <> 0) AS duplicate
    ), ins AS (
      INSERT INTO ${hostSamples} (batch_id, source, instance_id, boot_id, at, category, type, name, data)
      SELECT b.id, ${env.source}, ${env.instanceId}, ${env.bootId}, b.sent_at, s.category, s.type, s.name, s.data
      FROM b, jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS s(category text, type text, name text, data jsonb)
      WHERE NOT b.duplicate
      RETURNING 1
    )
    SELECT (SELECT id FROM b) AS id, (SELECT duplicate FROM b) AS duplicate, (SELECT count(*)::int FROM ins) AS samples
  `);
  return result.rows[0]!;
}

/**
 * Samples older than `rawHours` (whole minutes before the cutoff) become one host_rollups row per
 * minute, instance, type and name: avg/min/max of every numeric field. Lifecycle samples stay as
 * they are. The batches keep their sequence bookkeeping (gaps, duplicates) but drop their bodies.
 * Returns how many samples were folded.
 */
export async function rollupHostSamples(db: Db, rawHours: number): Promise<number> {
  const result = await db.execute<{ folded: number }>(sql`
    WITH cutoff AS (SELECT date_trunc('minute', now() - make_interval(hours => ${rawHours})) AS at),
    old AS (
      DELETE FROM ${hostSamples} s USING cutoff
      WHERE s.at < cutoff.at AND s.category <> 'lifecycle'
      RETURNING s.id, s.source, s.instance_id, s.category, s.type, s.name, s.at, s.data
    ), kv AS (
      SELECT date_trunc('minute', o.at) AS bucket, o.source, o.instance_id, o.category, o.type, o.name, o.id,
             f.key, (f.value #>> '{}')::float8 AS v
      FROM old o, jsonb_each(o.data) f
      WHERE jsonb_typeof(f.value) = 'number'
    ), per_field AS (
      SELECT bucket, source, instance_id, category, type, name, key,
             avg(v) AS a, min(v) AS mn, max(v) AS mx, count(DISTINCT id) AS n
      FROM kv GROUP BY bucket, source, instance_id, category, type, name, key
    ), ins AS (
      INSERT INTO ${hostRollups} (bucket, source, instance_id, category, type, name, samples, fields)
      SELECT bucket, source, instance_id, category, type, name, max(n)::int,
             jsonb_object_agg(key, jsonb_build_object('avg', round(a::numeric, 3), 'min', mn, 'max', mx))
      FROM per_field GROUP BY bucket, source, instance_id, category, type, name
      -- only a late batch lands in a minute already rolled up: its fields replace the earlier ones
      ON CONFLICT (bucket, source, instance_id, type, name)
      DO UPDATE SET samples = ${hostRollups.samples} + EXCLUDED.samples, fields = ${hostRollups.fields} || EXCLUDED.fields
      RETURNING 1
    ), strip AS (
      UPDATE ${hostBatches} SET body = '{}'::jsonb FROM cutoff
      WHERE ${hostBatches.sentAt} < cutoff.at AND ${hostBatches.body} <> '{}'::jsonb
      RETURNING 1
    )
    SELECT (SELECT count(*)::int FROM old) AS folded, (SELECT count(*) FROM ins) AS rollups, (SELECT count(*) FROM strip) AS stripped
  `);
  return result.rows[0]?.folded ?? 0;
}
