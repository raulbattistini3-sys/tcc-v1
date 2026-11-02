# Design notes

Material for chapters 2 and 5. Each section states the decision, why, and
what was observed in this prototype.

## 1. Telemetry in the extension: the two worlds

A content script runs in an **isolated world**: it shares the DOM and
`window` message events with the page, but has its own JS globals. It cannot
read the scheduler object, the dataset, or the page's variables, and the page
cannot read the extension's. That's the restriction you hit on "data shown
and usage".

| Context | Sees page JS | Has `chrome.*` | Page CSP applies to its own scripts | Used here for |
|---|---|---|---|---|
| Page bundle | yes | no | yes | scheduler, worker, collectors |
| MAIN-world content script (`page-probe.js`) | yes, it *is* the page world | no | no (injected by the browser) | LoAF for pages without the bundle |
| ISOLATED content script (`bridge.js`) | no | `runtime` only | no | validate + forward to the service worker |
| Service worker / popup | no | yes | extension CSP (`script-src 'self'`) | storage, display, export |

The path is `bundle or probe → window.postMessage → bridge → runtime.Port →
service worker`. Consequences:

- **Anything on the page can post on the same channel**, so the bridge checks
  origin, shape and size of every message. Treat extension telemetry as the
  page's claim, not ground truth.
- **Send timings, never rows.** Events carry sizes, durations and decisions.
  The bridge also strips query strings from the page URL.
- **The extension perturbs what it measures.** Its content scripts run on the
  page's main thread. LoAF entries attribute script time by `sourceURL`
  (`chrome-extension://…`), and the popup splits blocking time by origin so
  the overhead can be reported as a threat to validity.
- **The worker must belong to the page, not the extension.** A content
  script calling `new Worker(chrome.runtime.getURL(…))` is cross-origin to
  the page and fails; going through a blob URL makes it subject to the
  page's `worker-src`. This is the main argument for "bundle decides,
  extension observes".
- MV3 service workers stop when idle, so the per-tab log is mirrored to
  `chrome.storage.session` and the bridge reconnects its port on demand.

## 2. CSP and worker messaging

**CSP does not govern `postMessage`.** Main ↔ worker messages,
MessageChannel, and transferables are never blocked by CSP. What CSP controls:

| What | Directive | Observed |
|---|---|---|
| Creating the worker | `worker-src` (falls back to `child-src`, `script-src`, `default-src`) | `worker-src 'none'`: Chrome logs a violation, the worker fires `error`; `WorkerClient.create` rejects with reason `csp` and the scheduler runs everything on main (`no-worker`) |
| Blob/data URL workers (inline worker code, Comlink-style bundles) | needs `worker-src blob:` | avoided: the worker is a same-origin module file |
| `fetch` inside the worker | the **worker's own** CSP (CSP3: from the worker script's response headers); blob workers inherit the creator's | `serve.mjs` sends the header on every file, `worker.js` included |
| `sendBeacon` to a collector | `connect-src` | `beaconExporter` documents it |
| Inline `<script>` / `style=""` | `script-src` / `style-src` | the demo has none, so it runs under `--csp strict`. Setting `el.style.x` from JS (CSSOM) is allowed |

Not CSP, but in the same family:

- **SharedArrayBuffer** needs cross-origin isolation (COOP `same-origin` +
  COEP `require-corp`), not a CSP change. `serve:coi` enables it. Observed
  bug, fixed: `TextDecoder.decode` throws on views over a SharedArrayBuffer,
  so shared bytes are copied before decoding (only the decoded slice, or the
  string table once).
- **Cross-origin worker scripts** fail regardless of CSP: the worker URL must
  be same-origin with the page.

"Proxying" (Comlink-style RPC over `MessagePort`) is just more `postMessage`,
so CSP doesn't affect it either. It only matters if the proxy library builds
its worker from a blob URL.

## 3. Gateway vs. MITM: what applies here

orderguard's threat is a party **between client and server** that
duplicates, replays or rewrites requests. Its fixes are rate limiting, HMAC
signing and idempotency at a gateway. Map that onto this system:

| Hop | Network? | MITM possible? | Defence |
|---|---|---|---|
| Server → page: `produtos.bin`, the bundle | yes | yes | HTTPS. Subresource Integrity on the bundle if it comes from a CDN |
| Page ↔ worker | no, same renderer process | no network attacker. Another script in the page could patch `Worker`/`postMessage` | CSP `script-src` + `worker-src 'self'`, Trusted Types; a gateway can't help |
| Page ↔ extension | no | any page script can forge or read these messages | validation in `bridge.js`; treat as untrusted |
| Page → telemetry collector (`beaconExporter`) | yes | yes | HTTPS + a gateway |

So: **no gateway is needed for the offloading itself.** Once data is in the
page, nothing leaves the machine, and a gateway sits on a network path that
doesn't exist. Do *not* copy orderguard's HMAC signing into the browser: a
secret shipped in a bundle is not a secret, so any signature it makes proves
nothing. If you add a central telemetry collector, put a gateway in front of
it, reusing orderguard's **rate limit and body-size cap** plus a schema check
on the event batch. Leave out the signing and idempotency: duplicate
telemetry is harmless, and there is no shared secret to sign with.

One real MITM exposure exists today, upstream of the browser:
`additional-scripts/pgcopy/src/main.rs` connects to Postgres with
`danger_accept_invalid_certs(true)`. Anyone on that path can read or alter
the export. Download the Supabase CA (Project Settings → Database) and verify
it.

## 4. Go → JavaScript mapping

| Go (agent-server-monitoring-collection) | Here |
|---|---|
| `collector.ICollector{Name; Collect(ctx, out chan<- Event)}` | `Collector{name, supported(), start(emit), stop()}` in `telemetry/bus.js` |
| `chan event.Event` + fan-out goroutine | `emit()` calling each exporter synchronously, because there's one thread; exporters buffer and flush on a timer |
| `exporter.Exporter.Export(ctx, e)` | `Exporter.export(e)` plus optional `flush`/`stop` |
| `ctx.Done()` / `WaitGroup` | `bus.stop()` |
| goroutine doing CPU work | Web Worker; data crosses as `ArrayBuffer`, not shared structs |
| `struct` + interface | `@typedef` + duck-typed object; `tsc --checkJs` enforces it |
| `[]float64` columns | `Float64Array` views over one buffer |

The orderguard attacker already used this JSDoc style (`signing.js`), so
the conventions are the same.

## 5. Observations so far (one machine, headless Chrome, noisy)

These are smoke-test numbers, not results. Use the benchmark sweep.

- 600k sort by `valor_de_venda`: worker, ~0.1 ms main-thread blocking;
  main would block ~0.7–1.8 s depending on machine load.
- 1k sort: main, 1–6 ms, below the worker's fixed cost.
- 50k sort, idle: main (predicted 46.6 ms ≤ budget 48.7 ms). Same op with
  75% background load: worker (budget shrank to 11.1 ms). That's the
  "crossover moves with load" effect.
- Under load, the worker's reply waited up to 60 ms behind main-thread tasks:
  offloading doesn't remove main-thread *queueing* for the result.
- Clone hand-off of the 77 MB dataset: 47–82 ms on main, once at startup.
- Headless Chrome reported Compute Pressure `critical` at times, so pressure
  must be logged with each run.
- Open design point for the research question: the adaptive rule minimises
  blocking, and for large ops it accepts a longer time-to-result on the
  worker. If "without increasing time-to-result" is strict, add a tolerance
  term (e.g. prefer main when T_worker > (1+τ)·T_main and T_main ≤ k·budget).
