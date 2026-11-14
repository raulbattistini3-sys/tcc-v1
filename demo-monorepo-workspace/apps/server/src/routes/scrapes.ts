import express, { Router } from "express";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { ScrapeUpload, Site } from "@tcc/contracts";
import type { Db } from "../db/client.js";
import { scrapedListings, scrapeRuns } from "../db/schema.js";
import { storeScrape } from "../db/store.js";
import { handle, page } from "../lib/http.js";
import type { Spool } from "../lib/spool.js";
import { spoolThenStore } from "../lib/spooled.js";

// Scrape runs from demo-webscraping, with the listings they read. A run is stored even when it read
// nothing (blocked, disallowed): how often real stores refuse automation is a data point too. Uploads
// are kept on disk first (lib/spool.ts), so a database failure answers 202 instead of losing the run.

export function scrapeRoutes(db: Db, spool: Spool, auth: express.RequestHandler, readAuth: express.RequestHandler) {
  const r = Router();

  r.post(
    "/scrapes",
    auth,
    express.json({ limit: "25mb" }),
    handle((req, res) => spoolThenStore(spool, "scrapes", ScrapeUpload, req, res, () => storeScrape(db, req.body))),
  );

  r.get(
    "/scrapes",
    readAuth,
    handle(async (req, res) => {
      const { limit, offset } = page(req, 50, 500);
      const site = Site.safeParse(req.query.site);
      const rows = await db
        .select({
          id: scrapeRuns.id,
          createdAt: scrapeRuns.createdAt,
          site: scrapeRuns.site,
          startUrl: scrapeRuns.startUrl,
          status: scrapeRuns.status,
          pagesRequested: scrapeRuns.pagesRequested,
          pagesFetched: scrapeRuns.pagesFetched,
          delayMs: scrapeRuns.delayMs,
          message: scrapeRuns.message,
          // qualified by hand: drizzle prints bare column names here, and a bare "id" would be the listing's
          listings: sql<number>`(SELECT count(*)::int FROM scraped_listings l WHERE l.run_id = scrape_runs.id)`,
        })
        .from(scrapeRuns)
        .where(site.success ? eq(scrapeRuns.site, site.data) : undefined)
        .orderBy(desc(scrapeRuns.createdAt))
        .limit(limit)
        .offset(offset);
      res.json(rows);
    }),
  );

  // ?site= and/or ?runId=
  r.get(
    "/listings",
    readAuth,
    handle(async (req, res) => {
      const { limit, offset } = page(req, 100, 2000);
      const where: SQL[] = [];
      const site = Site.safeParse(req.query.site);
      if (site.success) where.push(eq(scrapedListings.site, site.data));
      if (typeof req.query.runId === "string" && /^[0-9a-f-]{36}$/i.test(req.query.runId)) where.push(eq(scrapedListings.runId, req.query.runId));
      const rows = await db
        .select()
        .from(scrapedListings)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(scrapedListings.scrapedAt), scrapedListings.page, scrapedListings.position)
        .limit(limit)
        .offset(offset);
      res.json(rows);
    }),
  );

  return r;
}
