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

Every run is also saved to `results/<site>/<timestamp>.json` (git-ignored).

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
