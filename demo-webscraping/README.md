# demo-webscraping

Reads product **listing pages** (category grids, not search) of five Brazilian stores with Selenium and
a real Chrome, and stores what it finds through `demo-monorepo-workspace`'s server (`POST /scrapes`).
The goal is the *shape* of real catalogs for the thesis: titles, price ranges, how many products a
page holds, how often stores refuse automation. It is not meant for bulk collection.

```sh
pnpm install
cp .env.example .env            # TCC_SERVER_URL and TCC_TOKEN, only needed for --post
pnpm scrape                     # pick a store from a list, then how many pages
pnpm scrape --site shein --pages 2 --post
pnpm test                       # parsers, robots.txt rules, block detection
pnpm tsx scripts/inspect-links.ts aliexpress   # how a page's links look, to fix selectors
```

| Flag | |
|---|---|
| `--site` | `mercadolivre`, `magalu`, `shopee`, `shein`, `aliexpress` (asked when missing) |
| `--pages` | 1–5, default 1 |
| `--url` | another listing page on the same store |
| `--headed` | show the browser window |
| `--post` | send the run to the server |
| `--upload <file or dir>` | send saved runs instead of scraping (repeatable); `--force` resends |

Every run is saved to `results/<site>/<timestamp>.json` (git-ignored) **before** anything is sent, and a
sent run gets a `<timestamp>.uploaded.json` next to it with the server's answer. A failed `--post`
(server down, wrong token) therefore costs no extra requests to the store:

```sh
pnpm scrape --upload results     # every saved run that has no .uploaded.json yet
```

If the server is up but its database isn't, the server keeps the run on its disk (answer 202) and
`pnpm spool:replay` in `demo-monorepo-workspace` stores it later. Runs saved by older versions with
`null` fields are accepted (the nulls are dropped).

## The catalog: every product seen, once

`pnpm catalog` reads the saved runs in `results/` and appends to `catalog_items`, in the same Postgres as
`demo-monorepo-workspace` (a Drizzle table in `src/db/schema.ts`, same conventions as the server's).
The server's `scraped_listings` keeps one row per listing per run. The catalog keeps **one row per
product**: if earlier runs saw a and b and a new run sees a, b and c, only c is added. a and b only get
`last_seen_at` / `last_price` moved forward. Running it again over the same files adds nothing.

```sh
pnpm db:migrate              # once: creates catalog_items (tracked in drizzle.catalog_migrations)
pnpm catalog                 # results/ → catalog_items
pnpm catalog results/shein   # a folder or files
pnpm catalog --dry-run       # parse and count, no database
```

A product's identity (`item_key`, unique per site) is the store's id, else the URL without its query
string, else the normalized title. Price is never part of it. The columns hold the first sighting's
values, plus `first_file`, `first_seen_at`, `last_seen_at` and `last_price`. The database settings come from
this project's `.env` (`DATABASE_URL`, `DATABASE_SSL`, `DATABASE_CA_CERT`, `DATABASE_MIGRATION_URL`)
or, when that has no `DATABASE_URL`, from `../demo-monorepo-workspace/apps/server/.env`.

| File | |
|---|---|
| `src/reader.ts` | `results/` → validated runs → `catalog_items` rows; identity (`listingKey`). No database |
| `src/db/schema.ts` | the `catalog_items` entity |
| `src/db/append.ts` | insert new items, move `last_*` on known ones, in one transaction |
| `src/catalog.ts` | the CLI |

## How it behaves

- **robots.txt first**, per RFC 9309, before every URL. It uses its own group if there is one, `*`
  otherwise, and the longest rule wins. An unreachable robots.txt means nothing is fetched.
- **One page at a time, at least 5 s apart,** longer when robots.txt sets a `Crawl-delay`. At most 5
  pages per run.
- **An honest user agent:** Chrome's own, plus `tcc-research-bot/0.1 (+repo URL)`. Each run uses a fresh
  profile with no cookies and no login.
- **It stops at the first captcha, login wall, verification redirect or block page,** and records the run
  as `blocked`. It does not solve, hide from or work around any of them. A blocked run is a data point,
  not a bug.

## What the stores did (Nov 8, 2026, headless Chrome, one page each)

| Store | Result |
|---|---|
| Mercado Livre | **blocked**: redirected to `/gz/account-verification` |
| Magalu | **blocked**: "Não é possível acessar a página" (its robots.txt also answers 403 to crawlers) |
| Shopee | **blocked**: redirected to `/verify/traffic/error` |
| Shein | **ok**: 20 listings from the dresses category, with prices, ids and images |
| AliExpress | **no grid**: category pages are landing pages linking to search results (`/w/wholesale-…`), out of scope for listing-only collection |

These stores' terms restrict automated collection. Keep samples small, don't republish the raw
records, and cite a public dataset for anything large (e.g. Olist's Brazilian e-commerce dataset).
Mercado Livre's developer API (app token) is the sanctioned route for more than a sample. See
`docs/next-steps-ml-and-data.md` §7.

## When a store changes its markup

A run that comes back `ok` with 0 listings means the card selectors in `src/sites/index.ts` no longer
match.

1. Run `scripts/inspect-links.ts <site>` to see how product links look now.
2. Update `productLink` / `card` / field selectors in `src/sites/index.ts`.

The extractor (`src/extract.ts`) only collects strings in the page. Parsing (Brazilian prices
"R$ 1.299,90", ratings, counts) is in `src/normalize.ts` and covered by `pnpm test`.

## Sweep: many stores, one visit each

`pnpm sweep` visits the home page of each store in
`../demo-monorepo-workspace/apps/server/data/ecommerce-sites.json` (pt, en, es lists, 100 each, in that
order). It follows the same rules as `pnpm scrape`: robots.txt honored, the same labeled user agent,
and it stops at captchas, login walls and blocks without working around them. The 5 stores in
`src/sites/` have hand-written selectors, but these don't, so products come from what stores publish for
search engines (JSON-LD `Product`/`ItemList`, schema.org microdata), and otherwise from a link + image
+ price-looking text in one small box (`src/generic.ts`). Chrome uses the list's language (pt-BR,
en-US, es-ES).

```sh
pnpm sweep                               # stores #0–#199 (pt + en); es is left for later
pnpm sweep --from 200 --count 100        # the other 100
pnpm sweep --run <runId>                 # resume: stores already in sites.jsonl are skipped
pnpm sweep --workers 4 --headed
```

Output, one JSON object per line (JSON Lines), in `results/sweep/<runId>/` (git-ignored):

| File | One line per | Fields |
|---|---|---|
| `sites.jsonl` | store | `status` (ok, empty, blocked, disallowed, error), `reason`, `finalUrl`, `title`, `pageLang`, `robots`, `ms`, `cards`, `cardsBySource`, `pricedCards`, `medianPrice`, `currency`, `dom.{nodes,links,images,scripts,iframes,bytes}`, `timing.{ttfb,domContentLoaded,load,transferSize,resources,longTasks,longTaskMs}`, plus the list's `locale`, `rank`, `country`, `kind`, `segment` |
| `products.jsonl` | product on a home page | `siteIndex`, `siteUrl`, `locale`, `country`, `kind`, `segment`, `position`, `title`, `url`, `price` (number), `currency`, `priceText`, `image`, `rating`, `reviews`, `source` (jsonld, microdata, heuristic) |
| `manifest.json` | run | selection, user agent, counts, field list |

Missing values are `null` and every line has `v: 1`, so a line reader can map records straight to
feature arrays (TensorFlow.js: `tf.data.generator` over the lines, or pick numeric fields into a
`tf.tensor2d`). The heuristic source also catches promo tiles ("Menos de R$100"). Filter on `source` or
`price` when only real products matter.
