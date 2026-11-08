import { Builder, Browser, until, By, type WebDriver } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import type { ListingInput, ScrapeUpload } from "@tcc/contracts";
import type { SiteConfig } from "./sites/index.js";
import { extractInPage, type PageProbe } from "./extract.js";
import { blockReason, toListing } from "./normalize.js";
import { isAllowed, robotsFor } from "./robots.js";

// One run: robots.txt for each URL, then Chrome reads the listing pages one at a time, at least
// MIN_DELAY_MS apart (longer when robots.txt sets a Crawl-delay), and stops at the first captcha, login
// wall or block. Nothing here solves, hides from or works around those: a blocked run is recorded as such.

export const BOT_TOKEN = "tcc-research-bot";
export const BOT_INFO = `${BOT_TOKEN}/0.1 (+https://github.com/raulbattistini3-sys/tcc-v1; academic, listing pages only)`;
export const MIN_DELAY_MS = 5_000;
export const MAX_PAGES = 5;
const PAGE_TIMEOUT_MS = 30_000;

export type RunOptions = { pages: number; headed: boolean; startUrl?: string; log?: (msg: string) => void };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openChrome(headed: boolean): Promise<{ driver: WebDriver; userAgent: string }> {
  const opts = new chrome.Options();
  if (!headed) opts.addArguments("--headless=new");
  opts.addArguments("--window-size=1366,900", "--lang=pt-BR", "--no-first-run", "--disable-extensions");
  // return at DOMContentLoaded instead of waiting for every image and tracker; settle() then waits
  // for the product links themselves
  opts.setPageLoadStrategy("eager");
  // a fresh profile every run: no cookies, no logged-in session
  const driver = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(opts).build();
  // Chrome's own user agent with our token appended: a real browser, honestly labeled
  const base = (await driver.executeScript<string>("return navigator.userAgent")).replace("HeadlessChrome", "Chrome");
  const userAgent = `${base} ${BOT_INFO}`;
  await (driver as chrome.Driver).sendDevToolsCommand("Network.setUserAgentOverride", { userAgent, acceptLanguage: "pt-BR,pt;q=0.9" });
  return { driver, userAgent };
}

/** Lets client-rendered listings appear: waits for a product link, scrolls to load lazy cards. */
async function settle(driver: WebDriver, cfg: SiteConfig) {
  await driver.wait(until.elementLocated(By.css("body")), PAGE_TIMEOUT_MS);
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const n = await driver.executeScript<number>(
      `const re = new RegExp(arguments[0], "i"); return Array.from(document.querySelectorAll("a[href]")).filter(a => re.test(a.href)).length;`,
      cfg.productLink,
    );
    if (n >= 8) break;
    await sleep(800);
  }
  // scroll in a few steps, like a reader would, so lazy images and cards render
  for (let i = 1; i <= 4; i++) {
    await driver.executeScript(`window.scrollTo(0, document.body.scrollHeight * ${i / 4})`);
    await sleep(700);
  }
}

export async function runSite(cfg: SiteConfig, options: RunOptions): Promise<ScrapeUpload> {
  const log = options.log ?? (() => {});
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.floor(options.pages)));
  const startUrl = options.startUrl ?? cfg.startUrl;
  if (new URL(startUrl).hostname.split(".").slice(-3).join(".") !== new URL(cfg.startUrl).hostname.split(".").slice(-3).join(".")) {
    throw new Error(`--url must be on ${new URL(cfg.startUrl).hostname}`);
  }
  const startedAt = new Date();
  const listings: ListingInput[] = [];
  let fetched = 0;
  let status: ScrapeUpload["run"]["status"] = "ok";
  let message: string | undefined;
  let delayMs = MIN_DELAY_MS;
  let userAgent = BOT_INFO;
  const pagesMeta: { n: number; url: string; finalUrl?: string; title?: string; cards?: number; ms?: number }[] = [];

  let driver: WebDriver | null = null;
  try {
    for (let n = 1; n <= pages; n++) {
      const url = cfg.pageUrl(startUrl, n);
      const u = new URL(url);
      const robots = await robotsFor(u.origin, BOT_TOKEN, BOT_INFO);
      delayMs = Math.max(MIN_DELAY_MS, (robots.crawlDelaySec ?? 0) * 1000);
      if (!isAllowed(robots, u.pathname + u.search)) {
        status = fetched ? "partial" : "disallowed";
        message = robots.status === "unreachable" ? `robots.txt unreachable: not fetching ${u.origin}` : `robots.txt disallows ${u.pathname}${u.search}`;
        log(`  ${message}`);
        break;
      }
      if (!driver) ({ driver, userAgent } = await openChrome(options.headed));
      else await sleep(delayMs);

      log(`  page ${n}: ${url}`);
      const t0 = Date.now();
      await driver.manage().setTimeouts({ pageLoad: PAGE_TIMEOUT_MS });
      await driver.get(url);
      await settle(driver, cfg);
      const { pageUrl: _drop, ...serializable } = cfg;
      // tsx/esbuild wrap named functions in a __name() helper that doesn't exist in the page
      const probe = await driver.executeScript<PageProbe>(`const __name = (f) => f; return (${extractInPage.toString()})(arguments[0]);`, serializable);
      // WebDriver turns the page's undefined fields into null; listings leave missing fields out
      probe.cards = probe.cards.map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v != null)));
      pagesMeta.push({ n, url, finalUrl: probe.url, title: probe.title.slice(0, 200), cards: probe.cards.length, ms: Date.now() - t0 });

      const blocked = blockReason(probe);
      if (blocked) {
        status = fetched ? "partial" : "blocked";
        message = blocked;
        log(`  stopped: ${blocked}`);
        break;
      }
      fetched++;
      let position = 0;
      for (const raw of probe.cards) {
        const l = toListing(cfg, raw, n, position + 1);
        if (l) {
          listings.push(l);
          position++;
        }
      }
      log(`  ${position} listings`);
      if (position === 0) {
        message = `page ${n} had no product cards (the selectors in src/sites/index.ts may be outdated)`;
        break;
      }
    }
  } catch (err) {
    status = fetched ? "partial" : "error";
    message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    log(`  error: ${message}`);
  } finally {
    await driver?.quit().catch(() => {});
  }

  return {
    run: {
      site: cfg.id,
      startUrl,
      status,
      startedAt,
      finishedAt: new Date(),
      pagesRequested: pages,
      pagesFetched: fetched,
      userAgent,
      delayMs,
      message,
      meta: { pages: pagesMeta, tool: "selenium-webdriver", headless: !options.headed },
    },
    listings,
  };
}
