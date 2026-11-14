import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

/** `Authorization: Bearer <token>`, compared in constant time. */
export function requireToken(token: string): RequestHandler {
  const expected = Buffer.from(`Bearer ${token}`);
  return (req, res, next) => {
    const got = Buffer.from(req.get("authorization") ?? "");
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      res.status(401).type("text").send("bad token");
      return;
    }
    next();
  };
}

/** Fixed window per IP, like the old collector: `perMinute` requests, then 429 until the minute ends. */
export function rateLimit(perMinute: number): RequestHandler {
  const windows = new Map<string, { n: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, w] of windows) if (w.reset <= now) windows.delete(ip);
  }, 60_000).unref();
  return (req, res, next) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const w = windows.get(ip);
    if (!w || w.reset <= now) {
      windows.set(ip, { n: 1, reset: now + 60_000 });
      return next();
    }
    if (++w.n > perMinute) {
      res.setHeader("Retry-After", String(Math.ceil((w.reset - now) / 1000)));
      res.status(429).type("text").send("slow down");
      return;
    }
    next();
  };
}

/** Wraps an async handler so a rejection reaches the error handler. */
export const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** 400 for invalid bodies (with Zod's issues), 413 for oversized ones, 500 for the rest (logged). */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({ message: "invalid body", issues: err.issues.slice(0, 20) });
    return;
  }
  const status = (err as { status?: number; type?: string }).status;
  if (status === 413) {
    res.status(413).type("text").send("too large");
    return;
  }
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).type("text").send("bad request");
    return;
  }
  req.log?.error({ err }, "request failed");
  res.status(500).type("text").send("internal error");
}

/** ?limit= and ?offset= with bounds. */
export function page(req: Request, def = 100, max = 1000) {
  const limit = Math.min(max, Math.max(1, Number(req.query.limit ?? def) || def));
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
  return { limit, offset };
}
