import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { serveIngest, IPC_PROTOCOL, type ToService } from "../src/lib/ingest-ipc.js";

// the child's side of the IPC ingest protocol, against a fake channel and store (no database)

class FakeChannel extends EventEmitter {
  sent: ToService[] = [];
  send(m: ToService) {
    this.sent.push(m);
    return true;
  }
}

const envelope = (sequence: number, samples = 2) => ({
  version: 1,
  source: "sample-erp-api",
  instanceId: "api-launcher",
  bootId: "11111111-1111-4111-8111-111111111111",
  sequence,
  timestamp: new Date().toISOString(),
  samples: Array.from({ length: samples }, (_, i) => ({ type: "test.sample", category: "runtime", value: 1000 + i })),
});

const tick = () => new Promise((r) => setImmediate(r));

test("stores each envelope and acks it by id; a resend is acked as a duplicate", async () => {
  const ch = new FakeChannel();
  const seen = new Set<number>();
  const ingest = serveIngest({
    channel: ch,
    store: async (e) => {
      const duplicate = seen.has(e.sequence);
      seen.add(e.sequence);
      return { duplicate, samples: duplicate ? 0 : e.samples.length };
    },
    onDisconnect: () => {},
  });
  assert.deepEqual(ch.sent[0], { kind: "ready", protocol: IPC_PROTOCOL, pid: process.pid, job: false });

  ch.emit("message", { kind: "envelope", id: 1, envelope: envelope(0, 3) });
  ch.emit("message", { kind: "envelope", id: 2, envelope: envelope(0, 3) });
  ch.emit("message", { kind: "something else" });
  await tick();
  assert.deepEqual(ch.sent.slice(1), [
    { kind: "ack", id: 1, duplicate: false, samples: 3 },
    { kind: "ack", id: 2, duplicate: true, samples: 0 },
  ]);
  assert.deepEqual(ingest.stats, { stored: 1, duplicates: 1, rejected: 0, failed: 0 });
});

test("a bad envelope is nacked without retry, a failed store with retry", async () => {
  const ch = new FakeChannel();
  const ingest = serveIngest({
    channel: ch,
    store: async () => {
      throw new Error("connection refused");
    },
    onDisconnect: () => {},
    onError: () => {},
  });
  ch.emit("message", { kind: "envelope", id: "a", envelope: { source: "x" } });
  ch.emit("message", { kind: "envelope", id: "b", envelope: envelope(1) });
  await tick();
  const [bad, failed] = ch.sent.slice(1) as Extract<ToService, { kind: "nack" }>[];
  assert.equal(bad!.kind, "nack");
  assert.equal(bad!.id, "a");
  assert.equal(bad!.retry, false);
  assert.deepEqual(failed, { kind: "nack", id: "b", error: "connection refused", retry: true });
  assert.deepEqual(ingest.stats, { stored: 0, duplicates: 0, rejected: 1, failed: 1 });
});

test("reports the job's readings at once and on its interval, and stops when the service disconnects", async () => {
  const ch = new FakeChannel();
  let reads = 0;
  let gone = false;
  serveIngest({
    channel: ch,
    store: async () => ({ duplicate: false, samples: 0 }),
    readJob: (intervalMs) => {
      reads++;
      return [{ type: "win.job", category: "runtime", intervalMs, processMemoryLimitBytes: 1024 << 20 }];
    },
    jobIntervalMs: 20,
    onDisconnect: () => (gone = true),
  });
  assert.equal(ch.sent[0]!.kind, "ready");
  assert.equal((ch.sent[0] as { job: boolean }).job, true);
  const first = ch.sent[1] as Extract<ToService, { kind: "job" }>;
  assert.equal(first.kind, "job");
  assert.equal((first.samples[0] as Record<string, unknown>).processMemoryLimitBytes, 1024 << 20);
  await new Promise((r) => setTimeout(r, 70));
  ch.emit("disconnect");
  const after = reads;
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(after >= 3, `read ${after} times`);
  assert.equal(reads, after, "no reads after the disconnect");
  assert.equal(gone, true);
});
