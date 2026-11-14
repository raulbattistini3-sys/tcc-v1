// The catalog: every distinct product the scrapes have seen, one row each, in the same Postgres as
// demo-monorepo-workspace (same dialect and column conventions as apps/server/src/db/schema.ts).
//
// scrape_runs / scraped_listings (the server's) are per run: the same product seen in five runs is five
// rows. catalog_items is append-only by identity: a run that sees products a, b and c, after earlier runs
// already saw a and b, adds one row (c). a and b only get their last_seen_at / last_price moved forward.
// Identity is (site, item_key), see src/reader.ts listingKey().
//
// Migrations: drizzle/ here, tracked in their own table (drizzle.catalog_migrations), so they never
// interfere with the server's.

import { sql } from "drizzle-orm";
import { bigserial, boolean, index, integer, jsonb, numeric, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" }); // R$ 19,90 stays 19.90
const at = (name: string) => timestamp(name, { withTimezone: true });

export const catalogItems = pgTable(
  "catalog_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    site: text("site").notNull(),
    // "id:<store id>" | "url:<host/path>" | "title:<normalized title>"
    itemKey: text("item_key").notNull(),

    // as first seen (an item is never rewritten by later runs, except the last_* columns)
    externalId: text("external_id"),
    title: text("title").notNull(),
    url: text("url"),
    price: money("price"),
    originalPrice: money("original_price"),
    currency: text("currency").notNull().default("BRL"),
    installments: text("installments"),
    rating: real("rating"),
    reviewCount: integer("review_count"),
    seller: text("seller"),
    freeShipping: boolean("free_shipping"),
    imageUrl: text("image_url"),
    category: text("category"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),

    // where it came from: the results file and the run's start, the first and the latest time
    firstSeenAt: at("first_seen_at").notNull(),
    firstFile: text("first_file").notNull(),
    lastSeenAt: at("last_seen_at").notNull(),
    lastPrice: money("last_price"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("catalog_items_site_key_uq").on(t.site, t.itemKey), index("catalog_items_site_seen_idx").on(t.site, t.firstSeenAt)],
);

export type CatalogItem = typeof catalogItems.$inferSelect;
export type NewCatalogItem = typeof catalogItems.$inferInsert;
