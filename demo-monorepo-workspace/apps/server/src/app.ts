import express from "express";
import { tmpdir } from "node:os";
import { join } from "node:path";
import cors from "cors";
import { pinoHttp } from "pino-http";
import type { Config } from "./env.js";
import type { Db } from "./db/client.js";
import { errorHandler, requireToken } from "./lib/http.js";
import { ingestRoutes } from "./routes/ingest.js";
import { sweepRoutes } from "./routes/sweeps.js";
import { scrapeRoutes } from "./routes/scrapes.js";
import { Spool } from "./lib/spool.js";
import type { TelemetryLog } from "./lib/telemetry-log.js";
import { hostRoutes } from "./routes/host.js";
import { eventRoutes } from "./routes/events.js";
import { noTimer } from "./lib/timer.js";
import type { HostTelemetry } from "@tcc/host-telemetry";

// `spool`: where uploads are kept on disk before the database (index.ts passes SPOOL_DIR; tests get a temp dir)
export function createApp(
  db: Db,
  config: Pick<Config, "token" | "origins" | "PUBLIC_READS" | "LOG_LEVEL"> & { TCC_WEB_DIR?: string },
  spool = new Spool(join(tmpdir(), "tcc-spool")),
  // the extension's uploads as log<ms>.json files (index.ts passes TELEMETRY_LOG_DIR; none in tests)
  telemetryLog?: TelemetryLog,
  // the server measuring itself (index.ts; none in tests): Server-Timing on every response, request
  // and query durations, sent as host telemetry like any other Node service's
  hostTelemetry?: HostTelemetry,
) {
  const app = express();
  app.disable("x-powered-by");
  // High-frequency telemetry/ingest POSTs only log on failure; set LOG_LEVEL=debug to see per-batch detail.
  const NOISY = /^\/(telemetry\/(events|host)|ingest)(\?|$)/;
  app.use(
    pinoHttp({
      level: config.LOG_LEVEL,
      redact: ["req.headers.authorization"],
      autoLogging: { ignore: (req) => req.url === "/health" },
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return req.method === "POST" && NOISY.test(req.url ?? "") ? "silent" : "info";
      },
    }),
  );
  // the dashboard's origins; the extension's service worker isn't subject to CORS (host permissions)
  app.use(cors({ origin: config.origins, allowedHeaders: ["Content-Type", "Authorization"], maxAge: 600 }));
  // Timing-Allow-Origin: the dashboard sees these responses' full resource timing and Server-Timing
  if (hostTelemetry) app.use(hostTelemetry.middleware({ timingAllowOrigin: config.origins }));
  const timer = hostTelemetry ?? noTimer;

  const auth = requireToken(config.token);
  const readAuth: express.RequestHandler = config.PUBLIC_READS === "1" ? (_req, _res, next) => next() : auth;

  app.get("/health", (_req, res) => {
    res.type("text").send("ok");
  });
  app.use(ingestRoutes(db, auth, readAuth, telemetryLog, timer));
  app.use(hostRoutes(db, auth, readAuth, timer));
  app.use(eventRoutes(db, auth, readAuth, timer));
  app.use(sweepRoutes(db, spool, auth, readAuth));
  app.use(scrapeRoutes(db, spool, auth, readAuth));
  // the dashboard, same origin as the API (no CORS involved); hashed assets cached for good
  if (config.TCC_WEB_DIR) {
    app.use(
      express.static(config.TCC_WEB_DIR, {
        index: "index.html",
        setHeaders: (res, file) => {
          res.setHeader("Cache-Control", /[\\/]assets[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "no-cache");
        },
      }),
    );
  }
  app.use((_req, res) => {
    res.status(404).type("text").send("not found");
  });
  app.use(errorHandler);
  return app;
}
