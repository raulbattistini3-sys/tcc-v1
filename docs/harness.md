# Benchmark harness (Playwright for Java, Maven)

`harness/` drives the two shops in Chrome and writes one CSV row per measured
query. Java only orchestrates: everything measured runs as JS in the browser, so
the choice of language doesn't change the results.

## Scope: no backend layer

The measured path has no live database or API. The data chain is Postgres →
`pgcopy` (COPY export) → `tools/build-columnar.mjs` → a static `.bin` behind
`tools/serve.mjs`. That chain is reproducible and documented, and it keeps
network and database variance out of a question that is only about the main
thread and the worker. The server matters only for its headers (CSP,
cross-origin isolation), and the harness starts it itself so the headers are
part of every recorded run.

The thesis angle is a backend way of working applied to the frontend:
- profile before deciding;
- know where memory is allocated, and which heap it lands in;
- separate one-off costs (cold decode, index build) from per-request costs;
- treat GC as a measurable cost, not folklore.

## Running

```sh
npm run data            # once; data:10k / data:100k for the size sweep
npm run shops:build
cd harness
./mvnw -q compile exec:java -Dexec.args="--apps react,angular --strategies main,worker --samples 5 --trace"
```

(`mvnw.cmd` from cmd/PowerShell.) The wrapper downloads Maven 3.9.16 on first
use. Chrome comes from the local install (`--channel chrome`), and no browser
is downloaded. `--channel chromium` uses Playwright's bundled build instead.

Output in `results/<runId>/` (git-ignored):
- `queries.csv` — one row per measured query (columns below)
- `run.json` — commit (with `-dirty`), OS, cores, Chrome version, arguments
- `traces/*.json` — one Chrome trace per sample, with `--trace`
- `errors.log` — failed samples (timeouts, crashes); the run continues

### Flags

| flag | default | meaning |
|---|---|---|
| `--apps` | `react,angular` | also `angular-zone` (zone.js control build) |
| `--conds` | `logged` | `empty`, `layout`, `logged`, `full` (see apps/shared/conditions.js) |
| `--strategies` | `adaptive,main,worker` | also `fixed` |
| `--matches` | `contains` | `token`, `prefix` (search mode, see below) |
| `--data` | `/data/produtos.bin` | e.g. `/data/produtos-10k.bin,/data/produtos-100k.bin,/data/produtos.bin` |
| `--throttle` | `1` | CDP CPU throttling rate, e.g. `1,4` |
| `--samples` | `3` | cold page loads per combination |
| `--warmup` / `--warm` | `2` / `3` | passes after the cold one, labelled `warming` / `warm` |
| `--search` / `--category` | `mouse` / `6` | search term; category checkbox index (6 = INFORMATICA) |
| `--trace` | off | Chrome trace per sample → GC per thread per query |
| `--csp` / `--port` | `strict` / `5180` | server the harness starts |
| `--base-url` | — | use an already-running server instead |
| `--headed`, `--channel`, `--out`, `--step-timeout` (s), `--probe-delay` (ms) | | |

## What one sample is

1. A new browser context: fresh cache, storage and renderer. This is the **cold** state.
2. Load `/<app>/?cond=…&strategy=…&match=…&data=…&seed=7` and wait for `window.__shop.ready`.
3. Unmeasured setup: switch to the table view, so the sort headers are clickable.
4. `1 + warmup + warm` passes. Between passes, `__shop.reset()` returns to the initial
   query; that reset is not measured. Every pass runs the same steps:

| step | input | what it exercises |
|---|---|---|
| `sort-price` | click on the Preço header | Float64 sort of all rows |
| `sort-name` | click on the Produto header | dictionary-code sort (integer compare) |
| `search` | click the box, type `mouse` (60 ms/key) | text filter on 600k distinct names, mode-dependent |
| `category` | click the category checkbox | facet filter (10 distinct values) on top |

`cond=empty` has no header or sidebar, so only the two sorts run there.

Each step ends when the page has painted the result of the query it started
(`shop:query:<id>:painted`). After the trigger, the harness clicks a probe: a
fixed 12×12 box the harness injects, with no handlers. For `search` the click
comes 30 ms after the debounce fires; for clicks it comes 30 ms after the
trigger. Its Event Timing duration is the input delay a user would feel if they
clicked at that moment.

## Measurement sources

The harness doesn't trust the system under test for what a user would feel:

| source | columns |
|---|---|
| app probe `window.__shop.queries` (joined by queryId) | decision (`target`, `reason`, `explored`, predictions, budget, `mainBusy`, `pressure`), `computeToResultMs`, `mainBlockedMs`, `prepareMs`, `filterMs`, `sortMs`, worker `postMs/queueMs/replyMs`, `toPaintMs` |
| harness init script (its own PerformanceObservers, injected before any page script) | `interactionMs`, `interactionInputDelayMs` (the step's own input), `probeMs`, `probeInputDelayMs`, `loafCount`, `loafBlockingMs`, `loafMaxMs`, `loafScriptMs` |
| CDP `Performance.getMetrics` before/after the step | `heapUsedBeforeMb`, `heapUsedAfterMb`, `heapTotalAfterMb` (main-thread V8 heap), `taskMs`, `scriptMs`, `layoutMs`, `styleMs` |
| Chrome trace (`--trace`), streamed with Jackson | `gcMainMs/Count`, `gcWorkerMs/Count`: MinorGC/MajorGC overlap with [start, painted], split by thread name (CrRendererMain vs DedicatedWorker) |

Reading the columns:
- **Two separate numbers, never one ratio.** `computeToResultMs` (time to result) and
  `mainBlockedMs` (main-thread time the run took) answer different questions. The old
  "602 ms vs 5 ms" compared a cold main-thread *result time* with the worker run's
  *blocking time*. Keep both columns, compare like with like, and report `prepareMs`
  (the one-off cost) apart from the per-query cost.
- **For a direct click, `interactionMs` is the INP-style number.** With `main` it contains
  the compute; with `worker` it doesn't. For the debounced search, the work starts 250 ms
  after the last key, outside that interaction, so `probeMs` is the number.
- **Blank `interactionMs`/`probeMs` means under 16 ms.** Event Timing's minimum threshold
  is 16 ms, and durations are rounded to 8 ms.
- **`heapUsed*` is the main thread only.** The worker's heap isn't reachable through page
  CDP metrics; its GC cost shows up in `gcWorker*`. The 77 MB dataset is an ArrayBuffer,
  which is external memory and not counted in `JSHeapUsedSize`. The string caches
  (decoded/lowercased names, the inverted index) are counted, on whichever thread built them.

## First smoke run (8 cores, Chrome 156, no throttling, 1 sample)

Not a result, just a check that every column carries signal:

| | main strategy | worker strategy |
|---|---|---|
| sort-price, 600k: interaction | 1.3–1.5 s | 48–176 ms |
| cold search: probe click waits | 1.8–2.0 s | 24–32 ms |
| cold search: GC in window | 113–147 ms on main | 188–270 ms on the worker |
| main heap after the steps | 50–80 MB | 9–18 MB |
| time to result (`toPaintMs`), sort-price | ~1.0–1.4 s | ~1.2–1.5 s |

The worker keeps the time to result about the same, sometimes slightly worse.
What it moves off the main thread is the blocking, the GC and the memory.

## Caveats to settle before the main sweep

- **CPU throttling and workers.** `Emulation.setCPUThrottlingRate` is applied to the page.
  Check in the results whether worker `computeToResultMs` scales with `--throttle` too.
  If it doesn't, throttled runs favour the worker artificially, and the text must say so.
- **ε-exploration.** `adaptive` sometimes explores the other target on purpose
  (`explored=true`, reason `…+explore`). Filter or report those rows separately.
- **JIT control.** For a no-optimizer control, launch with `--js-flags=--max-opt=0`. This is
  not wired as a flag yet.
- **Hydration.** This needs a Next.js variant. These SPAs have no hydration step.
