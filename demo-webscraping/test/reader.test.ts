import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listingKey, readResults, toCatalogItems, type SavedRun } from "../src/reader.js";

const run = (startedAt: string, listings: object[], site = "shein") => ({
  run: { site, startUrl: "https://br.shein.com/x.html", status: "ok", startedAt, finishedAt: startedAt, pagesRequested: 1, pagesFetched: 1, delayMs: 5000 },
  listings: listings.map((l, i) => ({ page: 1, position: i + 1, ...l })),
});

test("identity: store id, then URL without query, then normalized title; never the price", () => {
  assert.equal(listingKey({ externalId: " 42 ", title: "x" }), "id:42");
  assert.equal(listingKey({ url: "https://BR.shein.com/a-p-1.html?src=ad#top", title: "x" }), "url:br.shein.com/a-p-1.html");
  assert.equal(listingKey({ url: "https://br.shein.com/a-p-1.html/", title: "x" }), listingKey({ url: "https://br.shein.com/a-p-1.html?x=1", title: "y" }));
  assert.equal(listingKey({ url: "not a url", title: "  Vestido   AZUL " }), "title:vestido azul");
});

test("abc after ab: only c is new, and a, b only move their last sighting", () => {
  const parse = (r: ReturnType<typeof run>, file: string) =>
    ({ file, upload: { run: { ...r.run, startedAt: new Date(r.run.startedAt), finishedAt: new Date(r.run.finishedAt), meta: {} }, listings: r.listings.map((l) => ({ currency: "BRL", raw: {}, ...l })) } }) as unknown as SavedRun;
  const r1 = parse(run("2026-11-08T10:00:00Z", [{ externalId: "a", title: "A", price: 10 }, { externalId: "b", title: "B", price: 20 }]), "r1.json");
  const r2 = parse(run("2026-11-09T10:00:00Z", [{ externalId: "a", title: "A renamed", price: 9 }, { externalId: "b", title: "B" }, { externalId: "c", title: "C", price: 30 }]), "r2.json");
  // oldest first, as readResults returns them
  const items = toCatalogItems([r1, r2]);
  assert.deepEqual(items.map((i) => i.itemKey), ["id:a", "id:b", "id:c"]);
  const [a, b, c] = items;
  assert.equal(a!.title, "A", "first sighting's values are kept");
  assert.equal(a!.price, 10);
  assert.equal(a!.lastPrice, 9, "the latest price is tracked apart");
  assert.equal(a!.firstFile, "r1.json");
  assert.equal(a!.lastSeenAt?.toISOString(), "2026-11-09T10:00:00.000Z");
  assert.equal(b!.lastPrice, 20, "a sighting without a price keeps the last known one");
  assert.equal(c!.firstFile, "r2.json");
});

test("readResults: recursive, oldest run first, skips receipts and broken files, accepts older nulls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reader-"));
  await mkdir(join(dir, "shein"));
  await mkdir(join(dir, "magalu"));
  await writeFile(join(dir, "shein", "new.json"), JSON.stringify(run("2026-11-09T00:00:00Z", [{ externalId: "1", title: "T", seller: null }])));
  await writeFile(join(dir, "magalu", "old.json"), JSON.stringify(run("2026-11-01T00:00:00Z", [], "magalu")));
  await writeFile(join(dir, "shein", "new.uploaded.json"), JSON.stringify({ id: "x" }));
  await writeFile(join(dir, "shein", "broken.json"), "{");
  await writeFile(join(dir, "shein", "other.json"), JSON.stringify({ hello: 1 }));
  const { runs, skipped } = await readResults(dir);
  assert.deepEqual(runs.map((r) => r.upload.run.site), ["magalu", "shein"]);
  assert.equal(runs[1]!.upload.listings[0]!.seller, undefined);
  assert.equal(skipped.length, 2);
});
