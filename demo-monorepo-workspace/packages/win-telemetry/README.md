# @tcc/win-telemetry

What Windows knows about a Node service and that Node itself can't see, as host-telemetry samples. A Node-API
addon (`native/win_telemetry.cc`) plus a collector (`src/index.ts`) that plugs into `createHostTelemetry({
collectors })`.

| sample       | from                                   | what                                                                        |
| ------------ | -------------------------------------- | --------------------------------------------------------------------------- |
| `win.process`| GetProcessMemoryInfo, GetProcessTimes… | working set, private bytes, CPU % (of all cores), handles, GDI/USER objects, I/O bytes per window |
| `win.job`    | QueryInformationJobObject              | the job the process is in (network's supervisor makes one): active/total/terminated processes, CPU %, I/O, peak memory, pids |
| `win.system` | GlobalMemoryStatusEx, GetPerformanceInfo, GetSystemTimes | memory load, commit, CPU %, process/thread/handle counts |
| `win.pdh`    | PDH                                    | any counter by English path (`pdh: { label: "\\PhysicalDisk(_Total)\\Current Disk Queue Length" }`) |
| `win.etw`    | ETW real-time session `tcc-win-<pid>`  | events per window by provider/event and by pid, dropped count (default providers Kernel-Process, Kernel-Network) |

Without the built addon, or off Windows, `loadNative()` is `null` and the collector yields no samples, so a
service can always include it.

## Build

```powershell
pnpm build:native            # from the workspace root, = pnpm --filter @tcc/win-telemetry build
```

`scripts/build.mjs` uses MSVC's `cl` when it's on PATH (a Developer PowerShell), otherwise MinGW-w64 `g++` (`CXX=`
picks another). It needs only `node-api-headers`: no node-gyp, no Python, no `node.lib`. The addon looks the
`napi_*` functions up in the host executable when it loads, so the same `build/win_telemetry.node` loads in any
Node ≥ 18 and in Bun. It's linked statically and depends only on system DLLs (`objdump -p` it to check).

## Use

```ts
import { createHostTelemetry } from "@tcc/host-telemetry";
import { createWindowsCollector } from "@tcc/win-telemetry";

const win = createWindowsCollector({ etw: process.env.WIN_ETW === "1" });
const telemetry = createHostTelemetry({ source: "my-service", send, collectors: [win.collect] });
// on shutdown: win.stop() (stops the ETW session)
```

The TCC server does this itself: `WIN_TELEMETRY=auto|on|off`, `WIN_ETW=0|1` (`apps/server/.env.example`).

## ETW

- Needs an elevated process or a user in **Performance Log Users** (log out and in after adding). Otherwise
  `etwStart` throws "Access denied … run elevated or add the user to …", the collector reports it through
  `onError` and keeps the other samples.
- One session per process, named `tcc-win-<pid>`. Sessions left by a crashed process are stopped at the next
  start (Windows allows 64 sessions in total), and the addon stops its own on exit (env cleanup hook).
- Events are only counted, not decoded (no TDH): provider, event id, opcode, pid, tid, time. The consumer thread
  writes them into a bounded ring (8192 by default, `capacity`), dropping the oldest and counting the drops; it
  never calls JS, only signals through a thread-safe function (once until the next drain), and the collector
  drains at most every 250 ms and at each collect. Per-window maps are bounded too (256 event kinds natively,
  1000 pids, top 20 kinds in the sample).
- `pids: [..]` (up to 8) asks the providers to filter by process.

Check it from an elevated terminal:

```powershell
node -e "const m=require('./build/win_telemetry.node'); m.etwStart({providers:[{guid:'22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716',keywords:'0x70'}]}); setTimeout(()=>{const d=m.etwDrain(); console.log(d.total, d.counts); m.etwStop()}, 3000)"
```

(start any program during those 3 s to see ProcessStart/ImageLoad counts.)

## Not here (on purpose)

No heap snapshots (that's `writeHeapSnapshot` in `@tcc/host-telemetry`, on demand), no V8 API, no
worker-thread use (the addon keeps process-wide state: use it from the main thread).
