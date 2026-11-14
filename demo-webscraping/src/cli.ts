import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { input, select } from "@inquirer/prompts";
import { ScrapeUpload, Site } from "@tcc/contracts";
import { SITE_CONFIGS, SITE_LIST } from "./sites/index.js";
import { MAX_PAGES, MIN_DELAY_MS, runSite } from "./scrape.js";

// pnpm scrape                          pick a store from a list, then how many pages
// pnpm scrape --site mercadolivre --pages 2 --post
//   --site      mercadolivre | magalu | shopee | shein | aliexpress
//   --pages     1..5 (default 1)
//   --url       another listing page on the same store
//   --headed    show the browser
//   --post      send the run to the server (TCC_SERVER_URL, TCC_TOKEN in .env)
// Always writes results/<site>/<timestamp>.json, before any upload.
//
// pnpm scrape --upload results                       send every saved run not sent yet (no scraping)
// pnpm scrape --upload results/shein/<file>.json     just that one
//   --force     send again even if already sent
// A sent run gets a <file>.uploaded.json next to it with the server's answer; that's how "not sent yet"
// is decided, so a failed --post is retried from disk instead of hitting the store again.

const { values } = parseArgs({
  options: {
    site: { type: "string" },
    pages: { type: "string" },
    url: { type: "string" },
    headed: { type: "boolean", default: false },
    post: { type: "boolean", default: false },
    upload: { type: "string", multiple: true },
    force: { type: "boolean", default: false },
  },
});

if (values.upload) {
  await uploadSaved(values.upload);
  process.exit();
}

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

if (values.post) await post(file, upload);
else console.log(`not sent; to store it: pnpm scrape --upload ${file.replaceAll("\\", "/")}`);

/** Saved runs (files, or directories searched recursively) that have no .uploaded.json yet, oldest first. */
async function uploadSaved(paths: string[]) {
  const files: string[] = [];
  for (const p of paths) files.push(...(await runFiles(p)));
  const todo = values.force ? files : files.filter((f) => !existsSync(receiptOf(f)));
  console.log(`${files.length} saved run(s), ${todo.length} to send${values.force ? " (--force)" : ""}`);
  for (const f of todo.sort()) {
    let body: ScrapeUpload;
    try {
      body = JSON.parse(await readFile(f, "utf8")) as ScrapeUpload;
    } catch (err) {
      console.error(`${f}: not readable JSON (${(err as Error).message})`);
      process.exitCode = 1;
      continue;
    }
    console.log(`${f}: ${body.run?.site} ${body.run?.status}, ${body.listings?.length ?? 0} listings`);
    if (!(await post(f, body))) break; // the server is unreachable or refusing: the rest would fail too
  }
}

async function runFiles(p: string): Promise<string[]> {
  if (!(await stat(p).catch(() => null))?.isDirectory()) return p.endsWith(".json") && !p.endsWith(".uploaded.json") ? [p] : [];
  const out: string[] = [];
  for (const e of await readdir(p, { withFileTypes: true })) out.push(...(await runFiles(join(p, e.name))));
  return out;
}

function receiptOf(file: string) {
  return file.replace(/\.json$/, ".uploaded.json");
}

/** POST /scrapes. On success writes <file>.uploaded.json; returns false when the run wasn't accepted. */
async function post(file: string, body: ScrapeUpload): Promise<boolean> {
  const server = (process.env.TCC_SERVER_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  const token = process.env.TCC_TOKEN;
  const retry = `the run is saved in ${file}; retry with: pnpm scrape --upload ${file.replaceAll("\\", "/")}`;
  if (!token) {
    console.error(`no TCC_TOKEN (the server's token) in .env; ${retry}`);
    process.exitCode = 1;
    return false;
  }
  // runs saved by older versions have null for fields they didn't find; the contract's optional fields
  // mean absent, so drop the nulls rather than refuse the run
  const dropNulls = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;
  body = { ...body, run: dropNulls(body.run), listings: (body.listings ?? []).map(dropNulls) };
  const valid = ScrapeUpload.safeParse(body);
  if (!valid.success) {
    console.error(`${file} doesn't match the contract: ${JSON.stringify(valid.error.issues.slice(0, 3))}`);
    process.exitCode = 1;
    return true; // this file is the problem, not the server: carry on with the others
  }
  let res: Response;
  try {
    res = await fetch(`${server}/scrapes`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    console.error(`can't reach ${server} (${e.cause?.code ?? e.message}); ${retry}`);
    process.exitCode = 1;
    return false;
  }
  const text = await res.text();
  if (res.status !== 201 && res.status !== 202) {
    console.error(`server answered ${res.status}: ${text.slice(0, 500)}; ${retry}`);
    process.exitCode = 1;
    return res.status === 400; // a bad body is this file's problem; 401/5xx would fail for every file
  }
  const answer = JSON.parse(text) as { id?: string; listings?: number; spooled?: string };
  await writeFile(receiptOf(file), JSON.stringify({ server, at: new Date().toISOString(), status: res.status, ...answer }, null, 1));
  console.log(
    answer.id
      ? `stored as scrape run ${answer.id}`
      : `kept on the server's disk (${answer.spooled}), not in its database yet: run pnpm spool:replay in demo-monorepo-workspace`,
  );
  return true;
}
