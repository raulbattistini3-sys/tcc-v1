import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { input, select } from "@inquirer/prompts";
import { Site, type ScrapeUpload } from "@tcc/contracts";
import { SITE_CONFIGS, SITE_LIST } from "./sites/index.js";
import { MAX_PAGES, MIN_DELAY_MS, runSite } from "./scrape.js";

// pnpm scrape                          pick a store from a list, then how many pages
// pnpm scrape --site mercadolivre --pages 2 --post
//   --site      mercadolivre | magalu | shopee | shein | aliexpress
//   --pages     1..5 (default 1)
//   --url       another listing page on the same store
//   --headed    show the browser
//   --post      send the run to the server (TCC_SERVER_URL, TCC_TOKEN in .env)
// Always writes results/<site>/<timestamp>.json.

const { values } = parseArgs({
  options: {
    site: { type: "string" },
    pages: { type: "string" },
    url: { type: "string" },
    headed: { type: "boolean", default: false },
    post: { type: "boolean", default: false },
  },
});

const site = values.site
  ? Site.parse(values.site)
  : await select({
      message: "Loja",
      choices: SITE_LIST.map((s) => ({ name: s.label, value: s.id, description: s.startUrl })),
    });
const pages = Number(
  values.pages ??
    (values.site
      ? "1"
      : await input({ message: `Páginas (1-${MAX_PAGES})`, default: "1", validate: (v) => (/^[1-5]$/.test(v) ? true : `1 a ${MAX_PAGES}`) })),
);

const cfg = SITE_CONFIGS[site];
console.log(`${cfg.label}: up to ${pages} page(s), ${MIN_DELAY_MS / 1000}s+ apart, robots.txt checked per page`);
const upload = await runSite(cfg, { pages, headed: values.headed, startUrl: values.url, log: console.log });
const { run, listings } = upload;
console.log(`${run.status}: ${run.pagesFetched}/${run.pagesRequested} page(s), ${listings.length} listings${run.message ? ` — ${run.message}` : ""}`);

const dir = join("results", site);
await mkdir(dir, { recursive: true });
const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(file, JSON.stringify(upload, null, 1));
console.log(`saved ${file}`);

if (values.post) await post(upload);

async function post(body: ScrapeUpload) {
  const server = process.env.TCC_SERVER_URL ?? "http://localhost:8787";
  const token = process.env.TCC_TOKEN;
  if (!token) {
    console.error("--post needs TCC_TOKEN (the server's token) in .env");
    process.exitCode = 1;
    return;
  }
  const res = await fetch(`${server.replace(/\/$/, "")}/scrapes`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`server answered ${res.status}: ${(await res.text()).slice(0, 500)}`);
    process.exitCode = 1;
    return;
  }
  const { id } = (await res.json()) as { id: string };
  console.log(`stored as scrape run ${id}`);
}
