# The two e-commerce shops (React and Angular)

These shops implement the two Nov 2, 2026 design docs, *Desenho dos experimentos em páginas reais* and
*Gerenciamento de estado e UI nos dois frameworks*. It is one fictional shop built twice, with the
product grid/table as one component among several, so the scheduler is measured on a page that is
already busy.

```
apps/
  shared/            framework-neutral, plain JS + JSDoc (same rules as src/)
    catalog.js       wraps start(): query → OpSpec, page decoding, recommendations
    conditions.js    ?cond=empty|layout|logged|full &tp=1 &carousel=1 &strategy= &cmp= &seed=
    harness.js       window.__shop + performance marks for the Playwright (Java) harness
    third-party.js   seeded "tag manager": parse at load, periodic long tasks, click handler
    columns.js       column metadata both TanStack adapters map to ColumnDef
    product-image.js deterministic SVG "photos" (data: URIs)
    styles/_tokens.scss, tokens.js   one set of design tokens for MUI and Angular Material
  shop-react/        React 19 + MUI 9 + Zustand 5 + Sass modules + TanStack Table 9 (Vite 8)
  shop-angular/      Angular 22 zoneless + Material 22 (M3) + NgRx SignalStore + RxJS + Sass + TanStack Table 9
```

Both shops import the same core (`src/`), and their worker entry is a one-line import of
`src/worker/worker.js`. The two worker bundles are the same 5.5 kB.

## Equivalence rules (what keeps it framework vs framework, not library vs library)

| Concern | React | Angular |
|---|---|---|
| One store per domain | `session`, `cart`, `catalog`, `ui` Zustand stores | `SessionStore`, `CartStore`, `CatalogStore`, `UiStore` SignalStores |
| Granular reads | selectors (`selectCount`, `s => s.result`) | `computed` / per-field signals |
| Search debounce | 250 ms timer in the store action | `rxMethod` + `debounceTime(250)` (no `distinctUntilChanged` on either side) |
| Cart persistence | `persist` → sessionStorage, whole state per change | `withHooks` effect → sessionStorage, whole state per change |
| Cross-store wiring | `useSessionStore.subscribe` in `main.jsx` | `effect` in `provideAppInitializer` |
| Table | `useTable`, fully manual (sorting, pagination) | `injectTable`, same options |
| Rows built per page | `useMemo(catalog.page(...))` | `computed(catalog.page(...))` |
| Card re-render guard | `React.memo` | `OnPush` + `track row.id` |
| Carousel | rAF loop writing `style.transform` via ref | same loop via `ElementRef`, outside the zone |
| "Painted" mark | `useEffect` on result → `markPainted` | `effect` → `afterNextRender` → `markPainted` |
| Bootstrap order | conditions → probe → catalog → stores → render → first query | same |

The design doc suggested Context for the session. Here the session is a Zustand store, like every
other domain, so a sign-in only re-renders the components that read `user`. Context is still wrong
for table state, as the doc says.

**TanStack runs in manual mode in both shops.** The scheduler filters and sorts 600k columnar rows.
TanStack holds sorting and pagination state and builds 48 row objects per page. Its own row models
would need 600k JS objects on the heap, which would make main and worker equally slow.
TanStack Table 9 also ships `experimental-worker-plugin` (`createTableWorker`). It would be a fair
extra baseline: the library's own worker offload compared with the adaptive scheduler.

## Running

```sh
npm run data                 # once: data/produtos.bin
npm run shops:install
npm run shops:build          # React → apps/shop-react/dist, Angular → dist/ and dist-zone/
npm run serve:strict         # http://localhost:5173/react/  /angular/  /angular-zone/
```

URLs take the conditions, e.g. `/angular/?cond=full&strategy=worker`. For development, `npm run
serve` (port 5173, serves /data) plus `npm --prefix apps/shop-react run dev` (5174) or
`npm --prefix apps/shop-angular start` (5175); both proxy `/data` to 5173.

## Findings while building

1. **The "602 ms vs 5 ms" cold filter.** The 602 ms is the cold run on the main thread; the 5 ms is
   main-thread *blocking* when the same run goes to the worker. It is not the worker's compute
   time. Measured in the shop (headless Chrome, `name contains "ssd"`, 600k rows):

   | target | prepareMs (decode + lowercase 600k names) | time to result | main blocked |
   |---|---|---|---|
   | main | 1528 | 1625 ms | 1625 ms |
   | worker | 1760 | 1866 ms | 0.2 ms |

   The worker does not warm anything during init (`workerInitMs` ≈ 0.3 ms, because opening the
   columnar file is lazy). It pays the same cold cost, off the main thread. So the sentence for the
   text is: *the worker hides cold start and GC from the user; it does not remove them, and time to
   result is the same or slightly worse.* The GC hypothesis still needs its own run (CDP heap /
   `V8.GC` trace events from the harness).
2. **Warm filter cost depends on the column, not only on n.** For `categoria` (10 distinct values),
   a warm filter is 5–9 ms at 600k. For `name contains`, every name is distinct, so the per-code
   memo doesn't help: 100–150 ms warm. Report the column's cardinality next to each filter result.
3. **The cost model's cold prior is too low.** The first cold search was predicted at ~365 ms and
   took ~1.8 s. The decision was still right (over budget → worker), but `k.prep` should be seeded
   from calibration on a dict column with many distinct values, not from priors.
4. **Strict CSP breaks both UI libraries in the same way.** MUI (emotion) and Angular both inject
   `<style>` elements, and `style-src 'self'` blocks them, so the page renders unstyled. The fix
   is a per-response nonce. `tools/serve.mjs` now generates one for every HTML response, adds it to
   `style-src`, and substitutes `__CSP_NONCE__`. Emotion reads it from `<meta name="csp-nonce">`
   (via `createCache({ nonce })`), and Angular reads it from `ngCspNonce` on the root element. No
   `'unsafe-inline'` is needed; `style=""` set through CSSOM (React `style`, Angular `[style.x]`,
   the carousel) is not affected.
5. **More CSP details:**
   - Angular needs `base-uri 'self'` (not `'none'`) for `<base href>`.
   - Angular's critical-CSS inlining adds an `onload` handler that `script-src 'self'` blocks, so
     it is turned off (`inlineCritical: false`).
   - `mat-icon` ligatures need the Google Fonts stylesheet, so Angular uses inline SVG icons, as
     MUI does.
   - No webfont is loaded in either shop.
6. **The zone.js build is not just zone.js.** It rejects top-level await (bootstrap is wrapped in
   `boot()` for both builds), and the builder downlevels native `async`/`await` so zone can track
   it, which also applies to the core's async code in that bundle. A zone vs zoneless difference
   includes both effects; say so in the text, or compare against a zoneless build with the same
   downlevelling.
7. **The first warm run differs by framework, but warm runs are equal.** The warm category filter
   (query 3) took 34–39 ms result / 51–62 ms to paint in React and in zoneless Angular, and
   105 ms / 121 ms in the zone build. That is one sample, so it is a hint for the zone experiment,
   not a result.

## Next steps (from the experiment design)

- **Java harness (Playwright for Java):**
  - New context per cold sample, loops for warming and warm.
  - Read `window.__shop.queries` and `__shop.log`, plus CDP `Performance.getMetrics` and
    tracing for GC.
  - The scripted interaction is: search → category → sort by price → page 2. The scratchpad
    puppeteer script `shop.mjs` is the JS prototype of it.
- **Optional JIT control:** `--js-flags=--max-opt=0` (or `--no-opt`).
- **Hydration condition:** needs a Next.js variant of the React shop. The SPA has no hydration step.
- **Main sweep:**
  - Both frameworks (plus `/angular-zone/` as the control).
  - 10k / 100k / 600k rows (`?data=/data/produtos-50k.bin`-style files).
  - Conditions `empty`, `logged`, `full`.
  - Cold and warm, numeric and SKU comparators, all four strategies.
- **Possible addition:** TanStack's `experimental-worker-plugin` as a fifth strategy.
