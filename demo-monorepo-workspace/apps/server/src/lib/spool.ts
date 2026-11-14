import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, relative } from "node:path";

// Every accepted upload (sweeps, sweep results, scrapes) is written to disk before it goes to Postgres,
// so a database that is down, full or unmigrated never loses a run:
//   <dir>/pending/<kind>/<stamp>-<rand>.json   written first (temp file + rename, never half-written)
//   <dir>/stored/<kind>/...                     moved here once the database has it
//   <dir>/rejected/<kind>/...                   the database said no for good (e.g. an unknown run id)
// Whatever is left in pending/ is replayed into the database with `pnpm spool:replay`.

export const SPOOL_KINDS = ["sweeps", "sweep-results", "scrapes"] as const;
export type SpoolKind = (typeof SPOOL_KINDS)[number];

export type SpoolEntry = { kind: SpoolKind; receivedAt: string; params?: Record<string, string>; body: unknown };

export class Spool {
  constructor(readonly dir: string) {}

  /** Writes the request body (as received) to pending/ and returns the file's path. */
  async save(kind: SpoolKind, body: unknown, params?: Record<string, string>): Promise<string> {
    const now = new Date();
    const dir = join(this.dir, "pending", kind);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${now.toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}.json`);
    const entry: SpoolEntry = { kind, receivedAt: now.toISOString(), ...(params ? { params } : {}), body };
    await writeFile(`${file}.tmp`, JSON.stringify(entry));
    await rename(`${file}.tmp`, file);
    return file;
  }

  /** The database has it: pending/ → stored/. */
  stored(file: string) {
    return this.move(file, "stored");
  }

  /** The database will never take it: pending/ → rejected/. */
  rejected(file: string) {
    return this.move(file, "rejected");
  }

  /** Files still waiting for the database, oldest first. */
  async pending(kind: SpoolKind): Promise<string[]> {
    const dir = join(this.dir, "pending", kind);
    const names = await readdir(dir).catch(() => [] as string[]);
    return names.filter((n) => n.endsWith(".json")).sort().map((n) => join(dir, n));
  }

  async read(file: string): Promise<SpoolEntry> {
    return JSON.parse(await readFile(file, "utf8")) as SpoolEntry;
  }

  /** A path to show in responses and logs: relative to the spool directory. */
  label(file: string) {
    return relative(this.dir, file).replaceAll("\\", "/");
  }

  private async move(file: string, to: "stored" | "rejected") {
    const parts = relative(join(this.dir, "pending"), file);
    const dest = join(this.dir, to, parts);
    await mkdir(join(dest, ".."), { recursive: true });
    await rename(file, dest);
    return dest;
  }
}
