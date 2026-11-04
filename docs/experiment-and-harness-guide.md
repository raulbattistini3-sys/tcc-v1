# Shop experiments and Java benchmark harness

This guide explains the browser benchmark results documented for the React and
Angular shops, the Java Playwright harness that produces measurements, and the
main non-documentation features added in the merged e-commerce shops PR.

## What the current results say

The results recorded in `docs/shops.md` and `docs/harness.md` are early smoke
measurements, not a completed benchmark campaign. The harness documentation
describes one run on an 8-core machine with Chrome 156, no CPU throttling, and
one sample. There are no checked-in harness result CSVs; use the documented
figures as evidence that the measurements are working, not as stable averages
or final conclusions.

The most important result is about responsiveness rather than total compute
time. On a cold `name contains` search across 600,000 rows, the worker takes
about as long, or slightly longer, to produce and paint the result as the main
thread. However, the worker keeps the expensive work off the UI thread:

| Cold search measurement | Main thread | Worker |
|---|---:|---:|
| Time to result in the shop measurement | 1,625 ms | 1,866 ms |
| Main-thread blocking | 1,625 ms | 0.2 ms |
| Probe-click delay in the harness smoke run | 1.8–2.0 s | 24–32 ms |
| GC during the query window | 113–147 ms on main | 188–270 ms in worker |
| Main-thread heap after the steps | 50–80 MB | 9–18 MB |

The figures come from related but not identical measurements, so they should
not be treated as a single precisely matched experiment. In particular, the
worker does not eliminate decoding, computation, or garbage collection: it
moves their cost to another thread. This is why the old “602 ms vs 5 ms” style
of comparison is misleading if one number is a result time and the other is
main-thread blocking. Compare result time with result time, and blocking with
blocking.

Price sorting shows the same general tradeoff in the smoke run. The reported
time to paint was roughly 1.0–1.4 seconds on main and 1.2–1.5 seconds on the
worker. The worker strategy may keep the triggering interaction more
responsive even when completion time does not improve. One sample cannot
establish a framework or strategy ranking.

Search cost depends on the selected mode and data:

| Search mode | Approach | Documented warm-query numbers |
|---|---|---|
| `contains` | Scan distinct lowercased names | About 60–70 ms in the Node benchmark; about 100–150 ms for warm name search in the shop |
| `token` | Inverted index of whole words | About 10–15 ms in the Node benchmark |
| `prefix` | Binary-searched term range in the same index | About 10–16 ms in the Node benchmark |

The shop documentation also reports warm category filtering at about 5–9 ms
for a category column with ten distinct values. These numbers come from
different contexts, data cardinalities, and measurement paths; they illustrate
that search mode and column cardinality matter, but are not directly
interchangeable.

The documented findings also identify open measurement concerns:

- The adaptive model's prior for cold string preparation was too optimistic:
  one cold search was predicted at about 365 ms and took about 1.8 seconds.
  The decision still selected the worker, but calibration should better
  represent high-cardinality string columns.
- CPU throttling is applied through CDP emulation to the page. The benchmark
  should verify that worker computation scales with the throttle too; otherwise
  throttled runs could favor the worker artificially.
- Adaptive runs sometimes deliberately try the alternate target. Rows marked
  `explored=true` should be separated or reported explicitly.
- A first warm category query varied between the Angular zone build and the
  other variants in one sample. That is a lead for further testing, not a
  result.

## What the Java Playwright harness is

The code in `harness/` is a benchmark runner, not a conventional assertion-
driven test suite. It automates Chrome, performs user-like actions in each
shop, and records timing and runtime data. Java orchestrates the run;
filtering, sorting, rendering, and scheduling execute as JavaScript in the
browser.

The Maven project targets Java 21. Playwright for Java controls Chrome, while
Jackson Core is used to parse large Chrome trace files as a stream rather than
loading their full JSON tree into memory. `mvnw` / `mvnw.cmd` provide the Maven
wrapper.

### Run lifecycle

`tcc.harness.Main` is the entry point. In outline, it:

1. Parses the command-line options using `Config`.
2. Finds the repository root and loads `harness-init.js` from the classpath.
3. Starts `tools/serve.mjs` using `DevServer`, unless `--base-url` points at an
   already-running server.
4. Starts Playwright and launches the selected Chromium browser channel.
5. Captures run metadata, creates `results/<runId>/`, and writes `run.json`.
6. Iterates the Cartesian product of apps, conditions, strategies, search
   modes, data files, throttle values, and sample numbers.
7. Runs each combination as a sample, writes its query rows to CSV, and logs
   Playwright failures in `errors.log` so later combinations can continue.

The matrix size is the product of those configured dimensions times the sample
count. Each sample has multiple passes and multiple measured steps, so broad
matrices can take a long time. A small smoke run is useful before a full sweep.

### Configuration and run dimensions

`Config` parses comma-separated flags such as `--apps`, `--conds`,
`--strategies`, `--matches`, `--data`, and `--throttle`. It also controls
sample and pass counts, search text, category selection, browser channel,
headed mode, CPU throttle, CSP, trace collection, and output location. Unknown
flags are rejected.

By default, each sample has one cold pass, two warming passes, and three warm
passes: six passes total. A new browser context is created for each sample.
Within that context, later passes intentionally reuse the page, caches, and
runtime state. Between passes the harness resets the query without counting
the reset as a measured step.

`Step` declares the scripted interactions:

- `sort-price`: numeric sort of all rows.
- `sort-name`: dictionary-code sort.
- `search`: type the configured search term.
- `category`: apply a category facet.

The `empty` condition has no shop header or sidebar, so only the two sort steps
are run.

### Browser/page control

`ShopPage` represents one fresh browser context and page. Its constructor sets
a fixed viewport, installs the harness measurement script before page scripts,
opens a CDP session, enables performance metrics, optionally enables CPU
throttling, and starts tracing when requested.

`ShopPage.open()` navigates to the shop and waits for `window.__shop.ready`.
`prepare()` switches to the table view when the condition has shop chrome,
finds the injected probe's screen position, and lets the page settle. These
actions are setup, not measured query steps.

For each measured step, `ShopPage.run()`:

1. Records the current app query count and browser time, then takes a CDP
   metrics snapshot.
2. Uses stable `data-testid` selectors to click a sort or category control, or
   focus the search field and type with a 60 ms delay between keys.
3. For search, waits for its 250 ms debounce plus the configured probe delay.
   For other actions, waits for the probe delay.
4. Clicks a small injected probe element with no event handler. It represents
   another input arriving while the query is running.
5. Waits for the shop to report that a query has painted, takes another CDP
   snapshot, and gathers app and harness measurements.
6. Waits briefly for trailing rendering and other work to settle before the
   next step.

`reset()` restores the initial query between passes and waits for that result to
paint. It is not included in the measured rows.

### Independent browser observers

`harness-init.js` is injected before application code. It installs its own
`PerformanceObserver`s for long animation frames and Event Timing and adds the
fixed probe element. This provides a measurement source independent of the
shop's telemetry. The app's `window.__shop` hook is still used for query IDs,
scheduler decisions, and the query's paint timestamp.

`SUMMARY_JS`, evaluated in the page after the query paints, combines data from
the app with harness observer records. It calculates:

- the triggering interaction's duration and input delay, when Event Timing
  has an entry;
- the probe click's duration and input delay;
- long-animation-frame count, total blocking duration, maximum duration, and
  script duration within the query window.

For a direct sort or category click, `interactionMs` is the
interaction-oriented measure. Search is debounced, so its work begins after
the typing interaction; the probe click is more informative about whether the
page can respond while the debounced query runs. Event Timing has a 16 ms
minimum threshold and rounded durations, so a blank interaction or probe
measurement does not mean the duration was exactly zero.

### CDP and trace metrics

The CDP `Performance.getMetrics` snapshots provide main-thread heap usage and
task, script, layout, and style durations across the step. These are page/
renderer metrics: they do not directly expose the worker's heap. The dataset
is an `ArrayBuffer` and is external memory, so it is not necessarily reflected
in the JavaScript heap-used number.

With `--trace`, `ShopPage` asks Playwright to collect Chrome trace categories
that include V8 GC and user-timing marks. After the page closes tracing,
`TraceGc` parses the trace with Jackson's streaming parser. It finds query
start and painted marks, identifies the renderer process and thread names,
then sums the overlap of MinorGC/MajorGC events with each query window. GC is
reported separately for `CrRendererMain` and `DedicatedWorker` threads.
Trace collection is optional because it makes runs slower and creates large
files.

### Output files and data interpretation

Each run writes under `results/<runId>/`:

- `queries.csv`: one row per measured query.
- `run.json`: machine/browser/run metadata and the arguments.
- `errors.log`: failed samples, if any.
- `traces/`: one Chrome trace per sample when `--trace` is enabled.

`CsvSink` writes a fixed set of columns, escapes CSV values, formats numeric
values, and flushes after each sample. Columns are grouped around:

- run identity and conditions (`app`, `cond`, `strategy`, `match`, `data`,
  `throttle`, sample/pass/state, browser, commit);
- scheduler decisions and predictions;
- compute and worker timings;
- interaction, probe, and long-frame metrics;
- main-thread heap and task metrics;
- optional per-thread GC results.

Keep the timing concepts distinct:

- `computeToResultMs` is the app's time to receive a result.
- `mainBlockedMs` is time the operation blocked the main thread.
- `toPaintMs` is time until the result was painted.
- `interactionMs` and `probeMs` estimate user-visible input delay for different
  interactions.

Do not compare one of these directly against another as if they were the same
quantity. In particular, compare main-thread result time to worker result
time, and main-thread blocking to worker main-thread blocking.

## Other features added in the e-commerce shops PR

Beyond documentation, the merged PR adds an end-to-end React and Angular shop
experiment around the scheduler:

- **Two framework implementations:** React 19 with MUI, Zustand, and TanStack
  Table; Angular 22 with Material, NgRx SignalStore, RxJS, and TanStack Table.
  Both share the same framework-neutral catalog logic and scheduler core.
- **Comparable measured paths:** sorting/filtering runs inside the
  interaction-triggered store action in both implementations, avoiding a
  framework-specific effect between input and compute. Both also use manual
  table mode so TanStack does not create hundreds of thousands of row objects.
- **Shop conditions and harness hooks:** URL-controlled page conditions,
  deterministic seeded content, a `window.__shop` instrumentation API, reset
  support, per-query statistics, and stable `data-testid` selectors.
- **Token and prefix search:** a new inverted text index stored in typed arrays
  supports whole-token and prefix matching alongside substring scanning.
  Search-mode controls are available in both shops.
- **Java benchmark runner:** Playwright automation, CSV and run metadata
  output, optional CPU throttling, and optional per-thread GC attribution from
  Chrome traces.
- **Shop serving/build support:** scripts for shop installation/building and
  10k/100k datasets, plus CSP nonce support for the dynamically injected styles
  required by the UI libraries under strict CSP.

## Running the harness

From the repository root in PowerShell:

```powershell
npm run data
npm run shops:build
Set-Location harness
.\mvnw.cmd -q compile exec:java -Dexec.args="--apps react,angular --strategies main,worker --samples 5 --trace"
```

The harness assumes the requested data files and shop builds are already
available; it does not generate them. For a smaller initial run, use one app,
one strategy, one dataset, and one sample, then expand the matrix.
