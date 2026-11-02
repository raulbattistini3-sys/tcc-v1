# Adaptive main-thread vs worker scheduler

TCC prototype. A drop-in bundle collects runtime signals (Long Animation
Frames, Compute Pressure, memory, its own timings), learns a per-device cost
model, and decides per table operation whether to run on the main thread or
in a Web Worker. A WebExtension collects the same telemetry from outside the
page. Plain JavaScript with JSDoc, type-checked by `tsc --checkJs`; no build step.

## Quick start

```sh
npm install          # only typescript + @types/chrome, for `npm run check`
npm run data         # compact.zip → data/produtos.bin (600k rows, ~20 s)
npm run serve        # http://localhost:5173/
```

| Command | What it does |
|---|---|
| `npm run data` | Converts `additional-scripts/pgcopy/export/compact.zip` to the columnar file |
| `npm run data:small` | Same, first 50k rows only, to `data/produtos-50k.bin` (open `/?data=/data/produtos-50k.bin`) |
| `npm run serve` | Dev server, no CSP |
| `npm run serve:strict` | `worker-src 'self'`, no inline script or style |
| `npm run serve:no-worker` | `worker-src 'none'`: the worker is blocked, the scheduler falls back to main |
| `npm run serve:coi` | COOP + COEP + strict CSP: SharedArrayBuffer path |
| `npm test` | Unit tests (format, compute vs. a naive reference, model, decision rule) |
| `npm run check` | Type-checks every `.js` file from its JSDoc |
| `node tools/bench-node.mjs` | Rough `runOp` timings outside the browser |

Load the extension: `chrome://extensions` → Developer mode → Load unpacked →
`extension/`. It listens on `localhost` / `127.0.0.1` only.

## Layout

```
src/
  types.js               shared JSDoc typedefs
  data/columnar.js       TCC1 binary format: read (zero-copy views) and write
  compute/compute.js     runOp(): the one pure filter+sort both threads run
  worker/                protocol, worker entry, page-side client (reqId, stale replies, timing)
  model/cost-model.js    EWMA cost model
  scheduler/scheduler.js strategies main | worker | fixed | adaptive
  telemetry/             bus + collectors + exporters (the Go agent's shape)
  index.js               start(): wires it all together
demo/                    virtual table, jank meter, load generator, benchmark → CSV
extension/               MV3: MAIN-world probe, ISOLATED bridge, service worker, popup
tools/                   converter, dev server, node benchmark
docs/design-notes.md     CSP, worlds, gateway/MITM, Go → JS mapping
```

## Data path

`dados.json` is 172 MB. `JSON.parse` takes ~1.9 s (Node, this machine) and the
result is ~600k JS objects. The converter turns `produtos` into typed arrays:

| Column | Storage |
|---|---|
| `valor_de_custo`, `valor_de_venda`, `icms`, `data_de_cadastro` | `Float64Array` (null → NaN, timestamps as epoch ms UTC) |
| `quantidade_em_estoque` | `Int32Array` (null → INT32_MIN) |
| `ativo` | `Uint8Array` |
| `name`, `sku`, `categoria`, `id` | `Int32Array` codes into a **sorted** UTF-8 dictionary |

`categoria` is joined from `categorias` at build time. Dictionaries are sorted
with `Intl.Collator("pt-BR", { numeric: true })`, so code order is collation
order: sorting by name compares integers, and strings are decoded only for
the ~20 visible rows. Result: one 77 MB `ArrayBuffer`, opened with no parsing,
handed to the worker whole (clone, share, or let the worker fetch it).

## Cost model and decision

```
T_main   = k_prep·D_main + k_scan·S + k_sort[c]·m·log2(m)·keys
T_worker = O + k_prep·D_worker + k_scan·S + k_sort[c]·m·log2(m)·keys
budget   = B · pressureFactor · (1 − min(0.8, mainBusy))
adaptive: main if T_main ≤ budget, else worker; ε-exploration, never exploring main beyond 2·budget
```

`D` counts strings a thread still has to decode (cold cache, paid once), `S`
rows scanned by filters, `m` the rows left after filtering (from learned
selectivity), `c` the comparator class (`num`, `code`, `locale`), `O` the
messaging cost. Each `k` is an EWMA of measured ms per unit, kept separately
per thread. `O` is learned only from runs that weren't queued behind another,
because while the worker computes it cannot receive the next message, so
backlog would otherwise look like fixed overhead.

## Benchmark CSV

The demo's "Run sweep" runs sizes 1k → 600k × the four strategies × N reps
and downloads one row per run with device, throttling, commit, load,
predicted vs. actual times, TBT (from LoAF), and the worker breakdown (post,
queue, reply). Set CPU throttling in DevTools → Performance and type it into
the Throttling field, since a page cannot detect it.
