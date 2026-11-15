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
    // since 0.4: one id per service-worker start and a counter of "stream" uploads within it, so the
    // server can tell a retry (same bootId + sequence, stored once) from a lost upload (a gap)
    bootId: z.string().max(64).optional(),
    sequence: z.number().int().nonnegative().optional(),
    timestamp: z.string().max(40).optional(),
    tabId: z.number().int().optional(),
    page: z.string().max(2048).optional(),
    batches: z.array(ExtensionBatch).optional(),
    events: z.array(TelemetryEvent).optional(),
  })
  .passthrough();
export type ExtensionUpload = z.infer<typeof ExtensionUpload>;

// ─── Host telemetry (POST /telemetry/host) ──────────────────────────────────────────────────────────
// What a Node service (sample-erp-api, this server itself) measures about itself, from the inside:
// memory and GC (runtime), event-loop delay and request/query durations (performance), and the
// service's states (lifecycle). Producers: packages/host-telemetry.
//
// - bootId: one per process start. A new bootId for the same instanceId is a restart.
// - sequence: 0, 1, 2... within a boot. A gap is a lost batch; the same number twice is a retry.
// - timestamp: wall clock (ISO), only to correlate with other sources. Every duration inside a
//   sample is measured with a monotonic clock (performance.now(), perf_hooks histograms), never by
//   subtracting two timestamps.
// - samples are aggregates over the interval since the previous batch (intervalMs), not one row per
//   request: the observability must not become the largest source of database load.

export const SAMPLE_CATEGORIES = ["runtime", "performance", "lifecycle", "other"] as const;
export type SampleCategory = (typeof SAMPLE_CATEGORIES)[number];

const bytes = z.number().finite().nonnegative();
const window = { intervalMs: ms.optional() };
const distribution = {
  count: z.number().int().nonnegative(),
  meanMs: ms,
  p50Ms: ms.optional(),
  p95Ms: ms.optional(),
  p99Ms: ms.optional(),
  maxMs: ms.optional(),
  sumMs: ms.optional(),
};

export const LIFECYCLE_STATES = ["started", "ready", "degraded", "recovered", "stopping", "restarted"] as const;

/** The sample types the server knows: checked field by field. Any other `type` passes with its fields as sent. */
export const KNOWN_SAMPLES = {
  // runtime
  "process.memory": z.object({
    type: z.literal("process.memory"),
    rssBytes: bytes,
    heapUsedBytes: bytes,
    heapTotalBytes: bytes.optional(),
    externalBytes: bytes.optional(),
    arrayBuffersBytes: bytes.optional(),
  }),
  // V8 heap per space, so a growing old space (a leak) can be told apart from a busy new space (churn)
  "process.heap": z.object({
    type: z.literal("process.heap"),
    heapSizeLimitBytes: bytes,
    mallocedBytes: bytes.optional(),
    detachedContexts: z.number().int().nonnegative().optional(),
    // libuv handles and requests keeping the loop alive (sockets, timers, fs requests...)
    activeResources: z.number().int().nonnegative().optional(),
    spaces: z.record(z.object({ usedBytes: bytes, sizeBytes: bytes })),
  }),
  gc: z.object({
    type: z.literal("gc"),
    ...window,
    count: z.number().int().nonnegative(),
    totalMs: ms,
    maxMs: ms,
    // "major" | "minor" | "incremental" | "weakcb"
    byKind: z.record(z.object({ count: z.number().int().nonnegative(), totalMs: ms })).optional(),
  }),
  // performance
  "event-loop.delay": z.object({
    type: z.literal("event-loop.delay"),
    ...window,
    minMs: ms.optional(),
    meanMs: ms,
    p50Ms: ms.optional(),
    p95Ms: ms.optional(),
    p99Ms: ms,
    maxMs: ms.optional(),
    stddevMs: ms.optional(),
  }),
  "event-loop.utilization": z.object({
    type: z.literal("event-loop.utilization"),
    ...window,
    utilization: z.number().min(0).max(1),
    activeMs: ms.optional(),
    idleMs: ms.optional(),
  }),
  "http.request": z.object({
    type: z.literal("http.request"),
    ...window,
    method: z.string().max(16),
    route: z.string().max(256),
    status: z.string().max(8), // "2xx", "4xx"...
    ...distribution,
    // mean of the Server-Timing parts of these requests: { db: 7.2, serialize: 1.1 }
    timings: z.record(ms).optional(),
  }),
  "db.query": z.object({
    type: z.literal("db.query"),
    ...window,
    name: z.string().max(128),
    ...distribution,
    errors: z.number().int().nonnegative().optional(),
  }),
  // a bounded cache (the Go read cache in front of the API / TCC server, or one inside a service)
  cache: z.object({
    type: z.literal("cache"),
    ...window,
    name: z.string().max(128),
    hits: z.number().int().nonnegative(),
    misses: z.number().int().nonnegative(),
    evictions: z.number().int().nonnegative().optional(),
    invalidations: z.number().int().nonnegative().optional(),
    entries: z.number().int().nonnegative().optional(),
    bytes: bytes.optional(),
    maxBytes: bytes.optional(),
  }),
  // lifecycle
  lifecycle: z.object({
    type: z.literal("lifecycle"),
    state: z.enum(LIFECYCLE_STATES),
    uptimeMs: ms.optional(),
    reason: z.string().max(512).optional(),
  }),
} as const;

const CATEGORY_OF: Record<string, SampleCategory> = {
  "process.memory": "runtime",
  "process.heap": "runtime",
  gc: "runtime",
  cache: "performance",
  "event-loop.delay": "performance",
  "event-loop.utilization": "performance",
  "http.request": "performance",
  "db.query": "performance",
  lifecycle: "lifecycle",
};

/** runtime, performance or lifecycle; a sample may say its own (`category`) when its type is unknown. */
export function sampleCategory(s: { type: string; category?: unknown }): SampleCategory {
  const known = CATEGORY_OF[s.type];
  if (known) return known;
  return SAMPLE_CATEGORIES.includes(s.category as SampleCategory) ? (s.category as SampleCategory) : "other";
}

export const TelemetrySample = z
  .object({ type: z.string().min(1).max(64), category: z.enum(SAMPLE_CATEGORIES).optional() })
  .passthrough()
  .superRefine((s, ctx) => {
    const schema = KNOWN_SAMPLES[s.type as keyof typeof KNOWN_SAMPLES];
    if (!schema) return;
    const r = schema.safeParse(s);
    if (!r.success) for (const issue of r.error.issues) ctx.addIssue(issue);
  });
export type TelemetrySample =
  | { [K in keyof typeof KNOWN_SAMPLES]: z.input<(typeof KNOWN_SAMPLES)[K]> }[keyof typeof KNOWN_SAMPLES]
  | ({ type: string; category?: SampleCategory } & Record<string, unknown>);

export const HostTelemetryEnvelope = z.object({
  version: z.literal(1),
  source: z.string().min(1).max(64), // the service: "sample-erp-api"
  instanceId: z.string().min(1).max(128), // the replica: "api-01"
  bootId: z.string().min(1).max(64),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime({ offset: true }),
  samples: z.array(TelemetrySample).max(5000),
});
export interface HostTelemetryEnvelope {
  version: 1;
  source: string;
  instanceId: string;
  bootId: string;
  sequence: number;
  timestamp: string;
  samples: TelemetrySample[];
}

// ─── App events (POST /telemetry/events) ────────────────────────────────────────────────────────────
// What an application measures about single operations, as they happen: the ERP's product search (which
// thread ran it, how long), the Empresa list loads, the product snapshot builds. Sent by the app's API,
// which also relays its web app's batches; replaces the ERP's TELEMETRY_DIR NDJSON files. Same batch
// identity as the host envelope ((source, instance, boot, sequence) once), so a resend is harmless.
// Timings and sizes only: `user` is an opaque hash, never an id or a name, and `data` never holds rows
// or what was typed.

export const AppEvent = z.object({
  service: z.string().min(1).max(32), // who measured it: "web", "api"
  source: z.string().min(1).max(64), // the area: "products", "search", "transport", "api"
  type: z.string().min(1).max(64), // what: "engine-ready", "request", "product-snapshot"
  // the measuring clock (performance.now() of that page or process), for ordering within a batch
  ts: z.number().finite(),
  // wall clock when it happened or arrived
  at: z.string().datetime({ offset: true }),
  user: z.string().max(64).optional(),
  data: z.record(z.string(), z.unknown()),
});
export type AppEvent = z.infer<typeof AppEvent>;

export const AppEventBatch = z.object({
  version: z.literal(1),
  source: z.string().min(1).max(64),
  instanceId: z.string().min(1).max(128),
  bootId: z.string().min(1).max(64),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime({ offset: true }),
  events: z.array(AppEvent).min(1).max(1000),
});
export type AppEventBatch = z.infer<typeof AppEventBatch>;

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
