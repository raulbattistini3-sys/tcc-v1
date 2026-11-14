import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { ScrapeUpload, type ListingInput } from "@tcc/contracts";
import type { NewCatalogItem } from "./db/schema.js";

// Reads the runs saved in results/ (results/<site>/<timestamp>.json, written by cli.ts) and turns their
// listings into catalog_items rows (src/db/schema.ts). No database here: src/catalog.ts stores them.
//
// How many records a file holds isn't known up front and doesn't matter: every listing gets an identity
// (listingKey), and identities already seen, in an earlier file or in the database, are not added again.

export type SavedRun = { file: string; upload: ReturnType<typeof ScrapeUpload.parse> };
export type Skipped = { file: string; why: string };

/** Every saved run under `dir` (recursively), validated, oldest run first. Bad files are reported, not thrown. */
export async function readResults(dir: string): Promise<{ runs: SavedRun[]; skipped: Skipped[] }> {
  const runs: SavedRun[] = [];
  const skipped: Skipped[] = [];
  for (const path of await jsonFiles(dir)) {
    const file = relative(process.cwd(), path).replaceAll("\\", "/");
    let body: unknown;
    try {
      body = JSON.parse(await readFile(path, "utf8"));
    } catch (err) {
      skipped.push({ file, why: `not JSON: ${(err as Error).message}` });
      continue;
    }
    const parsed = ScrapeUpload.safeParse(dropNulls(body));
    if (!parsed.success) {
      const i = parsed.error.issues[0]!;
      skipped.push({ file, why: `not a saved run: ${i.path.join(".")}: ${i.message}` });
      continue;
    }
    runs.push({ file, upload: parsed.data });
  }
  runs.sort((a, b) => a.upload.run.startedAt.getTime() - b.upload.run.startedAt.getTime() || a.file.localeCompare(b.file));
  return { runs, skipped };
}

async function jsonFiles(p: string): Promise<string[]> {
  const s = await stat(p).catch(() => null);
  if (!s) return [];
  if (!s.isDirectory()) return p.endsWith(".json") && !p.endsWith(".uploaded.json") ? [p] : [];
  const out: string[] = [];
  for (const e of await readdir(p, { withFileTypes: true })) out.push(...(await jsonFiles(join(p, e.name))));
  return out;
}

/** Older saved runs have null for fields they didn't find; the contract's optional fields mean absent. */
function dropNulls(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const b = body as { run?: object; listings?: object[] };
  const strip = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));
  return { ...b, ...(b.run ? { run: strip(b.run) } : {}), ...(Array.isArray(b.listings) ? { listings: b.listings.map(strip) } : {}) };
}

// ─── identity ───────────────────────────────────────────────────────────────────────────────────────

/**
 * What makes two listings the same product on one site, most reliable first:
 * the store's own id; else the product URL without query or fragment (tracking parameters change per
 * visit); else the title, lowercased with whitespace collapsed. Price is never part of it: the same
 * product at a new price is the same item.
 */
export function listingKey(l: Pick<ListingInput, "externalId" | "url" | "title">): string {
  const id = l.externalId?.trim();
  if (id) return `id:${id}`;
  if (l.url) {
    try {
      const u = new URL(l.url);
      return `url:${u.host.toLowerCase()}${decodeURI(u.pathname).replace(/\/+$/, "")}`;
    } catch {
      // not a URL: fall through to the title
    }
  }
  return `title:${l.title.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export const identity = (site: string, key: string) => `${site}\u0000${key}`;

// ─── rows ───────────────────────────────────────────────────────────────────────────────────────────

/** One catalog row per distinct item across `runs`: the first sighting's values, the latest sighting's time and price. */
export function toCatalogItems(runs: SavedRun[]): NewCatalogItem[] {
  const items = new Map<string, NewCatalogItem>();
  for (const { file, upload } of runs) {
    const seenAt = upload.run.startedAt;
    const site = upload.run.site;
    for (const l of upload.listings) {
      const itemKey = listingKey(l);
      const id = identity(site, itemKey);
      const known = items.get(id);
      if (!known) {
        items.set(id, {
          site,
          itemKey,
          externalId: l.externalId,
          title: l.title,
          url: l.url,
          price: l.price,
          originalPrice: l.originalPrice,
          currency: l.currency,
          installments: l.installments,
          rating: l.rating,
          reviewCount: l.reviewCount,
          seller: l.seller,
          freeShipping: l.freeShipping,
          imageUrl: l.imageUrl,
          category: l.category,
          raw: l.raw,
          firstSeenAt: seenAt,
          firstFile: file,
          lastSeenAt: seenAt,
          lastPrice: l.price,
        });
      } else if (seenAt >= known.lastSeenAt) {
        // seen again: only the "last" columns move (runs are sorted, so this is the latest so far)
        known.lastSeenAt = seenAt;
        if (l.price != null) known.lastPrice = l.price;
      }
    }
  }
  return [...items.values()];
}
