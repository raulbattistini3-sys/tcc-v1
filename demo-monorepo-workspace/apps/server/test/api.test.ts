// Integration tests over HTTP against a real Postgres. Point TEST_DATABASE_URL at a throwaway database
// with the migrations applied (see the server README); the tables are truncated between tests.
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55432/tcc_logs pnpm test
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client.js";
import { createApp } from "../src/app.js";
import type { Config } from "../src/env.js";

const url = process.env.TEST_DATABASE_URL;
const TOKEN = "test-token";

describe("server", { skip: url ? false : "set TEST_DATABASE_URL to run the integration tests" }, () => {
  const config = { DATABASE_URL: url!, DATABASE_SSL: "off", token: TOKEN, origins: [], PUBLIC_READS: "0", LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "silent" } as unknown as Config;
  const { db, pool } = createDb(config);
  let server: Server;
  let base = "";

  const call = (path: string, init: RequestInit & { token?: string | null } = {}) => {
    const { token = TOKEN, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(base + path, { ...rest, headers });
  };
  const postJson = (path: string, body: unknown, token: string | null = TOKEN) =>
    call(path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" }, token });

  before(async () => {
    server = createApp(db, config).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE ingest_batches, telemetry_events, host_batches, host_samples, host_rollups, sweep_runs, sweep_results, scrape_runs, scraped_listings CASCADE`);
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    await pool.end();
  });

  test("/health needs no token", async () => {
    const res = await call("/health", { token: null });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok");
  });

  describe("/ingest (the old log-listener's protocol)", () => {
    const stream = {
      v: 1,
      kind: "stream",
      installId: "0123456789abcdef",
      label: "laptop",
      ext: "0.3.0",
      ua: "Chrome/156",
      sentAt: 1_793_000_000_000,
      batches: [
        { tabId: 7, page: "http://localhost:5173/", world: "MAIN", timeOrigin: 1_792_999_000_000.5, receivedAt: 1, events: [
          { source: "scheduler", type: "decision", ts: 10.25, data: { target: "worker", predMainMs: 81.5 } },
          { source: "loaf", type: "frame", ts: 11, data: { duration: 64 } },
        ] },
        { tabId: 8, page: "http://localhost:5174/react/", world: "MAIN", timeOrigin: 5, receivedAt: 2, events: [
          { source: "scheduler", type: "result", ts: 12, data: { totalMs: 40, big: 12345678901234567890 } },
        ] },
      ],
    };

    test("stores the body byte for byte and one row per event", async () => {
      // spacing and a number past 2^53: neither survives a JSON.parse/JSON.stringify round trip
      const raw = JSON.stringify(stream, null, 1).replace('"big": 12345678901234567000', '"big": 12345678901234567890');
      const res = await postJson("/ingest", raw);
      assert.equal(res.status, 204);

      const batch = await db.execute<{ body_text: string; big: string; event_count: number; kind: string; install_id: string }>(
        sql`SELECT body_text, body->'batches'->1->'events'->0->'data'->>'big' AS big, event_count, kind, install_id FROM ingest_batches`,
      );
      assert.equal(batch.rows.length, 1);
      assert.equal(batch.rows[0]!.body_text, raw);
      assert.equal(batch.rows[0]!.big, "12345678901234567890", "jsonb keeps the number exactly (numeric)");
      assert.equal(batch.rows[0]!.event_count, 3);
      assert.equal(batch.rows[0]!.install_id, "0123456789abcdef");

      const events = await db.execute<{ tab_id: number; page: string; world: string; source: string; type: string; ts: number; time_origin: number; target: string | null }>(
        sql`SELECT tab_id, page, world, source, type, ts, time_origin, data->>'target' AS target FROM telemetry_events ORDER BY tab_id, ts`,
      );
      assert.deepEqual(
        events.rows.map((e) => [e.tab_id, e.world, e.source, e.type, e.ts, e.target]),
        [
          [7, "MAIN", "scheduler", "decision", 10.25, "worker"],
          [7, "MAIN", "loaf", "frame", 11, null],
          [8, "MAIN", "scheduler", "result", 12, null],
        ],
      );
      assert.equal(events.rows[0]!.time_origin, 1_792_999_000_000.5);
      assert.equal(events.rows[2]!.page, "http://localhost:5174/react/");
    });

    test("a snapshot's top-level events take the snapshot's tab and page", async () => {
      const res = await postJson("/ingest", {
        v: 1, kind: "snapshot", installId: "abc", tabId: 3, page: "http://localhost:5173/?x",
        events: [{ world: "ISOLATED", source: "bridge", type: "hello", ts: 1, data: {} }],
      });
      assert.equal(res.status, 204);
      const ev = await db.execute<{ tab_id: number; page: string; world: string }>(sql`SELECT tab_id, page, world FROM telemetry_events`);
      assert.deepEqual(ev.rows, [{ tab_id: 3, page: "http://localhost:5173/?x", world: "ISOLATED" }]);
    });

    test("a ping is stored with no events", async () => {
      assert.equal((await postJson("/ingest", { v: 1, kind: "ping", installId: "abc" })).status, 204);
      const n = await db.execute<{ batches: number; events: number }>(
        sql`SELECT (SELECT count(*)::int FROM ingest_batches) AS batches, (SELECT count(*)::int FROM telemetry_events) AS events`,
      );
      assert.deepEqual(n.rows[0], { batches: 1, events: 0 });
    });

    test("refuses a wrong token, a bad schema, invalid JSON and an oversized body", async () => {
      assert.equal((await postJson("/ingest", stream, "nope")).status, 401);
      assert.equal((await postJson("/ingest", stream, null)).status, 401);
      assert.equal((await postJson("/ingest", { v: 2, kind: "stream" })).status, 400);
      assert.equal((await postJson("/ingest", { v: 1 })).status, 400);
      assert.equal((await postJson("/ingest", "{not json")).status, 400);
      assert.equal((await postJson("/ingest", { v: 1, kind: "x", events: [{ source: "s", type: "t", ts: "soon" }] })).status, 400);
      assert.equal((await postJson("/ingest", { v: 1, kind: "x", pad: "a".repeat(2_200_000) })).status, 413);
      const n = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ingest_batches`);
      assert.equal(n.rows[0]!.n, 0);
    });

    test("the batch list and the stats read back what arrived", async () => {
      await postJson("/ingest", stream);
      const batches = (await (await call("/ingest/batches")).json()) as { eventCount: number; bytes: number; label: string }[];
      assert.equal(batches.length, 1);
      assert.equal(batches[0]!.eventCount, 3);
      assert.equal(batches[0]!.label, "laptop");
      assert.ok(batches[0]!.bytes > 100);
      const stats = (await (await call("/ingest/stats")).json()) as { source: string; type: string; events: number }[];
      assert.deepEqual(
        stats.map((s) => `${s.source}/${s.type}:${s.events}`).sort(),
        ["loaf/frame:1", "scheduler/decision:1", "scheduler/result:1"],
      );
    });

    test("a resent upload (same bootId + sequence) is acknowledged but stored once; gaps show up", async () => {
      const seq = (n: number) => ({ ...stream, bootId: "boot-a", sequence: n });
      assert.equal((await postJson("/ingest", seq(0))).status, 204);
      assert.equal((await postJson("/ingest", seq(0))).status, 204);
      assert.equal((await postJson("/ingest", seq(2))).status, 204);
      const batches = (await (await call("/ingest/batches")).json()) as unknown[];
      assert.equal(batches.length, 2);
      const seqs = (await (await call("/ingest/sequences")).json()) as { uploads: number; missing: number }[];
      assert.deepEqual(seqs.map((s) => [s.uploads, s.missing]), [[2, 1]]);
    });

    test("navigation, vitals and resources come back from the probe's events", async () => {
      const t0 = 1_793_000_000_000;
      const ev = (type: string, data: Record<string, unknown>, ts = 100) => ({ source: "ext-probe", type, ts, data });
      const nav = (timeOrigin: number, extra: Record<string, unknown>) => ({
        tabId: 3, page: "http://localhost:5173/clientes", world: "extension-main", timeOrigin,
        events: [
          ev("page", { navType: "navigate", dns: 2, tcp: 3, tls: 0, ttfb: 40, download: 5, load: 900, serverTiming: { app: 30 }, ...extra }),
          ev("vital", { name: "LCP", value: 800 }, 200),
          ev("resource", { url: "http://localhost:3000/api/clientes", initiator: "fetch", ttfb: timeOrigin === t0 ? 120 : 20, duration: 130, connect: 4, serverTiming: { app: 15, db: 9 } }, 300),
        ],
      });
      await postJson("/ingest", { ...stream, batches: [nav(t0, {}), nav(t0 + 5000, { navType: "reload" })] });
      const loads = (await (await call("/ingest/navigation")).json()) as { nthInTab: string; sincePrevNavMs: number; sincePrevLoadMs: number; firstForOrigin: boolean }[];
      assert.equal(loads.length, 2);
      assert.equal(Number(loads[0]!.nthInTab), 2);
      assert.equal(loads[0]!.sincePrevNavMs, 5000);
      assert.equal(loads[0]!.sincePrevLoadMs, 4100);
      assert.deepEqual(loads.map((l) => l.firstForOrigin), [false, true]);
      const vitals = (await (await call("/ingest/vitals")).json()) as { name: string; views: number; p75: number }[];
      assert.deepEqual(vitals.map((v) => [v.name, v.views, v.p75]), [["LCP", 2, 800]]);
      const res = (await (await call("/ingest/resources")).json()) as { requests: number; firstTtfb: number; laterTtfb: number; network: number }[];
      assert.equal(res[0]!.requests, 2);
      assert.equal(res[0]!.firstTtfb, 120);
      assert.equal(res[0]!.laterTtfb, 20);
      assert.equal(res[0]!.network, 55); // ((120 - 15) + (20 - 15)) / 2
    });
  });

  describe("/telemetry/host", () => {
    const env = (sequence: number, bootId = "boot-1", samples: unknown[] = []) => ({
      version: 1, source: "sample-erp-api", instanceId: "api-01", bootId, sequence, timestamp: new Date(Date.now() - 1000 * (10 - sequence)).toISOString(),
      samples: [
        { type: "process.memory", rssBytes: 145752064, heapUsedBytes: 68272128, externalBytes: 8120320 },
        { type: "event-loop.delay", meanMs: 3.4, p99Ms: 8.1 },
        ...samples,
      ],
    });

    test("stores the samples by category; a resend counts as a duplicate", async () => {
      assert.equal((await postJson("/telemetry/host", env(0, "boot-1", [{ type: "lifecycle", state: "started" }, { type: "custom.thing", category: "runtime", n: 1 }]))).status, 204);
      assert.equal((await postJson("/telemetry/host", env(0))).status, 204);
      const rows = await db.execute<{ category: string; type: string }>(sql`SELECT category, type FROM host_samples ORDER BY type`);
      assert.deepEqual(rows.rows.map((r) => `${r.category}/${r.type}`), ["runtime/custom.thing", "performance/event-loop.delay", "lifecycle/lifecycle", "runtime/process.memory"]);
      const latest = (await (await call("/telemetry/host/latest?category=runtime")).json()) as { type: string }[];
      assert.deepEqual(latest.map((l) => l.type).sort(), ["custom.thing", "process.memory"]);
    });

    test("a known sample type with wrong fields, or a bad envelope, is a 400", async () => {
      assert.equal((await postJson("/telemetry/host", env(0, "b", [{ type: "process.memory", rssBytes: "a lot" }]))).status, 400);
      assert.equal((await postJson("/telemetry/host", { ...env(0), version: 2 })).status, 400);
      assert.equal((await postJson("/telemetry/host", { ...env(0), timestamp: "yesterday" })).status, 400);
    });

    test("boots report missing batches, duplicates and restarts; lifecycle lists the restart", async () => {
      await postJson("/telemetry/host", env(0, "boot-1", [{ type: "lifecycle", state: "started" }]));
      await postJson("/telemetry/host", env(2, "boot-1"));
      await postJson("/telemetry/host", env(2, "boot-1"));
      await postJson("/telemetry/host", env(5, "boot-2", [{ type: "lifecycle", state: "ready" }]));
      const boots = (await (await call("/telemetry/host/boots")).json()) as { bootId: string; batches: number; missing: number; duplicates: number; restarts: number; lastState: string }[];
      const b1 = boots.find((b) => b.bootId === "boot-1")!;
      const b2 = boots.find((b) => b.bootId === "boot-2")!;
      assert.deepEqual([b1.batches, b1.missing, b1.duplicates, b1.restarts, b1.lastState], [2, 1, 1, 0, "started"]);
      assert.deepEqual([b2.missing, b2.restarts, b2.lastState], [5, 1, "ready"]);
      const life = (await (await call("/telemetry/host/lifecycle")).json()) as { state: string }[];
      assert.deepEqual(life.map((l) => l.state).sort(), ["ready", "restarted", "started"]);
    });

    test("series returns raw samples, and old ones come back as minute rollups after the rollup", async () => {
      await postJson("/telemetry/host", env(0, "boot-1", [{ type: "lifecycle", state: "started" }]));
      await db.execute(sql`UPDATE host_samples SET at = now() - interval '2 hours'`);
      const { rollupHostSamples } = await import("../src/lib/host-store.js");
      assert.equal(await rollupHostSamples(db, 1), 2);
      const kept = await db.execute<{ type: string }>(sql`SELECT type FROM host_samples`);
      assert.deepEqual(kept.rows.map((r) => r.type), ["lifecycle"]);
      const series = (await (await call("/telemetry/host/series?type=event-loop.delay&minutes=180")).json()) as { resolution: string; data: { p99Ms: number } }[];
      assert.equal(series.length, 1);
      assert.equal(series[0]!.resolution, "minute");
      assert.equal(Number(series[0]!.data.p99Ms), 8.1);
    });
  });

  describe("/sweeps", () => {
    const result = (o: Record<string, unknown>) => ({
      target: "main", strategy: "adaptive", size: 100_000, queryKind: "name:contains", computeToResultMs: 10, mainBlockedMs: 10, predMainMs: 12, predWorkerMs: 20, ...o,
    });

    test("stores a run with its results and summarizes each cell", async () => {
      const res = await postJson("/sweeps", {
        run: { source: "harness", app: "market", framework: "react", throttling: 4, datasetRows: 600_000, condition: "full", meta: { gpu: "x" } },
        results: [
          result({ computeToResultMs: 10, rep: 0 }),
          result({ computeToResultMs: 20, rep: 1 }),
          result({ computeToResultMs: 30, rep: 2, cold: true }),
          result({ target: "worker", computeToResultMs: 50, mainBlockedMs: 1, postMs: 0.4, rep: 0 }),
        ],
      });
      assert.equal(res.status, 201);
      const { id, results } = (await res.json()) as { id: string; results: number };
      assert.equal(results, 4);

      const list = (await (await call("/sweeps")).json()) as { id: string; results: number; throttling: number }[];
      assert.deepEqual(list.map((r) => [r.id, r.results, r.throttling]), [[id, 4, 4]]);

      const detail = (await (await call(`/sweeps/${id}`)).json()) as { run: { meta: unknown }; cells: { target: string; cold: boolean | null; n: number; p50Ms: number; predErrorMs: number }[] };
      assert.deepEqual(detail.run.meta, { gpu: "x" });
      const warmMain = detail.cells.find((c) => c.target === "main" && c.cold === null)!;
      assert.equal(warmMain.n, 2);
      assert.equal(warmMain.p50Ms, 15);
      assert.equal(warmMain.predErrorMs, 5); // |12-10| and |12-20|
      const worker = detail.cells.find((c) => c.target === "worker")!;
      assert.equal(worker.predErrorMs, 30); // |20-50|

      const rows = (await (await call(`/sweeps/${id}/results?limit=2`)).json()) as unknown[];
      assert.equal(rows.length, 2);
    });

    test("appends results to a run, 404 for an unknown one", async () => {
      const { id } = (await (await postJson("/sweeps", { run: { source: "demo", app: "lab" }, results: [] })).json()) as { id: string };
      assert.equal((await postJson(`/sweeps/${id}/results`, { results: [result({})] })).status, 201);
      assert.equal((await postJson(`/sweeps/00000000-0000-0000-0000-000000000000/results`, { results: [result({})] })).status, 404);
      const list = (await (await call("/sweeps")).json()) as { results: number }[];
      assert.equal(list[0]!.results, 1);
    });

    test("invalid results are a 400 with the issues, and nothing is stored", async () => {
      const res = await postJson("/sweeps", { run: { source: "harness", app: "market" }, results: [result({ target: "gpu" })] });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { issues: unknown[] };
      assert.ok(body.issues.length > 0);
      const n = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM sweep_runs`);
      assert.equal(n.rows[0]!.n, 0);
    });
  });

  describe("/scrapes", () => {
    test("stores a run with its listings; prices stay exact", async () => {
      const res = await postJson("/scrapes", {
        run: { site: "mercadolivre", startUrl: "https://lista.mercadolivre.com.br/celular", status: "ok", startedAt: "2026-11-08T10:00:00Z", finishedAt: "2026-11-08T10:00:30Z", pagesRequested: 1, pagesFetched: 1, delayMs: 5000 },
        listings: [
          { externalId: "MLB1", title: "Celular X", price: 19.9, originalPrice: 1299.99, freeShipping: true, rating: 4.5, reviewCount: 10, page: 1, position: 1 },
          { title: "Celular Y", page: 1, position: 2 },
        ],
      });
      assert.equal(res.status, 201);
      const listings = (await (await call("/listings?site=mercadolivre")).json()) as { title: string; price: number | null; originalPrice: number | null; currency: string }[];
      assert.equal(listings.length, 2);
      const x = listings.find((l) => l.title === "Celular X")!;
      assert.equal(x.price, 19.9);
      assert.equal(x.originalPrice, 1299.99);
      assert.equal(x.currency, "BRL");
      const raw = await db.execute<{ price: string }>(sql`SELECT price::text FROM scraped_listings WHERE external_id = 'MLB1'`);
      assert.equal(raw.rows[0]!.price, "19.90");

      const runs = (await (await call("/scrapes?site=mercadolivre")).json()) as { listings: number; status: string }[];
      assert.deepEqual(runs.map((r) => [r.status, r.listings]), [["ok", 2]]);
      assert.deepEqual(await (await call("/listings?site=shein")).json(), []);
    });

    test("a blocked run is stored without listings", async () => {
      const res = await postJson("/scrapes", {
        run: { site: "shein", startUrl: "https://br.shein.com/x", status: "blocked", startedAt: "2026-11-08T10:00:00Z", finishedAt: "2026-11-08T10:00:05Z", pagesRequested: 1, pagesFetched: 0, delayMs: 5000, message: "captcha" },
        listings: [],
      });
      assert.equal(res.status, 201);
      const runs = (await (await call("/scrapes")).json()) as { status: string; listings: number }[];
      assert.deepEqual(runs.map((r) => [r.status, r.listings]), [["blocked", 0]]);
    });
  });

  test("reads need the token too (PUBLIC_READS=0)", async () => {
    for (const path of ["/sweeps", "/scrapes", "/listings", "/ingest/batches", "/ingest/stats", "/ingest/navigation", "/ingest/vitals", "/ingest/resources", "/ingest/sequences", "/telemetry/host/boots", "/telemetry/host/latest", "/telemetry/host/lifecycle"]) {
      assert.equal((await call(path, { token: null })).status, 401, path);
    }
  });
});
