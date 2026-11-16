import { HostTelemetryEnvelope, type TelemetrySample } from "@tcc/contracts";

// The IPC ingest protocol between a Node service and its telemetry child (tcc-v2.exe with
// TCC_MODE=ingest-ipc), over the "ipc" stdio slot (child_process.spawn/fork, JSON serialization).
// No HTTP on either side: the service sends its host telemetry envelopes as messages, the child stores
// them in the TCC database and acks each; the child, which the service started and which therefore sits
// in the service's job object, sends the job's readings (win.job: its memory limit, peaks, processes,
// CPU, I/O; win.system) back, so the service's adaptive policy and its own envelopes see the limit it
// actually runs under. sample-erp-api implements the other end (api/src/utils/telemetry ipc sender).
//
//   service → child  { kind: "envelope", id, envelope }   a HostTelemetryEnvelope
//   child → service  { kind: "ready", pid, job }           job: whether win.job/win.system readings follow
//                    { kind: "ack", id, duplicate, samples }
//                    { kind: "nack", id, error, retry }     retry: false for a bad envelope (resending won't help)
//                    { kind: "job", at, samples }           every jobIntervalMs, TelemetrySample[]

export const IPC_PROTOCOL = "tcc-ingest/1";

export type ToChild = { kind: "envelope"; id: number | string; envelope: unknown };
export type ToService =
  | { kind: "ready"; protocol: string; pid: number; job: boolean }
  | { kind: "ack"; id: number | string; duplicate: boolean; samples: number }
  | { kind: "nack"; id: number | string; error: string; retry: boolean }
  | { kind: "job"; at: string; samples: TelemetrySample[] };

/** what process is to the child: its IPC channel */
export interface Channel {
  send(message: ToService): unknown;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "disconnect", listener: () => void): unknown;
}

export interface IngestOptions {
  channel: Channel;
  store: (env: HostTelemetryEnvelope) => Promise<{ duplicate: boolean; samples: number }>;
  /** the job's readings (createWindowsCollector({ process: false }).collect), absent off Windows */
  readJob?: (intervalMs: number) => TelemetrySample[];
  jobIntervalMs?: number;
  /** the service went away: stop and exit */
  onDisconnect: () => void;
  onError?: (err: unknown) => void;
}

export interface IngestStats {
  stored: number;
  duplicates: number;
  rejected: number;
  failed: number;
}

export function serveIngest(opts: IngestOptions): { stop(): void; stats: IngestStats } {
  const stats: IngestStats = { stored: 0, duplicates: 0, rejected: 0, failed: 0 };
  const interval = opts.jobIntervalMs ?? 1000;
  const send = (m: ToService) => {
    try {
      opts.channel.send(m);
    } catch (err) {
      opts.onError?.(err); // the channel closed under us: disconnect follows
    }
  };

  opts.channel.on("message", (raw) => {
    const m = raw as Partial<ToChild> | null;
    if (!m || m.kind !== "envelope" || (typeof m.id !== "number" && typeof m.id !== "string")) return;
    const id = m.id;
    const parsed = HostTelemetryEnvelope.safeParse(m.envelope);
    if (!parsed.success) {
      stats.rejected++;
      send({ kind: "nack", id, error: `bad schema: ${parsed.error.issues[0]?.message ?? "invalid"}`, retry: false });
      return;
    }
    opts.store(parsed.data as HostTelemetryEnvelope).then(
      (out) => {
        if (out.duplicate) stats.duplicates++;
        else stats.stored++;
        send({ kind: "ack", id, duplicate: out.duplicate, samples: out.samples });
      },
      (err) => {
        stats.failed++;
        opts.onError?.(err);
        send({ kind: "nack", id, error: (err as Error).message ?? String(err), retry: true });
      },
    );
  });

  send({ kind: "ready", protocol: IPC_PROTOCOL, pid: process.pid, job: !!opts.readJob });

  let timer: ReturnType<typeof setInterval> | undefined;
  if (opts.readJob) {
    const read = opts.readJob;
    const tick = () => {
      try {
        const samples = read(interval);
        if (samples.length) send({ kind: "job", at: new Date().toISOString(), samples });
      } catch (err) {
        opts.onError?.(err);
      }
    };
    tick(); // the limit is known before the first envelope
    timer = setInterval(tick, interval);
  }

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  opts.channel.on("disconnect", () => {
    stop();
    opts.onDisconnect();
  });
  return { stop, stats };
}
