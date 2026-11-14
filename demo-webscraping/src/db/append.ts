import { sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { catalogItems, type NewCatalogItem } from "./schema.js";

const CHUNK = 500; // ~22 columns × 500 rows, well under Postgres's 65,535 parameters

export type AppendResult = { added: NewCatalogItem[]; known: number };

/**
 * Appends the items the database doesn't have yet, in one transaction. An item that already exists
 * (same site and item_key) is not added again; it only gets last_seen_at and last_price moved forward,
 * and first_seen_at moved back if this file is older than what's stored. Running it twice over the same
 * files changes nothing.
 */
export async function appendItems(db: Db, items: NewCatalogItem[]): Promise<AppendResult> {
  const added: NewCatalogItem[] = [];
  let known = 0;
  await db.transaction(async (tx) => {
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      const rows = await tx
        .insert(catalogItems)
        .values(chunk)
        .onConflictDoUpdate({
          target: [catalogItems.site, catalogItems.itemKey],
          // every right-hand side reads the row as it was before this statement
          set: {
            firstSeenAt: sql`least(${catalogItems.firstSeenAt}, excluded.first_seen_at)`,
            lastSeenAt: sql`greatest(${catalogItems.lastSeenAt}, excluded.last_seen_at)`,
            lastPrice: sql`CASE WHEN excluded.last_seen_at >= ${catalogItems.lastSeenAt} THEN coalesce(excluded.last_price, ${catalogItems.lastPrice}) ELSE ${catalogItems.lastPrice} END`,
          },
        })
        // xmax = 0 only on a row this statement inserted; an updated row carries this transaction's id
        .returning({ site: catalogItems.site, itemKey: catalogItems.itemKey, inserted: sql<boolean>`(xmax = 0)` });
      const isNew = new Set(rows.filter((r) => r.inserted).map((r) => `${r.site}\u0000${r.itemKey}`));
      for (const item of chunk) {
        if (isNew.has(`${item.site}\u0000${item.itemKey}`)) added.push(item);
        else known++;
      }
    }
  });
  return { added, known };
}
