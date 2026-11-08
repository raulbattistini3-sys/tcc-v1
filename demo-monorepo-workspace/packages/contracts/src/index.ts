// What the server accepts. The server validates every body with these schemas, and the dashboard, the
// shops' uploaders and demo-webscraping build their requests from the same types.

import { z } from "zod";

const ms = z.number().finite().nonnegative();
const optionalMs = ms.nullable().optional();

// ─── WebExtension uploads (POST /ingest) ────────────────────────────────────────────────────────────
// The protocol of the old log-listener (Go) and tools/collector.mjs, unchanged, so the extension's
// Settings keep working: `Authorization: Bearer <token>`, body { v: 1, kind, ... }.

export const TelemetryEvent = z
  .object({
    source: z.string().min(1).max(64),
    type: z.string().min(1).max(64),
    ts: z.number().finite(),
    data: z.record(z.unknown()).default({}),
    world: z.string().max(16).optional(),
  })
  .passthrough();

export const ExtensionBatch = z
  .object({
    tabId: z.number().int().optional(),
    page: z.string().max(2048).optional(),
    world: z.string().max(16).optional(),
    timeOrigin: z.number().optional(),
    receivedAt: z.number().optional(),
    events: z.array(TelemetryEvent),
  })
  .passthrough();

export const ExtensionUpload = z
  .object({
    v: z.literal(1),
    kind: z.string().min(1).max(32), // "stream" | "snapshot" | "ping"
    installId: z.string().max(64).optional(),
    label: z.string().max(128).optional(),
    ext: z.string().max(32).optional(),
    ua: z.string().max(512).optional(),
    sentAt: z.number().optional(),
    tabId: z.number().int().optional(),
    page: z.string().max(2048).optional(),
    batches: z.array(ExtensionBatch).optional(),
    events: z.array(TelemetryEvent).optional(),
  })
  .passthrough();
export type ExtensionUpload = z.infer<typeof ExtensionUpload>;

// ─── Sweeps (POST /sweeps) ──────────────────────────────────────────────────────────────────────────
// A run is everything that stays constant while it runs; a result is one query that reached the screen
// (apps/shared/harness.js's PaintedQuery, plus the cell it belongs to).

export const Strategy = z.enum(["adaptive", "main", "worker", "fixed"]);
export const Target = z.enum(["main", "worker"]);

export const SweepRunInput = z.object({
  source: z.enum(["harness", "demo", "extension", "erp", "manual"]),
  app: z.enum(["lab", "shop", "market", "erp", "other"]),
  framework: z.enum(["react", "angular", "vue", "vanilla"]).optional(),
  buildCommit: z.string().max(64).optional(),
  userAgent: z.string().max(512).optional(),
  cores: z.number().int().positive().optional(),
  memoryGb: z.number().positive().optional(),
  // DevTools CPU throttling factor (1 = none); a page can't detect it, so the runner says it
  throttling: z.number().positive().default(1),
  datasetUrl: z.string().max(512).optional(),
  datasetRows: z.number().int().nonnegative().optional(),
  datasetBytes: z.number().int().nonnegative().optional(),
  condition: z.string().max(32).optional(),
  strategy: Strategy.optional(),
  transport: z.enum(["rest", "socket"]).optional(),
  notes: z.string().max(4000).optional(),
  meta: z.record(z.unknown()).default({}),
});
export type SweepRunInput = z.input<typeof SweepRunInput>;

export const SweepResultInput = z.object({
  rep: z.number().int().nonnegative().optional(),
  queryId: z.number().int().optional(),
  // what was asked: "name:contains", "sort:price", "filter:categoria+price", ...
  queryKind: z.string().max(64).optional(),
  // rows taking part (the dataset size of this cell)
  size: z.number().int().nonnegative().optional(),
  strategy: Strategy.optional(),
  target: Target,
  reason: z.string().max(64).optional(),
  explored: z.boolean().optional(),
  // first query after the page loaded (cold caches / JIT), as opposed to a warm one
  cold: z.boolean().optional(),
  total: z.number().int().nonnegative().optional(),
  computeToResultMs: ms,
  mainBlockedMs: ms,
  toPaintMs: optionalMs,
  prepareMs: optionalMs,
  prepared: z.number().int().nonnegative().optional(),
  filterMs: optionalMs,
  sortMs: optionalMs,
  sortClass: z.string().max(16).optional(),
  predMainMs: optionalMs,
  predWorkerMs: optionalMs,
  budgetMs: optionalMs,
  mainBusy: z.number().min(0).max(1).optional(),
  pressure: z.string().max(16).optional(),
  postMs: optionalMs,
  queueMs: optionalMs,
  replyMs: optionalMs,
  // frame-level signals summarized over the query's window, not stored per frame
  tbtMs: optionalMs,
  loafCount: z.number().int().nonnegative().optional(),
  transport: z.enum(["rest", "socket"]).optional(),
  extra: z.record(z.unknown()).default({}),
});
export type SweepResultInput = z.input<typeof SweepResultInput>;

export const SweepUpload = z.object({
  run: SweepRunInput,
  results: z.array(SweepResultInput).max(50_000),
});
export type SweepUpload = z.input<typeof SweepUpload>;

export const SweepResultsAppend = z.object({ results: z.array(SweepResultInput).min(1).max(50_000) });

// ─── Scraped listings (POST /scrapes) ───────────────────────────────────────────────────────────────

export const SITES = ["mercadolivre", "magalu", "shopee", "shein", "aliexpress"] as const;
export const Site = z.enum(SITES);
export type Site = z.infer<typeof Site>;

// ok: pages read. blocked: a captcha, login wall or 403 stopped it (never bypassed).
// disallowed: robots.txt forbids the URL. partial: some pages read, then blocked. error: anything else.
export const ScrapeStatus = z.enum(["ok", "partial", "blocked", "disallowed", "error"]);

export const ScrapeRunInput = z.object({
  site: Site,
  startUrl: z.string().url().max(2048),
  status: ScrapeStatus,
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date(),
  pagesRequested: z.number().int().nonnegative(),
  pagesFetched: z.number().int().nonnegative(),
  userAgent: z.string().max(512).optional(),
  delayMs: z.number().int().nonnegative(),
  message: z.string().max(4000).optional(),
  meta: z.record(z.unknown()).default({}),
});
export type ScrapeRunInput = z.input<typeof ScrapeRunInput>;

const money = z.number().finite().nonnegative().max(1e9);

export const ListingInput = z.object({
  externalId: z.string().max(128).optional(),
  title: z.string().min(1).max(1000),
  url: z.string().max(4096).optional(),
  price: money.optional(),
  originalPrice: money.optional(),
  currency: z.string().length(3).default("BRL"),
  installments: z.string().max(256).optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  seller: z.string().max(256).optional(),
  freeShipping: z.boolean().optional(),
  imageUrl: z.string().max(4096).optional(),
  category: z.string().max(256).optional(),
  page: z.number().int().positive(),
  position: z.number().int().positive(),
  raw: z.record(z.unknown()).default({}),
});
export type ListingInput = z.input<typeof ListingInput>;

export const ScrapeUpload = z.object({
  run: ScrapeRunInput,
  listings: z.array(ListingInput).max(20_000),
});
export type ScrapeUpload = z.input<typeof ScrapeUpload>;
