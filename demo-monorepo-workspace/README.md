# demo-monorepo-workspace

Records what the thesis measures, in Postgres, through one server, with a dashboard to browse it.
pnpm workspace:

```
packages/contracts   Zod schemas + TS types of every body the server accepts (shared by server, web, demo-webscraping)
apps/server          Express 5 + Drizzle ORM (node-postgres): POST /ingest, /sweeps, /scrapes and their read routes
apps/web             Vite + React + TS dashboard (CSS Modules, TanStack Query): sweeps, scraped listings, telemetry
```

| What arrives | From | Route | Tables |
|---|---|---|---|
| extension telemetry | the WebExtension's "Stream events" (replaces the Go `log-listener/`) | `POST /ingest` | `ingest_batches`, `telemetry_events` |
| sweep runs + one row per query | Java harness, lab demo, shops' `window.__shop.queries`, the ERP | `POST /sweeps`, `POST /sweeps/:id/results` | `sweep_runs`, `sweep_results` |
| store listings | `../demo-webscraping` (`--post`) | `POST /scrapes` | `scrape_runs`, `scraped_listings` |

Why the tables look the way they do (typed columns for what gets aggregated, jsonb for the rest, the
upload kept verbatim and as jsonb, events expanded by Postgres rather than re-encoded by Node):
[`../docs/next-steps-ml-and-data.md`](../docs/next-steps-ml-and-data.md) §1 and §4.

## Setup (Supabase logs project)

```sh
pnpm install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

In `apps/server/.env`:

- `DATABASE_URL`: the **transaction pooler** URL (port 6543).
- `DATABASE_MIGRATION_URL`: the **session pooler** URL (port 5432), used by migrations only.
- `DATABASE_CA_CERT`: Supabase's CA file (Dashboard → Database → SSL Configuration). TLS is always
  verified for a remote database.
- `TCC_TOKEN`: any long random string.

```sh
pnpm db:migrate      # creates the 6 tables (apps/server/drizzle/0000_init.sql)
pnpm dev             # server on :8787, dashboard on http://localhost:5175
```

Paste the token into the dashboard's header field (kept in that browser only). Set the extension's
Settings → Collector URL to `http://<this machine>:8787/ingest` with the same token.

Keep credentials in `.env` files (git-ignored), never in tracked files or notes at the repo root.

## Sending a sweep

```ts
import type { SweepUpload } from "@tcc/contracts";
const body: SweepUpload = {
  run: { source: "harness", app: "market", framework: "react", throttling: 4, datasetRows: 600_000, condition: "full" },
  results: window.__shop.queries.map((q) => ({ ...q, size: 600_000, queryKind: "name:contains", strategy: "adaptive" })),
};
await fetch("http://127.0.0.1:8787/sweeps", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
```

`GET /sweeps/:id` returns the run plus one row per cell (strategy × target × size × query kind × cold).
Each row has n, p50/p95 time to result, p50 main-thread blocking, p50 time to paint, and the mean
error of the chosen target's prediction.

## Tests

The server's integration tests run over HTTP against a real, throwaway Postgres (they truncate the
tables):

```sh
# a local Postgres 18 (installer's bin on PATH), nothing else needed:
initdb -D .pgdata -U postgres -A trust && pg_ctl -D .pgdata -o "-p 55432" -l .pgdata/log start
psql -h localhost -p 55432 -U postgres -c "create database tcc_logs"
cd apps/server
DATABASE_URL=postgresql://postgres@localhost:55432/tcc_logs pnpm db:migrate
TEST_DATABASE_URL=postgresql://postgres@localhost:55432/tcc_logs pnpm test
```

## Notes

- **Supabase's transaction pooler.** node-postgres sends unnamed statements and nothing here issues
  `SET`, so the app works through port 6543 as is.
- **Port 8787 is the old collector's,** so a Go `log-listener.exe` still running holds `[::]:8787` and
  `localhost` may reach it instead of this server. Stop it, or use `127.0.0.1` / another `PORT`.
- **Reads need the token too,** unless `PUBLIC_READS=1`, because the server binds `0.0.0.0` so other
  machines' extensions can upload.
