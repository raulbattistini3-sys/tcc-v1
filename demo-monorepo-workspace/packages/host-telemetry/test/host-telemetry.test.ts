import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { HostTelemetryEnvelope as Schema, sampleCategory } from "@tcc/contracts";
import { createHostTelemetry, Distribution, parseServerTiming, type HostTelemetryEnvelope } from "../src/index.js";

test("envelopes carry bootId, consecutive sequences and valid samples of the three categories", async () => {
  const sent: HostTelemetryEnvelope[] = [];
  const t = createHostTelemetry({ source: "test-api", instanceId: "api-01", send: async (e) => void sent.push(e) });
  t.start();
  t.ready();
  t.recordRequest({ method: "GET", route: "/clientes", status: 200, ms: 12, timings: { db: 5 } });
  t.recordRequest({ method: "GET", route: "/clientes", status: 200, ms: 20, timings: { db: 7 } });
  await t.query("clientes.list", async () => 1);
  await t.flush();
  await t.stop();

  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((e) => e.sequence), [0, 1]);
  assert.equal(sent[0]!.bootId, sent[1]!.bootId);
  for (const e of sent) assert.ok(Schema.safeParse(e).success, JSON.stringify(Schema.safeParse(e).error?.issues));

  const first = sent[0]!.samples;
  const lifecycle = first.filter((s) => s.type === "lifecycle").map((s) => (s as { state: string }).state);
  assert.deepEqual(lifecycle, ["started", "ready"]);
  const req = first.find((s) => s.type === "http.request") as Record<string, unknown>;
  assert.equal(req.count, 2);
  assert.equal(req.status, "2xx");
  assert.deepEqual(req.timings, { db: 6 });
  assert.ok(first.some((s) => s.type === "db.query"));
  assert.deepEqual(new Set(first.map(sampleCategory)), new Set(["lifecycle", "runtime", "performance"]));
  assert.ok(sent[1]!.samples.some((s) => s.type === "lifecycle" && (s as { state: string }).state === "stopping"));
});

test("a failed send keeps the envelope and retries it before the next one, in order", async () => {
  const seen: number[] = [];
  let fail = true;
  const t = createHostTelemetry({
    source: "test-api",
    send: async (e) => {
      if (fail) throw new Error("down");
      seen.push(e.sequence);
    },
  });
  await t.flush();
  assert.equal(t.queued, 1);
  fail = false;
  await t.flush();
  assert.deepEqual(seen, [0, 1]);
  assert.equal(t.queued, 0);
});

test("the middleware sends Server-Timing with app and the parts measured inside the request", async () => {
  const t = createHostTelemetry({ source: "test-api", send: async () => {} });
  const mw = t.middleware({ timingAllowOrigin: "http://localhost:5173", routeOf: () => "/x" });
  const server = createServer((req, res) =>
    mw(req, res, async () => {
      await t.query("q", () => new Promise((r) => setTimeout(r, 5)));
      res.end("ok");
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`);
  await res.text();
  server.close();
  const timing = parseServerTiming(res.headers.get("server-timing"));
  assert.ok(timing.app! >= timing.db!, JSON.stringify(timing));
  assert.ok(timing.db! >= 4);
  assert.equal(res.headers.get("timing-allow-origin"), "http://localhost:5173");
  await new Promise((r) => setTimeout(r, 10));
  const req = t.collect().find((s) => s.type === "http.request") as Record<string, unknown>;
  assert.equal(req.route, "/x");
});

test("Distribution percentiles", () => {
  const d = new Distribution();
  for (let i = 1; i <= 100; i++) d.add(i);
  const s = d.summary();
  assert.equal(s.p50Ms, 50);
  assert.equal(s.p99Ms, 99);
  assert.equal(s.maxMs, 100);
  assert.equal(s.meanMs, 50.5);
});

test("routes past maxSeries share one (other) series; process.heap is a valid sample", async () => {
  const sent: HostTelemetryEnvelope[] = [];
  const t = createHostTelemetry({ source: "test-api", send: async (e) => void sent.push(e), maxSeries: 2, heapEvery: 1 });
  for (let i = 0; i < 10; i++) t.recordRequest({ method: "GET", route: `/r/${i}`, status: 200, ms: 1 });
  for (let i = 0; i < 10; i++) t.recordQuery(`q${i}`, 1);
  await t.flush();
  const s = sent[0]!.samples;
  const routes = s.filter((x) => x.type === "http.request").map((x) => (x as { route: string }).route);
  assert.deepEqual(routes, ["/r/0", "/r/1", "(other)"]);
  const other = s.find((x) => x.type === "http.request" && (x as { route: string }).route === "(other)") as { count: number };
  assert.equal(other.count, 8);
  assert.equal(s.filter((x) => x.type === "db.query").length, 3);
  const heap = s.find((x) => x.type === "process.heap") as { spaces: Record<string, unknown> } | undefined;
  assert.ok(heap && Object.keys(heap.spaces).includes("old"));
  assert.ok(Schema.safeParse(sent[0]).success, JSON.stringify(Schema.safeParse(sent[0]).error?.issues));
});
