import type { Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { NoSuchRun } from "../db/store.js";
import type { Spool, SpoolKind } from "./spool.js";

/**
 * Validate → write to disk → write to Postgres. An invalid body is a 400 and isn't kept. Once the body is
 * on disk, a database failure answers 202 { stored: false, spooled } instead of 500: the upload is safe,
 * and `pnpm spool:replay` puts it in the database later. The client shouldn't send it again.
 */
export async function spoolThenStore<T extends object>(
  spool: Spool,
  kind: SpoolKind,
  schema: ZodTypeAny,
  req: Request,
  res: Response,
  store: () => Promise<T>,
  params?: Record<string, string>,
) {
  schema.parse(req.body); // a ZodError reaches errorHandler → 400
  const file = await spool.save(kind, req.body, params);
  const spooled = spool.label(file);
  let out: T;
  try {
    out = await store();
  } catch (err) {
    if (err instanceof NoSuchRun) {
      await spool.rejected(file);
      res.status(404).type("text").send("no such run");
      return;
    }
    req.log.error({ err, spooled }, "database write failed; the upload is kept on disk (pnpm spool:replay)");
    res.status(202).json({ stored: false, spooled, message: "saved on the server's disk, not in the database yet" });
    return;
  }
  try {
    await spool.stored(file);
  } catch (err) {
    // in the database but still in pending/: a replay would store it twice, so say so loudly
    req.log.error({ err, spooled }, "stored, but couldn't move the spool file out of pending/: delete it by hand");
  }
  res.status(201).json({ ...out, spooled: spooled.replace(/^pending\//, "stored/") });
}
