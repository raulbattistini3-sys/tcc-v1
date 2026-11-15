import assert from "node:assert/strict";
import { test } from "node:test";
import { HostTelemetryEnvelope } from "@tcc/contracts";
import { createWindowsCollector, eventName, loadNative, type WinNative } from "../src/index.js";

function fakeNative(): WinNative & { calls: string[] } {
  let t = 0;
  const calls: string[] = [];
  return {
    calls,
    info: () => ({ napiVersion: 8, pid: 1, elevated: false, compiler: "fake" }),
    processInfo: () => ({ pid: 1, workingSetBytes: 100, privateBytes: 50, kernelMs: 10 * t, userMs: 30 * t++, handles: 7, ioReadBytes: 1000 * t }),
    jobInfo: () => null,
    systemInfo: () => ({ processors: 4, uptimeMs: 1, memoryLoadPct: 50, idleMs: 300 * t, kernelMs: 400 * t, userMs: 100 * t }),
    isElevated: () => false,
    pdhOpen: (paths) => (calls.push(`open:${paths.length}`), 1),
    pdhSample: () => [12.5, null],
    pdhClose: () => void calls.push("close"),
    etwStart: () => ({ session: "tcc-win-1", staleStopped: 0 }),
    etwDrain: () => ({
      events: [{ provider: "22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716", id: 1, opcode: 1, level: 4, pid: 42, tid: 1, time: 0 }],
      counts: [{ provider: "22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716", id: 1, count: 3 }],
      other: 0,
      dropped: 2,
      total: 3,
      running: true,
    }),
    etwStop: () => void calls.push("etwStop"),
  };
}

test("turns counters into per-window samples that fit the envelope", () => {
  const native = fakeNative();
  const c = createWindowsCollector({ native, pdh: { cpu: "\\Processor(_Total)\\% Processor Time", nope: "\\Nope\\x" }, etw: true });
  assert.equal(c.available, true);
  assert.equal(c.etw.session, "tcc-win-1");
  c.collect(1000); // first window: no deltas yet
  const samples = c.collect(1000);
  const byType = Object.fromEntries(samples.map((s) => [s.type, s as Record<string, unknown>]));
  assert.equal(byType["win.process"]!.cpuPct, 1); // 40 ms of CPU in 1 s over 4 processors
  assert.equal(byType["win.system"]!.cpuPct, 40); // (500 total - 300 idle) / 500
  assert.deepEqual(byType["win.pdh"]!.values, { cpu: 12.5, nope: null });
  assert.deepEqual(byType["win.etw"]!.byEvent, { "Kernel-Process/ProcessStart": 3 });
  assert.equal(byType["win.etw"]!.dropped, 2);
  assert.equal(byType["win.job"], undefined);

  const env = { version: 1, source: "t", instanceId: "t", bootId: "b", sequence: 0, timestamp: new Date().toISOString(), samples };
  assert.equal(HostTelemetryEnvelope.safeParse(JSON.parse(JSON.stringify(env))).success, true);

  c.stop();
  assert.deepEqual(native.calls, ["open:2", "etwStop", "close"]);
});

test("without the addon it yields nothing", () => {
  const c = createWindowsCollector({ native: null });
  assert.equal(c.available, false);
  assert.deepEqual(c.collect(1000), []);
});

test("event names", () => {
  assert.equal(eventName("7dd42a49-5329-4832-8dfd-43d979153a88", 12), "Kernel-Network/TcpConnect");
  assert.equal(eventName("00000000-0000-0000-0000-000000000000", 9), "00000000-0000-0000-0000-000000000000/9");
});

const native = loadNative();
test("the real addon answers", { skip: native ? false : "addon not built / not Windows" }, () => {
  const p = native!.processInfo();
  assert.equal(p?.pid, process.pid);
  assert.ok((p?.workingSetBytes ?? 0) > 0);
  assert.ok(native!.systemInfo().processors >= 1);
  assert.equal(native!.processInfo(0xfffffff0), null);
  const c = createWindowsCollector({ native });
  c.collect(1000);
  const s = c.collect(1000);
  assert.ok(s.some((x) => x.type === "win.process"));
  c.stop();
});
