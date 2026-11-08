# Findings from the Sample ERP integration (Nov 8, 2026)

The core (`src/`) was carried into the Sample ERP (`sample-ERP/pkg/tablecore`, PR 40) and runs its
product list: 600,035 real products in Postgres (Supabase), the first page from the server, then the
whole visible list as a TCC1 snapshot searched in the browser on the main thread or in a worker. This
is the first time the scheduler runs inside a real application rather than a lab page or a shop built
for the experiment. These are the numbers it produced.

## 1. Headline: cold run and second run, before and after

Measured by the author in the ERP's product list, Chrome, same machine, same data:

| | before | after | change |
|---|---|---|---|
| cold run (first search after the snapshot loads) | ~4 s | **~2.4 s** | −40% |
| second run (same kind of search, warm JIT and caches) | ~45 ms | **~24 ms** | −47% |

**What "after" contains.** The "after" build changed four things at once (sample-ERP commits
`154b6e1`, `ef4488a`, `6c6ee2d`). The table above measures the build, not the transport alone:

1. **Product list over a WebSocket** with protobuf frames (`?transport=socket`), instead of REST/JSON.
2. **The server answers while the worker warms up.** Before, a search typed during the worker's
   warm-up waited in the worker's queue behind the index build. That wait was most of the 4 s.
3. **SKU digit index and narrowing** in the core: `contains` on SKUs as number ranges (≈200 ms → 8–70 ms
   per keystroke on 600k SKUs), and each keystroke tests only the previous result's rows (<1 ms once a
   few characters are typed).
4. **Trigram indexes in Postgres** for the server's search. Only if migration 0021 was applied when
   measured; without them, a selective server search took 1–4.4 s.

**Attributing the gain to the socket needs an A/B on the same build.** The ERP keeps both transports, so
this is a URL change, not a rebuild:

```
/products?transport=rest     vs     /products?transport=socket
```

- Use a fresh page load (or a fresh profile) per sample, so each one is a cold run.
- Alternate the order (rest, socket, socket, rest, …).
- Run at least 20 per arm. Compare medians and p95.

Every request emits a telemetry event, appended to the API's `TELEMETRY_DIR/<date>.ndjson`:

```json
{ "source": "transport", "type": "request",
  "data": { "requested": "socket", "transport": "socket", "cold": true, "ms": 41.2,
            "connectMs": 18.7, "bytes": 9214, "rows": 30, "page": "first", "ok": true } }
```

`cold` is the first request of that transport in the page load. `connectMs` is the socket's own
handshake and authentication, which REST doesn't pay per request because the browser reuses its HTTP
connections. So the fair question for the text is whether the socket's first request (handshake
included) beats REST's first request, and by how much the later ones differ.

Behind the launcher's gateway the socket can't connect (the gateway doesn't forward WebSockets yet) and
falls back to REST. Those events carry `fallback: true`. Leave them out of the comparison.

## 2. The cold cost is index building, not JIT

Measured in Node (same V8 as Chrome) on the 600k real names and SKUs:

| stage | time |
|---|---|
| decode + lowercase 600k names | 243 ms |
| **build the name inverted index** (300k distinct terms, 2.28M postings, 18.5 MB) | **1,429 ms** |
| trigram (fuzzy) index | 64 ms |
| SKU digit index | ~200 ms |
| the same fuzzy search, second time | **6 ms** |

The second run of the same search takes 6 ms, so JIT warm-up is a small part of the cold run. The cold
run is the per-thread indexes being built on first use (`prepareMs` in the stats). For the thesis this
changes the framing of the "cold run" research question. The candidate remedies are about *where and
when indexes get built*:

- building them on the server and shipping them in the snapshot;
- keeping them in IndexedDB/OPFS between visits;
- or not waiting for them, the ERP's server fallback.

How fast the code first runs matters much less.

## 3. Scheduler behavior in a real app

- **Adaptive, but effectively "worker" while cold.** The cost model predicts the main thread's cold
  cost (`k_prep · strings to decode`), which is far over the 50 ms budget for 600k strings. So the first
  text searches go to the worker, which is still warming up and queues them. `coldFor(spec)` was added to
  the scheduler so the app can tell this case apart and answer elsewhere.
- **The predicted main vs worker times disagree a lot with what is measured** on the first searches.
  The model has few samples for the expensive ops by then. This matches the "adaptive demo
  discrepancies" noted in the sweeps. A model with features beyond `rows × filters` (see
  [next-steps-ml-and-data.md](next-steps-ml-and-data.md)) is the natural follow-up.
- **The narrowing changes the cost of an op without changing its spec.** The cost model now learns per row
  actually *tested* (`stats.tested`), not per row in the spec. Otherwise a narrowed run would look like
  a very fast machine and make later full runs look cheap.

## 4. Server side, for the "do we even need the client?" question

| query on 600k rows, Postgres 17 (Supabase) | without index | why |
|---|---|---|
| `sku ILIKE '%LT-00123%' ORDER BY name LIMIT 31` | 4.4 s | walks the (name, id) index until 31 matches |
| `name ~* '(^\|[^[:alnum:]])word'` (selective word) | 1.0–1.5 s | same walk |
| unselective queries (`%1%`) | <1 ms | nearly every row matches, the first page is found at once |

With GIN trigram indexes (migration 0021) the selective queries become index lookups. So "the server is
slow" was really "the server had no index for this query shape". A fair server baseline for the thesis
must have those indexes.

## 5. Where the code is

| What | Where (sample-ERP) |
|---|---|
| digit index, narrowing, `coldFor` | `pkg/tablecore/digit-index.js`, `compute.js`, `scheduler.js` |
| server fallback while warming up | `web/src/features/produtos/search/useLocalProducts.ts` |
| socket server / client / contract | `api/src/sockets/produtos.socket.ts`, `web/src/lib/productSocket.ts`, `proto/produtos/v1/busca.proto` |
| trigram indexes | `api/drizzle/0021_produtos_trgm_idx.sql` |
| SKU benchmark | `pkg/test/bench-sku-search.js` |
