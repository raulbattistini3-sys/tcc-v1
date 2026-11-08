# Next steps: data collection, sweeps and the learned scheduler

How to get from "telemetry exists" to "a trained model decides main vs worker", in the order the work
can be done. The storage side is implemented in `demo-monorepo-workspace/` (it replaces the Go
`log-listener/`), the real-site listings in `demo-webscraping/`, and the marketplace apps in
`apps/market-react` and `apps/market-angular`.

```
browser ──────────────────────────────────────────────────────────────▶ server ───────────▶ Postgres (Supabase, logs project)
  shops / markets / ERP:  window.__shop.queries, telemetry log            POST /sweeps        sweep_runs, sweep_results
  WebExtension:           LoAF, INP, pressure, scheduler decisions        POST /ingest        ingest_batches, telemetry_events
  demo-webscraping:       listing records from real stores               POST /scrapes       scrape_runs, scraped_listings
                                                                                │
                                                     export (CSV/Parquet) ◀─────┘
                                                                │
                                         trainer (TS, @tensorflow/tfjs-node) ──▶ weights.json ──▶ scheduler in the page
```

## 1. What to record, and what not to

**Unit of record: one query that reached the screen.** That's one row of `window.__shop.queries`, a
`PaintedQuery` (`apps/shared/harness.js`). Everything a model needs is in it, already joined by
`queryId`:

- the decision: target, reason, explored, predMainMs, predWorkerMs, budgetMs, mainBusy, pressure;
- the outcome: computeToResultMs, mainBlockedMs, toPaintMs, prepare/filter/sort split, worker post,
  queue and reply.

Store it in typed columns (`sweep_results`).

**Don't record per frame or per poll.** Your worry about "web polling the results is gonna take a large
amount of records over the same sample" is right. A page polled every second for a minute produces 60
copies of the same state. Push one row per finished query instead. Then summarize the frame-level
signals (LoAF, long tasks) into the row of the query whose window they fall in: total blocking time,
LoAF count, worst frame. Don't store them as separate rows.

**Raw batches are for debugging, not for training.** `ingest_batches.body` keeps the extension's
uploads verbatim, so nothing is lost while the schema settles. Expire them (e.g. delete batches older
than 30 days) once the typed tables cover what you need.

**Volume, so you can plan it.** One sweep is 8 dataset sizes × 4 strategies × 5 query kinds × 10 reps =
1,600 rows. Fifty sweeps across devices is 80k rows, small for Postgres. The raw telemetry is what
grows: about 1 kB per event, thousands per session. That's the other reason to expire it.

**Repeated samples over the same data are fine, and needed.** The variance between reps *is* the
measurement. What makes them useful is tagging: every row belongs to a `sweep_run` that records
everything constant during the sweep:

- app and framework;
- build commit;
- device (UA, cores, memory, GPU when exposed);
- CPU throttling factor;
- dataset (rows, bytes, file);
- page condition (`?cond=`), strategy;
- transport (rest/socket);
- cold or warm.

Without the run, a row can't be compared with any other.

## 2. Sweep design

| dimension | values | why |
|---|---|---|
| app | lab demo, shop, **market** (React, Angular, later Vue) | the page around the table is the main-thread competition |
| dataset size | 10k, 30k, 100k, 300k, 600k | the crossover point is the result |
| query kind | name contains / token / prefix, sort by price / name (code / locale), category + price filter | each is a different cost shape |
| strategy | main, worker, fixed, adaptive | adaptive vs the oracle (best of main/worker per query) |
| page condition | empty, layout, logged, full (+carousel, third-party) | main-thread load |
| CPU throttling | 1×, 4×, 6× (DevTools) | stands in for slower devices |
| cold/warm | first query after load vs later | cold = index build, warm = steady state |
| transport (ERP) | rest, socket | the A/B of [sample-erp-findings.md](sample-erp-findings.md) |

Randomize the order of the cells, so that thermal throttling and background noise don't line up with
one strategy. Use a fresh page per cold sample.

**Metric that answers "was adaptive right?"** Use *regret*: for each query, the time adaptive's choice
took minus the time the better target took on the same query, cell and rep. It's measured by running
main and worker back to back, which the harness's strategy dimension already does. Report regret's
median and p95, not just mean times.

## 3. The model

**What to predict.** Predict two regressions, `T_main` and `T_worker` (ms), from features known before
the op runs. Then decide with the existing rule (`main if T_main ≤ budget`). This keeps the model a
drop-in for `cost-model.js`, so the comparison is "learned vs EWMA", one variable.

**Features** (all available in `decide()` today):

- op shape: rows n, filters × kinds, sort keys × comparator class, cold strings per thread,
  estimated selectivity;
- device: `hardwareConcurrency`, `deviceMemory`, UA family;
- current load: `mainBusy`, pressure state, LoAF count in the last second;
- page condition.

**Labels:** `computeToResultMs` (and `mainBlockedMs` for main), per thread.

**Split by device and by time, not by row.** If one device's runs land in both train and test, the
model has memorized that device, and test results look better than they are. Hold out whole installs
(your 70/30 by install id), and train on earlier runs, test on later ones.

**Baselines to beat:** always-main, always-worker, `fixed` (50k-row threshold), and the current EWMA
model. If a small MLP can't beat the EWMA's regret, that's a legitimate result too.

**TensorFlow.js: train in Node, run without TF in the page.**

1. Train with `@tensorflow/tfjs-node` in TS (a `trainer` package in the monorepo, reading the exported
   CSV). Python/Keras + `tensorflowjs_converter` also works, but keeps everything in one language for
   the text.
2. **Don't load TF.js in the page to make the decision.** The predictor runs on every op, so it has to
   cost far less than the decision it's making:
   - TF.js is hundreds of kB;
   - its WebGL backend takes hundreds of ms to start;
   - even its CPU backend allocates per call.

   A 2-layer MLP is ~100 multiply-adds. Export the weights as JSON and evaluate them in plain JS (a few
   µs). Measuring that the predictor's own overhead stays under ~0.05 ms per decision is itself a
   paragraph in the text.
3. Online adaptation: keep the EWMA as a per-device correction on top of the model's prediction (the
   model gives the shape, the EWMA the device's scale). That's how the learned model survives a device
   it never saw.

**The LLM part comes after this.** It needs the model's outputs plus the sweep tables as context
("adaptive chose worker 80% of the time on 4× throttled devices with <30k rows; regret p95 12 ms;
suggest raising the budget"). That's prompting over the tables, not training an LLM from scratch, and
it can only start once the tables exist.

## 4. Postgres storage: typed columns vs jsonb

All of this targets Postgres only (as you decided: one SQL dialect keeps the comparison clean).

- **Typed columns for whatever you filter, group or aggregate on** (strategy, target, sizes, timings).
  `percentile_cont` over a `double precision` column is fast. The same over `(data->>'ms')::float` parses
  text on every row.
- **jsonb for the rest** (the raw event `data`, device details).
- **jsonb is not verbatim.** It drops whitespace and duplicate keys, reorders keys, and stores numbers as
  `numeric`. If exact bytes matter (auditing what the extension sent), keep the body as `text` too.
  `ingest_batches` stores both.
- **The JSON.parse caveat you mentioned is real, and on the Node side.** `JSON.parse` turns every number
  into a double, so integers above 2^53 and long decimals lose precision. Then `JSON.stringify(JSON.parse(x))` is
  not `x`, and a deep copy through JSON costs a full parse and print of the whole batch on the event
  loop. The server avoids both. It sends the raw request text to Postgres as a parameter and lets
  Postgres parse it (`$1::jsonb`). Node only parses it once to validate the envelope and count events.
- If you want "json vs jsonb vs typed columns" as a measured dimension of the thesis (insert rate,
  storage, query time), the server's tables already give you all three shapes of the same data.

## 5. Collecting from other people's browsers (the extension)

- **Opt-in per site** is already how the extension works. Keep it, and keep the upload off by default.
- **Collect timings, never content:** no URLs beyond the origin, no typed text, no DOM. The probe
  already records only performance entries. Say so on the options page.
- **LGPD:** a random install id isn't personal data by itself, but an IP address is. The server stores
  the IP; drop or truncate it (/24) if you collect from people other than yourself. A one-page consent
  text in the extension's options covers the ethics section of the thesis.

## 6. Frameworks and library matching

**Add Vue.** React, Angular and Vue are the three frameworks with real market share, and they're three
different reactivity models:

- React re-renders a component tree;
- Angular uses signals with zoneless change detection;
- Vue uses proxy-based fine-grained reactivity.

A result that holds on all three is about the browser, not about one framework. Svelte and Solid would
be nice-to-have, not needed.

**Keep each concern on the "same library, or the framework's own" rule:**

| concern | React | Angular | Vue (next) |
|---|---|---|---|
| UI kit, no runtime CSS-in-JS | MUI 9 + **Pigment CSS** (extracted at build) | Angular Material (Sass, compiled) | Vuetify (compiled Sass) |
| state | Zustand | NgRx SignalStore | Pinia |
| routing | React Router | @angular/router | vue-router |
| async streams | none needed (debounce in the store) | RxJS (`rxMethod`, `debounceTime`) | none needed |
| list virtualization | TanStack Virtual | TanStack Virtual | TanStack Virtual |
| table | TanStack Table (manual mode) | TanStack Table | TanStack Table |
| HTTP | `fetch` in `apps/shared` | same shared `fetch` | same |

On HTTP: axios (React) vs `HttpClient` (Angular) would be a library comparison, not a framework one.
All data access goes through shared plain-JS code (`apps/shared/catalog.js`), so it's the same code in
every app. Use `HttpClient` only if a page needs something only it gives (interceptors in an
Observable pipeline), and then use it for everything in Angular.

## 7. Real-site listings (demo-webscraping)

- Listing pages only, one request at a time, at least 5 s apart (more when `robots.txt` asks), robots.txt
  checked before every URL, an honest user agent. It **stops** at captchas, login walls and blocks. It
  does not solve or evade them.
- As of Nov 8, 2026, `robots.txt` lets an unnamed crawler read listing pages on all five stores:
  - Mercado Livre serves server-rendered listings, so it works best;
  - Magalu answered 403 even to the `robots.txt` request, so it blocks non-browser clients;
  - Shopee, Shein and AliExpress render client-side behind anti-bot checks, so expect `blocked` runs
    there. A `blocked` run is a data point (how often real stores refuse automation), not a bug to work
    around.
- Their terms of use restrict automated collection. For a thesis, collect small samples, don't
  republish the raw records, and use them for the *shape* of real catalogs (title lengths, price
  distributions, how many products a listing page holds). For a large real catalog, cite a public
  dataset instead, e.g. the Olist Brazilian e-commerce dataset (100k orders, CC BY-NC-SA).
- Mercado Livre also has a developer API. It needs an app token, but it's the sanctioned way to get
  more than a sample.
