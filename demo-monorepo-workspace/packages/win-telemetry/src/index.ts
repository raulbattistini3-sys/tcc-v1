// Windows observation for a Node service, as host-telemetry samples:
//
//   win.process  this process: working set, private bytes, CPU %, handles, GDI/USER objects, I/O per window
//   win.job      the job object it runs in (network's supervisor puts the stack in one): processes, CPU %, I/O, peaks
//   win.system   machine memory load, commit, CPU %, process/thread/handle counts
//   win.pdh      any PDH counters asked for by English path
//   win.etw      an ETW real-time session (Kernel-Process / Kernel-Network by default): events per window by
//                provider/event and by process, dropped count. Needs elevation or "Performance Log Users".
//
// The native part (build/win_telemetry.node, `pnpm --filter @tcc/win-telemetry build`) is optional: off Windows
// or unbuilt, loadNative() is null and the collector returns no samples, so services can always plug it in.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TelemetrySample } from "@tcc/contracts";

export interface ProcessInfo {
  pid: number;
  workingSetBytes?: number;
  peakWorkingSetBytes?: number;
  privateBytes?: number;
  pagefileBytes?: number;
  peakPagefileBytes?: number;
  pageFaults?: number;
  kernelMs?: number;
  userMs?: number;
  startedAt?: number;
  handles?: number;
  gdiObjects?: number;
  userObjects?: number;
  ioReadBytes?: number;
  ioWriteBytes?: number;
  ioOtherBytes?: number;
  ioReadOps?: number;
  ioWriteOps?: number;
}

export interface JobInfo {
  userMs?: number;
  kernelMs?: number;
  pageFaults?: number;
  totalProcesses?: number;
  activeProcesses?: number;
  terminatedProcesses?: number;
  ioReadBytes?: number;
  ioWriteBytes?: number;
  ioReadOps?: number;
  ioWriteOps?: number;
  peakProcessMemoryBytes?: number;
  peakJobMemoryBytes?: number;
  jobMemoryLimitBytes?: number;
  limitFlags?: number;
  killOnClose?: boolean;
  pids?: number[];
  pidsTruncated?: boolean;
}

export interface SystemInfo {
  memoryLoadPct?: number;
  totalPhysBytes?: number;
  availPhysBytes?: number;
  commitBytes?: number;
  commitLimitBytes?: number;
  systemCacheBytes?: number;
  kernelPagedBytes?: number;
  kernelNonpagedBytes?: number;
  handles?: number;
  processes?: number;
  threads?: number;
  idleMs?: number;
  kernelMs?: number;
  userMs?: number;
  processors: number;
  uptimeMs: number;
}

export interface EtwProvider {
  guid: string;
  /** 1 critical … 5 verbose (default 4) */
  level?: number;
  /** hex string ("0x70") or number; default all */
  keywords?: string | number;
}

export interface EtwEvent {
  provider: string;
  id: number;
  opcode: number;
  level: number;
  pid: number;
  tid: number;
  time: number;
}

export interface EtwDrain {
  events: EtwEvent[];
  counts: Array<{ provider: string; id: number; count: number }>;
  other: number;
  dropped: number;
  total: number;
  running: boolean;
  status?: string;
}

/** what build/win_telemetry.node exports */
export interface WinNative {
  info(): { napiVersion: number; pid: number; elevated: boolean; compiler: string };
  processInfo(pid?: number): ProcessInfo | null;
  jobInfo(): JobInfo | null;
  systemInfo(): SystemInfo;
  isElevated(): boolean;
  pdhOpen(paths: string[]): number;
  pdhSample(id: number): Array<number | null>;
  pdhClose(id: number): void;
  etwStart(opts: { providers: EtwProvider[]; capacity?: number; pids?: number[]; onEvents?: () => void }): {
    session: string;
    staleStopped: number;
  };
  etwDrain(): EtwDrain | null;
  etwStop(): void;
}

export const PROVIDERS = {
  /** process/thread/image start and stop (keywords 0x10 process, 0x20 thread, 0x40 image) */
  kernelProcess: { guid: "22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716", level: 4, keywords: "0x70" },
  /** TCP/UDP send, receive, connect, accept, retransmit (keywords 0x10 IPv4, 0x20 IPv6) */
  kernelNetwork: { guid: "7dd42a49-5329-4832-8dfd-43d979153a88", level: 4, keywords: "0x30" },
} satisfies Record<string, EtwProvider>;

const PROVIDER_NAMES: Record<string, string> = {
  [PROVIDERS.kernelProcess.guid]: "Kernel-Process",
  [PROVIDERS.kernelNetwork.guid]: "Kernel-Network",
};

const EVENT_NAMES: Record<string, Record<number, string>> = {
  "Kernel-Process": { 1: "ProcessStart", 2: "ProcessStop", 3: "ThreadStart", 4: "ThreadStop", 5: "ImageLoad", 6: "ImageUnload" },
  "Kernel-Network": {
    10: "TcpSend", 11: "TcpRecv", 12: "TcpConnect", 13: "TcpDisconnect", 14: "TcpRetransmit", 15: "TcpAccept",
    26: "TcpSend6", 27: "TcpRecv6", 28: "TcpConnect6", 29: "TcpDisconnect6", 30: "TcpRetransmit6", 31: "TcpAccept6",
    42: "UdpSend", 43: "UdpRecv", 58: "UdpSend6", 59: "UdpRecv6",
  },
};

/** "Kernel-Process/ProcessStart", or the GUID and id when unknown */
export function eventName(provider: string, id: number): string {
  const p = PROVIDER_NAMES[provider] ?? provider;
  return `${p}/${EVENT_NAMES[p]?.[id] ?? id}`;
}

let loadError: string | undefined;

/** the addon, or null (not Windows, not built, or it failed to load: see nativeLoadError()) */
export function loadNative(path?: string): WinNative | null {
  if (process.platform !== "win32") {
    loadError = "not Windows";
    return null;
  }
  // the package's build/, or next to the executable (tcc-v2.exe ships it beside itself), or WIN_TELEMETRY_ADDON
  const candidates = path
    ? [path]
    : [
        process.env.WIN_TELEMETRY_ADDON,
        join(dirname(process.execPath), "win_telemetry.node"),
        ...(import.meta.url.startsWith("file:") ? [join(dirname(fileURLToPath(import.meta.url)), "..", "build", "win_telemetry.node")] : []),
      ].filter((f): f is string => !!f);
  const file = candidates.find((f) => existsSync(f));
  if (!file) {
    loadError = `${candidates.at(-1)} not built (pnpm --filter @tcc/win-telemetry build)`;
    return null;
  }
  try {
    return createRequire(import.meta.url)(file) as WinNative;
  } catch (err) {
    loadError = (err as Error).message;
    return null;
  }
}

export function nativeLoadError(): string | undefined {
  return loadError;
}

export interface WindowsCollectorOptions {
  /** default: loadNative() */
  native?: WinNative | null;
  /** include win.job when the process is in a job (default true) */
  job?: boolean;
  /** include win.system (default true) */
  system?: boolean;
  /** PDH counters as label -> English path, e.g. { diskQueue: "\\PhysicalDisk(_Total)\\Current Disk Queue Length" } */
  pdh?: Record<string, string>;
  /** start an ETW session (default off: needs elevation); true = Kernel-Process + Kernel-Network */
  etw?: boolean | { providers?: EtwProvider[]; capacity?: number; pids?: number[]; top?: number };
  onError?: (err: unknown) => void;
}

export interface WindowsCollector {
  /** for createHostTelemetry({ collectors: [c.collect] }) */
  collect: (intervalMs: number) => TelemetrySample[];
  stop(): void;
  readonly available: boolean;
  /** the ETW session's name, or why it isn't running */
  readonly etw: { session?: string; error?: string };
}

const round = (n: number) => Math.round(n * 100) / 100;
const delta = (now: number | undefined, prev: number | undefined) =>
  now === undefined || prev === undefined ? undefined : Math.max(0, now - prev);

export function createWindowsCollector(opts: WindowsCollectorOptions = {}): WindowsCollector {
  const native = opts.native === undefined ? loadNative() : opts.native;
  const onError = opts.onError ?? (() => {});
  const etwState: { session?: string; error?: string } = {};
  if (!native) {
    etwState.error = loadError;
    return { collect: () => [], stop() {}, available: false, etw: etwState };
  }

  const processors = native.systemInfo().processors || 1;
  let prevProc: ProcessInfo | null = null;
  let prevJob: JobInfo | null = null;
  let prevSys: SystemInfo | null = null;

  const pdhLabels = Object.keys(opts.pdh ?? {});
  let pdhId: number | undefined;
  if (pdhLabels.length) {
    try {
      pdhId = native.pdhOpen(pdhLabels.map((l) => opts.pdh![l]!));
    } catch (err) {
      onError(err);
    }
  }

  // ETW counts are kept per window in bounded maps; the native ring is drained on collect and whenever it
  // signals (at most every 250 ms) so a busy window doesn't overflow it
  const top = typeof opts.etw === "object" && opts.etw.top ? opts.etw.top : 20;
  let etwWindow = { events: 0, dropped: 0, other: 0, byEvent: new Map<string, number>(), byPid: new Map<number, number>() };
  let etwTimer: NodeJS.Timeout | undefined;
  let etwStatus: string | undefined;
  const drainEtw = () => {
    etwTimer = undefined;
    const d = native.etwDrain();
    if (!d) return;
    etwWindow.events += d.events.length;
    etwWindow.dropped += d.dropped;
    etwWindow.other += d.other;
    for (const c of d.counts) {
      const k = eventName(c.provider, c.id);
      etwWindow.byEvent.set(k, (etwWindow.byEvent.get(k) ?? 0) + c.count);
    }
    for (const e of d.events) {
      if (etwWindow.byPid.has(e.pid) || etwWindow.byPid.size < 1000) etwWindow.byPid.set(e.pid, (etwWindow.byPid.get(e.pid) ?? 0) + 1);
    }
    if (!d.running) etwStatus = d.status ?? "session ended";
  };
  if (opts.etw) {
    const o = typeof opts.etw === "object" ? opts.etw : {};
    try {
      const r = native.etwStart({
        providers: o.providers ?? [PROVIDERS.kernelProcess, PROVIDERS.kernelNetwork],
        ...(o.capacity ? { capacity: o.capacity } : {}),
        ...(o.pids ? { pids: o.pids } : {}),
        onEvents: () => {
          etwTimer ??= setTimeout(drainEtw, 250);
          etwTimer.unref();
        },
      });
      etwState.session = r.session;
    } catch (err) {
      etwState.error = (err as Error).message;
      onError(err);
    }
  }

  function collect(intervalMs: number): TelemetrySample[] {
    const samples: TelemetrySample[] = [];
    const cpuPct = (ms: number | undefined) => (ms === undefined || intervalMs <= 0 ? undefined : round((ms / intervalMs / processors) * 100));

    const p = native!.processInfo();
    if (p) {
      samples.push({
        type: "win.process",
        category: "runtime",
        intervalMs,
        pid: p.pid,
        workingSetBytes: p.workingSetBytes,
        peakWorkingSetBytes: p.peakWorkingSetBytes,
        privateBytes: p.privateBytes,
        handles: p.handles,
        gdiObjects: p.gdiObjects,
        userObjects: p.userObjects,
        ...(prevProc
          ? {
              cpuPct: cpuPct(delta((p.kernelMs ?? 0) + (p.userMs ?? 0), (prevProc.kernelMs ?? 0) + (prevProc.userMs ?? 0))),
              pageFaults: delta(p.pageFaults, prevProc.pageFaults),
              ioReadBytes: delta(p.ioReadBytes, prevProc.ioReadBytes),
              ioWriteBytes: delta(p.ioWriteBytes, prevProc.ioWriteBytes),
            }
          : {}),
      });
      prevProc = p;
    }

    if (opts.job !== false) {
      const j = native!.jobInfo();
      if (j) {
        samples.push({
          type: "win.job",
          category: "runtime",
          intervalMs,
          activeProcesses: j.activeProcesses,
          totalProcesses: j.totalProcesses,
          terminatedProcesses: j.terminatedProcesses,
          peakJobMemoryBytes: j.peakJobMemoryBytes,
          peakProcessMemoryBytes: j.peakProcessMemoryBytes,
          killOnClose: j.killOnClose,
          pids: j.pids,
          ...(prevJob
            ? {
                cpuPct: cpuPct(delta((j.kernelMs ?? 0) + (j.userMs ?? 0), (prevJob.kernelMs ?? 0) + (prevJob.userMs ?? 0))),
                ioReadBytes: delta(j.ioReadBytes, prevJob.ioReadBytes),
                ioWriteBytes: delta(j.ioWriteBytes, prevJob.ioWriteBytes),
              }
            : {}),
        });
        prevJob = j;
      }
    }

    if (opts.system !== false) {
      const s = native!.systemInfo();
      let sysCpu: number | undefined;
      if (prevSys && s.kernelMs !== undefined && s.userMs !== undefined && s.idleMs !== undefined) {
        const total = s.kernelMs + s.userMs - ((prevSys.kernelMs ?? 0) + (prevSys.userMs ?? 0));
        const idle = s.idleMs - (prevSys.idleMs ?? 0);
        sysCpu = total > 0 ? round(((total - idle) / total) * 100) : undefined;
      }
      samples.push({
        type: "win.system",
        category: "runtime",
        intervalMs,
        memoryLoadPct: s.memoryLoadPct,
        totalPhysBytes: s.totalPhysBytes,
        availPhysBytes: s.availPhysBytes,
        commitBytes: s.commitBytes,
        commitLimitBytes: s.commitLimitBytes,
        processes: s.processes,
        threads: s.threads,
        handles: s.handles,
        processors: s.processors,
        ...(sysCpu !== undefined ? { cpuPct: sysCpu } : {}),
      });
      prevSys = s;
    }

    if (pdhId !== undefined) {
      try {
        const v = native!.pdhSample(pdhId);
        samples.push({ type: "win.pdh", category: "performance", intervalMs, values: Object.fromEntries(pdhLabels.map((l, i) => [l, v[i] ?? null])) });
      } catch (err) {
        onError(err);
      }
    }

    if (etwState.session) {
      drainEtw();
      const w = etwWindow;
      const byEvent = [...w.byEvent.entries()].sort((a, b) => b[1] - a[1]);
      const byPid = [...w.byPid.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      samples.push({
        type: "win.etw",
        category: "other",
        intervalMs,
        session: etwState.session,
        events: [...w.byEvent.values()].reduce((a, b) => a + b, 0) + w.other,
        dropped: w.dropped,
        byEvent: Object.fromEntries(byEvent.slice(0, top)),
        ...(byEvent.length > top ? { otherEvents: byEvent.slice(top).reduce((a, [, n]) => a + n, 0) } : {}),
        byPid: Object.fromEntries(byPid.map(([pid, n]) => [String(pid), n])),
        ...(etwStatus ? { status: etwStatus } : {}),
      });
      etwWindow = { events: 0, dropped: 0, other: 0, byEvent: new Map(), byPid: new Map() };
    }
    return samples;
  }

  return {
    collect,
    stop() {
      if (etwTimer) clearTimeout(etwTimer);
      if (etwState.session) native.etwStop();
      etwState.session = undefined;
      if (pdhId !== undefined) native.pdhClose(pdhId);
      pdhId = undefined;
    },
    available: true,
    etw: etwState,
  };
}
