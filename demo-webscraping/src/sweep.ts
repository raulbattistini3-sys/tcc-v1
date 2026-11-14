// Sweep over the store list in demo-monorepo-workspace/apps/server/data/ecommerce-sites.json: one visit
// to each store's home page, with the same rules as the single-store scraper (robots.txt honored, a
// labeled user agent, stop at captchas and blocks, never work around them). Output is JSON Lines, one
// record per line, meant for ETL and for loading as tensors later (tf.data.csv / a line reader):
//
//   results/sweep/<runId>/sites.jsonl      one record per store: status, page shape, timings, counts
//   results/sweep/<runId>/products.jsonl   one record per product seen on a home page
//   results/sweep/<runId>/manifest.json    selection, options, counts, field list
//
//   pnpm sweep                         the first 200 stores (pt, then en; es left for later)
//   pnpm sweep --from 200 --count 100  the remaining 100
//   pnpm sweep --run <runId>           resume a run: stores already in sites.jsonl are skipped
//   pnpm sweep --run <runId> --retry-errors   visit again the stores that ended in "error"
//   pnpm sweep --workers 4 --headed
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { By, until, type WebDriver } from "selenium-webdriver";
import type chrome from "selenium-webdriver/chrome.js";
import { BOT_INFO, BOT_TOKEN, openChrome } from "./scrape.js";
import { blockReason } from "./normalize.js";
import { isAllowed, robotsFor } from "./robots.js";
import { genericProbeInPage, parseMoney, type GenericProbe } from "./generic.js";
import type { PageProbe } from "./extract.js";

type Locale = "pt" | "en" | "es";
type Store = { rank: number; name: string; url: string; country: string; kind: string; segment: string };
type Picked = Store & { locale: Locale; index: number };

const LANG: Record<Locale, string> = { pt: "pt-BR", en: "en-US", es: "es-ES" };
const SITE_TIMEOUT_MS = 75_000;
const MAX_CARDS = 60;

const { values } = parseArgs({
  options: {
    sites: { type: "string", default: "../demo-monorepo-workspace/apps/server/data/ecommerce-sites.json" },
    from: { type: "string", default: "0" },
    count: { type: "string", default: "200" },
    workers: { type: "string", default: "4" },
    run: { type: "string" },
    out: { type: "string", default: "results/sweep" },
    headed: { type: "boolean", default: false },
    "retry-errors": { type: "boolean", default: false },
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const list = JSON.parse(await readFile(values.sites!, "utf8")) as Record<Locale, Store[]>;
const all: Picked[] = (["pt", "en", "es"] as const).flatMap((locale) => list[locale].map((s) => ({ ...s, locale }))).map((s, index) => ({ ...s, index }));
const from = Number(values.from);
const picked = all.slice(from, from + Number(values.count));
const runId = values.run ?? new Date().toISOString().replace(/[:.]/g, "-");
const dir = resolve(values.out!, runId);
await mkdir(dir, { recursive: true });
const sitesFile = join(dir, "sites.jsonl");
const productsFile = join(dir, "products.jsonl");

const done = new Set<string>();
if (existsSync(sitesFile))
  for (const line of (await readFile(sitesFile, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as { url: string; status: string };
    if (values["retry-errors"] && r.status === "error") done.delete(r.url);
    else done.add(r.url);
  }
const queue = picked.filter((s) => !done.has(s.url));
console.log(`run ${runId}: ${picked.length} stores (#${from}–#${from + picked.length - 1}), ${done.size} already done, ${queue.length} to visit → ${dir}`);

const manifest = {
  v: 1,
  runId,
  tool: "selenium-webdriver (src/sweep.ts)",
  userAgentToken: BOT_INFO,
  source: values.sites,
  selection: { from, count: picked.length, order: "pt, en, es as listed", untouched: all.length - from - picked.length },
  startedAt: new Date().toISOString(),
  finishedAt: null as string | null,
  counts: {} as Record<string, number>,
  files: {
    "sites.jsonl": "one store per line: v, runId, index, locale, rank, name, url, country, kind, segment, status (ok|empty|blocked|disallowed|error), reason, finalUrl, title, pageLang, robots, crawlDelaySec, visitedAt, ms, cards, cardsBySource, pricedCards, medianPrice, currency, dom.{nodes,links,images,scripts,iframes,bytes}, timing.{ttfb,domContentLoaded,load,transferSize,resources,longTasks,longTaskMs}",
    "products.jsonl": "one product per line: v, runId, siteIndex, siteUrl, locale, country, kind, segment, position, title, url, price (number), currency, priceText, image, rating, reviews, source (jsonld|microdata|heuristic)",
  },
};
await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

// counts long tasks from the first byte on, for the main-thread pressure of each home page
const LONG_TASKS = `(() => { window.__tccLongTasks = 0; window.__tccLongTaskMs = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__tccLongTasks++; window.__tccLongTaskMs += e.duration; } }).observe({ type: "longtask", buffered: true }); } catch {} })();`;

async function browser(locale: Locale) {
  const { driver } = await openChrome(values.headed!, LANG[locale]);
  await (driver as chrome.Driver).sendDevToolsCommand("Page.addScriptToEvaluateOnNewDocument", { source: LONG_TASKS });
  await driver.manage().setTimeouts({ pageLoad: 45_000, script: 20_000 });
  return driver;
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1]! + s[m]!) / 2) * 100) / 100;
};

async function visit(driver: WebDriver, s: Picked) {
  const t0 = Date.now();
  const u = new URL(s.url);
  const base = { v: 1, runId, index: s.index, locale: s.locale, rank: s.rank, name: s.name, url: s.url, country: s.country, kind: s.kind, segment: s.segment, visitedAt: new Date().toISOString() };
  const robots = await robotsFor(u.origin, BOT_TOKEN, BOT_INFO);
  if (!isAllowed(robots, u.pathname + u.search)) {
    const reason = robots.status === "unreachable" ? "robots.txt unreachable" : `robots.txt disallows ${u.pathname}`;
    return { site: { ...base, status: "disallowed", reason, robots: robots.status, crawlDelaySec: robots.crawlDelaySec, ms: Date.now() - t0 }, products: [] };
  }
  await driver.manage().deleteAllCookies().catch(() => {});
  await driver.get(s.url);
  await driver.wait(until.elementLocated(By.css("body")), 20_000);
  await sleep(2500);
  for (let i = 1; i <= 4; i++) {
    await driver.executeScript(`window.scrollTo(0, document.body.scrollHeight * ${i / 4})`);
    await sleep(600);
  }
  const probe = await driver.executeScript<GenericProbe>(`const __name = (f) => f; const r = (${genericProbeInPage.toString()})(arguments[0]); r.timing.longTaskMs = Math.round(window.__tccLongTaskMs || 0); return r;`, MAX_CARDS);
  const blocked = blockReason(probe as unknown as PageProbe);
  const products = blocked
    ? []
    : probe.cards.map((c, i) => {
        const money = parseMoney(c.price ?? undefined, c.currency ?? undefined);
        return {
          v: 1, runId, siteIndex: s.index, siteUrl: s.url, locale: s.locale, country: s.country, kind: s.kind, segment: s.segment,
          position: i + 1, title: c.title, url: c.url ?? null, price: money.value ?? null, currency: money.currency ?? null,
          priceText: c.price ?? null, image: c.image ?? null, rating: c.rating ? Number(String(c.rating).replace(",", ".")) || null : null,
          reviews: c.reviews ? Number(String(c.reviews).replace(/\D/g, "")) || null : null, source: c.source,
        };
      });
  const prices = products.map((p) => p.price).filter((p): p is number => typeof p === "number" && p > 0);
  const bySource: Record<string, number> = {};
  for (const p of products) bySource[p.source] = (bySource[p.source] ?? 0) + 1;
  const currencies = products.map((p) => p.currency).filter(Boolean);
  return {
    site: {
      ...base,
      status: blocked ? "blocked" : products.length ? "ok" : "empty",
      reason: blocked ?? (products.length ? null : "no product cards found on the home page"),
      finalUrl: probe.url, title: probe.title.slice(0, 200), pageLang: probe.lang || null,
      robots: robots.status, crawlDelaySec: robots.crawlDelaySec, ms: Date.now() - t0,
      cards: products.length, cardsBySource: bySource, pricedCards: prices.length, medianPrice: median(prices) ?? null,
      currency: currencies.sort((a, b) => currencies.filter((x) => x === b).length - currencies.filter((x) => x === a).length)[0] ?? null,
      dom: probe.dom, timing: probe.timing,
    },
    products,
  };
}

const counts: Record<string, number> = {};
let next = 0;
let writes = Promise.resolve();
const write = (site: object, products: object[]) =>
  (writes = writes.then(async () => {
    if (products.length) await appendFile(productsFile, products.map((p) => JSON.stringify(p)).join("\n") + "\n");
    await appendFile(sitesFile, JSON.stringify(site) + "\n");
  }));

async function worker(id: number) {
  let driver: WebDriver | null = null;
  let locale: Locale | null = null;
  while (next < queue.length) {
    const s = queue[next++]!;
    try {
      if (!driver || locale !== s.locale) {
        await driver?.quit().catch(() => {});
        driver = await browser(s.locale);
        locale = s.locale;
      }
      const d = driver;
      const r = await Promise.race([visit(d, s), sleep(SITE_TIMEOUT_MS).then(() => Promise.reject(new Error(`site took over ${SITE_TIMEOUT_MS / 1000}s`)))]);
      await write(r.site, r.products);
      counts[r.site.status] = (counts[r.site.status] ?? 0) + 1;
      console.log(`[w${id}] #${s.index} ${s.locale} ${s.name}: ${r.site.status}${"cards" in r.site ? ` (${r.site.cards} products)` : ""}${r.site.reason ? ` - ${r.site.reason}` : ""}`);
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 300);
      await write({ v: 1, runId, index: s.index, locale: s.locale, rank: s.rank, name: s.name, url: s.url, country: s.country, kind: s.kind, segment: s.segment, visitedAt: new Date().toISOString(), status: "error", reason }, []);
      counts.error = (counts.error ?? 0) + 1;
      console.log(`[w${id}] #${s.index} ${s.locale} ${s.name}: error - ${reason}`);
      // a hung or crashed browser is replaced, not reused
      await driver?.quit().catch(() => {});
      driver = null;
    }
  }
  await driver?.quit().catch(() => {});
}

await Promise.all(Array.from({ length: Math.max(1, Number(values.workers)) }, (_, i) => worker(i + 1)));
await writes;
manifest.finishedAt = new Date().toISOString();
// a retried store has several lines; the last one wins, and the file is rewritten with one line per store
const latest = new Map<string, string>();
for (const l of (await readFile(sitesFile, "utf8")).split("\n").filter(Boolean)) latest.set((JSON.parse(l) as { url: string }).url, l);
await writeFile(sitesFile, [...latest.values()].join("\n") + "\n");
const lines = [...latest.values()].map((l) => JSON.parse(l) as { status: string; cards?: number });
manifest.counts = { stores: lines.length, products: lines.reduce((n, l) => n + (l.cards ?? 0), 0) };
for (const l of lines) manifest.counts[l.status] = (manifest.counts[l.status] ?? 0) + 1;
await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`done: ${JSON.stringify(manifest.counts)} (this session: ${JSON.stringify(counts)})`);
// selenium/chrome children sometimes keep the event loop alive
process.exit(0);
