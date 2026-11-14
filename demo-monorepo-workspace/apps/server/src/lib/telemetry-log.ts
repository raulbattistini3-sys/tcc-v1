import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The extension's uploads, also written to disk as readable JSON: every accepted POST /ingest is buffered,
// and once a second the buffer becomes <dir>/log<Date.now()>.json (an array of uploads, pretty-printed).
// A second with no uploads writes no file. The uploads are JSON already, so the files are .json, not .log.
// Independent of the database: written before the Postgres insert, so a database that is down loses nothing here.

export type TelemetryLogEntry = {
  receivedAt: string;
  ip: string | null;
  kind: string;
  installId: string | null;
  label: string | null;
  events: number;
  body: unknown;
};

export class TelemetryLog {
  private buf: TelemetryLogEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;

  constructor(
    readonly dir: string,
    private readonly intervalMs = 1000,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    this.timer.unref();
  }

  push(entry: TelemetryLogEntry) {
    this.buf.push(entry);
  }

  /** Writes what's buffered to a new file; returns its path, or null when there was nothing. */
  async flush(): Promise<string | null> {
    if (this.buf.length === 0) return null;
    const items = this.buf.splice(0, this.buf.length);
    // two flushes in the same millisecond (stop() right after a tick) must not overwrite each other
    const stamp = Math.max(Date.now(), this.last + 1);
    this.last = stamp;
    const file = join(this.dir, `log${stamp}.json`);
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(file, JSON.stringify(items, null, 2) + "\n");
      return file;
    } catch (err) {
      console.error(`[telemetry-log] couldn't write ${file}:`, (err as Error).message);
      return null;
    }
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }
}
