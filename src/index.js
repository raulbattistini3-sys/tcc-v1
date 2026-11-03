// Public entry of the bundle. One call wires data, worker, telemetry and
// scheduler together:
//
//   import { start } from "./src/index.js";
//   const app = await start({ dataUrl: "/data/produtos.bin" });
//   const r = await app.scheduler.run({ sort: [{ column: "valor_de_venda", desc: true }] });

import { openColumnar, toShared } from "./data/columnar.js";
import { WorkerClient, WorkerUnavailable } from "./worker/client.js";
import { createScheduler } from "./scheduler/scheduler.js";
import { createTelemetry } from "./telemetry/bus.js";
import { defaultCollectors } from "./telemetry/collectors.js";
import { extensionBridgeExporter, memoryExporter, signalsExporter } from "./telemetry/exporters.js";

export { openColumnar, cellText, dictString } from "./data/columnar.js";
export { runOp, textIndexStats } from "./compute/compute.js";
export { CostModel } from "./model/cost-model.js";
export { createScheduler } from "./scheduler/scheduler.js";
export { createTelemetry } from "./telemetry/bus.js";
export { loafCollector, interactionCollector, pressureCollector, memoryCollector, defaultCollectors } from "./telemetry/collectors.js";
export { signalsExporter, extensionBridgeExporter, beaconExporter, memoryExporter, BRIDGE_CHANNEL } from "./telemetry/exporters.js";
export { WorkerClient, WorkerUnavailable } from "./worker/client.js";

/** @typedef {import("./types.js").Strategy} Strategy */
/** @typedef {import("./worker/protocol.js").InitMode} InitMode */
/** @typedef {import("./telemetry/bus.js").Exporter} Exporter */

/**
 * @typedef {object} StartOptions
 * @property {string} dataUrl URL of a TCC1 columnar file
 * @property {Strategy} [strategy]
 * @property {InitMode} [initMode] defaults to `shared` when cross-origin isolated, else `clone`
 * @property {boolean} [bridge] post telemetry for the WebExtension (default true)
 * @property {Exporter[]} [exporters] extra exporters, e.g. beaconExporter
 * @property {URL | string | (() => Worker)} [workerUrl] a URL, or a factory returning
 *   `new Worker(new URL("…/worker.js", import.meta.url), { type: "module" })` when bundled
 */

/** @param {StartOptions} options */
export async function start(options) {
  const signals = signalsExporter();
  const log = memoryExporter();
  const exporters = [signals.exporter, log.exporter, ...(options.bridge === false ? [] : [extensionBridgeExporter()]), ...(options.exporters ?? [])];
  const telemetry = createTelemetry({ collectors: defaultCollectors(), exporters });
  telemetry.start();

  const t0 = performance.now();
  const res = await fetch(options.dataUrl);
  if (!res.ok) throw new Error(`${options.dataUrl}: HTTP ${res.status}`);
  let dataset = openColumnar(await res.arrayBuffer());
  const loadMs = performance.now() - t0;

  const mode = options.initMode ?? (globalThis.crossOriginIsolated ? "shared" : "clone");
  if (mode === "shared") dataset = toShared(dataset);

  /** @type {WorkerClient | null} */
  let worker = null;
  /** @type {string | null} */
  let workerError = null;
  try {
    worker = await WorkerClient.create(options.workerUrl ?? new URL("./worker/worker.js", import.meta.url), {
      dataset,
      mode,
      dataUrl: options.dataUrl,
    });
  } catch (err) {
    workerError = err instanceof WorkerUnavailable ? `${err.reason}: ${err.message}` : String(err);
  }

  telemetry.emit({
    source: "bundle",
    type: "ready",
    ts: performance.now(),
    data: {
      rows: dataset.rows,
      bytes: dataset.buffer.byteLength,
      loadMs,
      initMode: worker?.mode ?? null,
      handoffMs: worker?.handoffMs ?? null,
      workerInitMs: worker?.initMs ?? null,
      workerError,
    },
  });

  const scheduler = createScheduler({ dataset, worker, signals, strategy: options.strategy, emit: telemetry.emit });
  return { dataset, worker, workerError, scheduler, signals, telemetry, log: log.events, loadMs };
}
