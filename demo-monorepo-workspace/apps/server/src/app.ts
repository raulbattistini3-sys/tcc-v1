import express from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import type { Config } from "./env.js";
import type { Db } from "./db/client.js";
import { errorHandler, requireToken } from "./lib/http.js";
import { ingestRoutes } from "./routes/ingest.js";
import { sweepRoutes } from "./routes/sweeps.js";
import { scrapeRoutes } from "./routes/scrapes.js";

export function createApp(db: Db, config: Pick<Config, "token" | "origins" | "PUBLIC_READS" | "LOG_LEVEL">) {
  const app = express();
  app.disable("x-powered-by");
  app.use(pinoHttp({ level: config.LOG_LEVEL, redact: ["req.headers.authorization"], autoLogging: { ignore: (req) => req.url === "/health" } }));
  // the dashboard's origins; the extension's service worker isn't subject to CORS (host permissions)
  app.use(cors({ origin: config.origins, allowedHeaders: ["Content-Type", "Authorization"], maxAge: 600 }));

  const auth = requireToken(config.token);
  const readAuth: express.RequestHandler = config.PUBLIC_READS === "1" ? (_req, _res, next) => next() : auth;

  app.get("/health", (_req, res) => {
    res.type("text").send("ok");
  });
  app.use(ingestRoutes(db, auth, readAuth));
  app.use(sweepRoutes(db, auth, readAuth));
  app.use(scrapeRoutes(db, auth, readAuth));
  app.use((_req, res) => {
    res.status(404).type("text").send("not found");
  });
  app.use(errorHandler);
  return app;
}
