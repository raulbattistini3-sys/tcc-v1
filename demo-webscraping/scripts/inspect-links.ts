// Diagnostic for outdated selectors: loads one listing page (robots.txt checked, same labeled browser
// as the scraper) and prints how its links are shaped, to fix productLink/card in src/sites/index.ts.
//   pnpm tsx scripts/inspect-links.ts aliexpress
import { Builder, Browser } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { Site } from "@tcc/contracts";
import { SITE_CONFIGS } from "../src/sites/index.js";
import { BOT_INFO, BOT_TOKEN } from "../src/scrape.js";
import { isAllowed, robotsFor } from "../src/robots.js";

const cfg = SITE_CONFIGS[Site.parse(process.argv[2])];
const u = new URL(cfg.startUrl);
if (!isAllowed(await robotsFor(u.origin, BOT_TOKEN, BOT_INFO), u.pathname + u.search)) throw new Error("robots.txt disallows it");

const opts = new chrome.Options();
opts.addArguments("--headless=new", "--window-size=1366,900", "--lang=pt-BR");
opts.setPageLoadStrategy("eager");
const driver = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(opts).build();
try {
  const ua = (await driver.executeScript<string>("return navigator.userAgent")).replace("HeadlessChrome", "Chrome");
  await (driver as chrome.Driver).sendDevToolsCommand("Network.setUserAgentOverride", { userAgent: `${ua} ${BOT_INFO}` });
  await driver.get(cfg.startUrl);
  await new Promise((r) => setTimeout(r, 10_000));
  for (let i = 1; i <= 4; i++) {
    await driver.executeScript(`window.scrollTo(0, document.body.scrollHeight * ${i / 4})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  const report = await driver.executeScript<{ url: string; title: string; anchors: number; shapes: [string, number][]; samples: string[]; text: string }>(`
    const hrefs = Array.from(document.querySelectorAll("a[href]")).map(a => a.href);
    const shape = h => { try { const u = new URL(h); return u.hostname + u.pathname.replace(/\\d{4,}/g, "<n>").replace(/\\/[^/]{30,}/g, "/<slug>"); } catch { return "?"; } };
    const counts = {};
    for (const h of hrefs) counts[shape(h)] = (counts[shape(h)] || 0) + 1;
    return { url: location.href, title: document.title, anchors: hrefs.length,
      shapes: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15),
      samples: hrefs.filter(h => /\\d{6,}/.test(h)).slice(0, 5),
      text: (document.body.innerText || "").slice(0, 300) };
  `);
  console.log(JSON.stringify(report, null, 1));
} finally {
  await driver.quit();
}
