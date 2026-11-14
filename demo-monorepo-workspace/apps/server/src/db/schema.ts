// Postgres schema. Rule of thumb: what you filter, group or aggregate on is a typed column (percentiles
// over a double precision column are fast; over `(data->>'ms')::float` they parse text on every row);
// everything else rides along as jsonb. See docs/next-steps-ml-and-data.md §4.

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const meta = () => jsonb("meta").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`);

// ─── WebExtension uploads ───────────────────────────────────────────────────────────────────────────

/** One POST /ingest, kept twice: as sent (body_text, byte for byte) and parsed (body, jsonb). */
export const ingestBatches = pgTable(
  "ingest_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    // LGPD: an IP is personal data; truncate or drop it when collecting from other people
    ip: text("ip"),
    kind: text("kind").notNull(),
    installId: text("install_id"),
    label: text("label"),
    extVersion: text("ext_version"),
    userAgent: text("user_agent"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    eventCount: integer("event_count").notNull(),
    // jsonb drops whitespace and duplicate keys and reorders keys; the text column is the exact upload
    bodyText: text("body_text").notNull(),
    body: jsonb("body").notNull(),
  },
  (t) => [index("ingest_batches_received_at_idx").on(t.receivedAt), index("ingest_batches_install_idx").on(t.installId)],
);

/** Every event of a batch, one row each, expanded by Postgres from the batch's jsonb. */
export const telemetryEvents = pgTable(
  "telemetry_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => ingestBatches.id, { onDelete: "cascade" }),
    installId: text("install_id"),
    tabId: integer("tab_id"),
    page: text("page"),
    world: text("world"),
    source: text("source").notNull(),
    type: text("type").notNull(),
    // the page's performance.now() clock; timeOrigin + ts is wall time
    ts: doublePrecision("ts"),
    timeOrigin: doublePrecision("time_origin"),
    data: jsonb("data").notNull(),
  },
  (t) => [index("telemetry_events_kind_idx").on(t.source, t.type), index("telemetry_events_batch_idx").on(t.batchId)],
);

// ─── Sweeps ─────────────────────────────────────────────────────────────────────────────────────────

/** Everything constant during one sweep; without it a result can't be compared with any other. */
export const sweepRuns = pgTable(
  "sweep_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: createdAt(),
    source: text("source").notNull(),
    app: text("app").notNull(),
    framework: text("framework"),
    buildCommit: text("build_commit"),
    userAgent: text("user_agent"),
    cores: integer("cores"),
    memoryGb: real("memory_gb"),
    throttling: real("throttling").notNull().default(1),
    datasetUrl: text("dataset_url"),
    datasetRows: integer("dataset_rows"),
    datasetBytes: bigint("dataset_bytes", { mode: "number" }),
    condition: text("condition"),
    strategy: text("strategy"),
    transport: text("transport"),
    notes: text("notes"),
    meta: meta(),
  },
  (t) => [index("sweep_runs_created_idx").on(t.createdAt), index("sweep_runs_app_idx").on(t.app, t.framework)],
);

/** One query that reached the screen: apps/shared/harness.js's PaintedQuery, plus its cell. */
export const sweepResults = pgTable(
  "sweep_results",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => sweepRuns.id, { onDelete: "cascade" }),
    rep: integer("rep"),
    queryId: integer("query_id"),
    queryKind: text("query_kind"),
    size: integer("size"),
    strategy: text("strategy"),
    target: text("target").notNull(),
    reason: text("reason"),
    explored: boolean("explored"),
    cold: boolean("cold"),
    total: integer("total"),
    computeToResultMs: doublePrecision("compute_to_result_ms").notNull(),
    mainBlockedMs: doublePrecision("main_blocked_ms").notNull(),
    toPaintMs: doublePrecision("to_paint_ms"),
    prepareMs: doublePrecision("prepare_ms"),
    prepared: integer("prepared"),
    filterMs: doublePrecision("filter_ms"),
    sortMs: doublePrecision("sort_ms"),
    sortClass: text("sort_class"),
    predMainMs: doublePrecision("pred_main_ms"),
    predWorkerMs: doublePrecision("pred_worker_ms"),
    budgetMs: doublePrecision("budget_ms"),
    mainBusy: doublePrecision("main_busy"),
    pressure: text("pressure"),
    postMs: doublePrecision("post_ms"),
    queueMs: doublePrecision("queue_ms"),
    replyMs: doublePrecision("reply_ms"),
    tbtMs: doublePrecision("tbt_ms"),
    loafCount: integer("loaf_count"),
    transport: text("transport"),
    extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("sweep_results_run_idx").on(t.runId), index("sweep_results_cell_idx").on(t.runId, t.strategy, t.size, t.queryKind)],
);

// ─── Scraped listings ───────────────────────────────────────────────────────────────────────────────

export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: createdAt(),
    site: text("site").notNull(),
    startUrl: text("start_url").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    pagesRequested: integer("pages_requested").notNull(),
    pagesFetched: integer("pages_fetched").notNull(),
    userAgent: text("user_agent"),
    delayMs: integer("delay_ms").notNull(),
    message: text("message"),
    meta: meta(),
  },
  (t) => [index("scrape_runs_site_idx").on(t.site, t.createdAt)],
);

export const scrapedListings = pgTable(
  "scraped_listings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => scrapeRuns.id, { onDelete: "cascade" }),
    site: text("site").notNull(),
    externalId: text("external_id"),
    title: text("title").notNull(),
    url: text("url"),
    // numeric, not float: R$ 19,90 stays 19.90
    price: numeric("price", { precision: 12, scale: 2, mode: "number" }),
    originalPrice: numeric("original_price", { precision: 12, scale: 2, mode: "number" }),
    currency: text("currency").notNull().default("BRL"),
    installments: text("installments"),
    rating: real("rating"),
    reviewCount: integer("review_count"),
    seller: text("seller"),
    freeShipping: boolean("free_shipping"),
    imageUrl: text("image_url"),
    category: text("category"),
    page: integer("page").notNull(),
    position: integer("position").notNull(),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull().defaultNow(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("scraped_listings_run_idx").on(t.runId), index("scraped_listings_site_idx").on(t.site, t.externalId)],
);
