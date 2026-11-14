# The marketplace apps (React and Angular)

`apps/shop-*` measure the scheduler on a page that is already busy. `apps/market-*` go one step further:
a marketplace-style storefront with several pages. On these, the main thread has real painting and
interaction work of its own (hero carousel, rails of image cards, routing, a virtualized grid of every
result), and the record loads are left to the worker. That is the question the thesis needs answered on
a realistic page: does delegating help when the main thread is busy for its own reasons? The old shops
are untouched, so their results stay reproducible as a baseline.

```
apps/
  shared/market.js          framework-neutral: derived card details (rating, list price, installments, free
                            shipping, all deterministic per row), banners, URL ⇄ query, the home/related
                            queries on their own scheduler channels, grid geometry
  shared/styles/_market.scss  every layout rule, as mixins both apps include
  market-react/             React 19 + MUI 7.3 via Pigment CSS + Zustand 5 + React Router 8 + TanStack Virtual + Sass modules (Vite 8)
  market-angular/           Angular 22 zoneless + Angular Material 22 (M3) + NgRx SignalStore + RxJS + Angular Router + TanStack Virtual + Sass
```

| Route | What's on it | Scheduler work |
|---|---|---|
| `/` | header + search, category strip, auto-rotating hero, "Ofertas do dia", "Recomendados" (moves every frame with `?carousel=1`/`cond=full`), category tiles, "Novidades" | two queries on their own channels (`home:deals`, `home:newest`), so they never make a listing result stale |
| `/lista?q=&cat=&min=&max=&estoque=1&ordem=` | filters, sort, result count with where it ran and how long, **every result in one window-virtualized grid** | the listing query (`catalog.run`, channel `catalog`), measured by the harness |
| `/produto/:index` | gallery, price block, quantity, buy, "Mais em <categoria>" | same-category query on channel `related` |
| `/carrinho` | lines, quantities, shipping rule, total | none |

Both apps take the shops' URL conditions (`?cond=`, `&strategy=`, `&match=`, `&data=`, …) and expose
the same `window.__shop` probe. Each listing result is marked painted exactly once, even when you come
back to the listing.

## Equivalence rules (on top of the shops')

| Concern | React | Angular |
|---|---|---|
| query runs | inside the store action the handler calls; the URL is written **after**, by the handler | same |
| URL → query | only on navigation (link, reload, back/forward), in an effect that does nothing when the store already matches | same |
| virtualization | `useWindowVirtualizer` (TanStack Virtual), rows of `--cols` cards, products decoded per visible row | `injectWindowVirtualizer`, same options and geometry (`GRID` in market.js) |
| card | MUI `Card` + `CardActionArea` (ripple) + `CardActions`, `React.memo` | `mat-card` + anchor with `matRipple` + `mat-card-actions`, `OnPush` |
| top bar, toast, sort select, cart badge | plain `<header>`, a live-region `<div>`, MUI `NativeSelect`, a `<span>` | plain `<header>`, a live-region `<div>`, `select[matNativeControl]`, a `<span>` |
| stars | five ★ clipped to the rating (shared mixins) | same |
| icons | `@mui/icons-material` (SVG) | inline SVG, same Material Symbols paths |
| carousel / rails autoplay | rAF writing `style.transform` via ref | same loop, outside the zone |
| routing | React Router 8, routes eager | Angular Router, routes eager |
| worker | `import "@core/worker/worker.js"` (7.35 kB) | the same file, same size |

**Styling: no runtime CSS-in-JS on either side.** MUI runs through Pigment CSS, which extracts every
component's styles into one static CSS file at build time; the bundle has no Emotion and no
`insertRule`. Angular Material compiles its Sass at build time too. One difference remains and belongs in
the text: Angular inserts each component's precompiled CSS as a `<style>` string when the component
first renders, while the Pigment build ships a single 57 kB stylesheet. Neither computes styles at run
time.

## Pigment CSS with MUI: what works (Nov 8, 2026)

You chose MUI without CSS-in-JS. Getting there took four findings, each reproducible in
`apps/market-react`:

1. **MUI 9.5 doesn't compile under Pigment** (Pigment 0.0.31, on both Vite 8 and Vite 6). Its evaluator
   rejects `ButtonBase/TouchRipple`: "This identifier cannot be used in the template, because it is a
   function parameter". ButtonBase is under almost every component.
2. **MUI 7.3.11 compiles** (MUI 6.4 does too), with no Emotion runtime in the bundle. Pigment development
   is on hold upstream, which is likely why MUI 9 broke it. MUI 7 still gets fixes.
3. **MUI 7's `Badge` doesn't compile** ("Cannot read properties of undefined (reading 'anchorOrigin')"),
   so the cart counter is a styled span in both apps.
4. **Elevated `Paper` crashes at run time.** MUI reads `theme.shadows[elevation]` while rendering, and
   Pigment's runtime theme doesn't carry it. That rules out `AppBar`, `Snackbar` and the popover behind
   `Select`/`Menu`. Outlined cards are fine. The apps use the plain equivalents listed above, in both
   frameworks, so the comparison stays equal.

## Running

```sh
npm run data                                  # once, at the repo root: data/produtos.bin
npm --prefix apps/market-react install
npm --prefix apps/market-angular install --legacy-peer-deps   # @angular/build's optional service-worker peer wants core 22.2.5
npm --prefix apps/market-react run build
npm --prefix apps/market-angular run build
npm run serve                                 # http://localhost:5173/market-react/ and /market-angular/
```

`tools/serve.mjs` mounts both builds next to the shops, behind the same headers and CSP options. Since
Pigment injects no styles at run time, market-react also runs under `--csp strict` without the nonce the
Emotion shop needs. Dev servers: `npm --prefix apps/market-react run dev` (5176) and
`npm --prefix apps/market-angular start` (5177), both proxying `/data` to 5173.

If port 5173 is taken (another Vite app), `node tools/serve.mjs --port 5180`.

## First smoke run (one sample, headless Chrome, `cond=full`, adaptive; not a benchmark)

The same flow in both apps: home → category → search "mouse" → scroll → product → buy → back.

| | React | Angular |
|---|---|---|
| home ready (catalog + worker + first paint) | 2.6 s | 2.9 s |
| category ELETRODOMÉSTICOS: 60,129 results | main thread, 6 ms; painted at 214 ms | main thread, 26 ms; painted at 544 ms |
| search "mouse" (cold, `contains`): 12,021 results | worker, 1.2 s | worker, 2.7 s |
| cards in the DOM after scrolling the grid | 21 | 21 |

Both apps returned the same rows, counts and cart totals. Real numbers need the harness: fresh pages, reps,
throttling, randomized order. The sweep plan is in
[next-steps-ml-and-data.md](next-steps-ml-and-data.md) §2.

## Next

- Teach the Java harness the market routes (`ShopPage` drives `/lista` the way it drives the shop's
  grid), and post its results to `demo-monorepo-workspace` (`POST /sweeps`, `app: "market"`).
- Vue, in its own commit: Vue 3 + Vuetify (compiled Sass) + Pinia + vue-router + TanStack Virtual, the
  same `market.js` and mixins.
