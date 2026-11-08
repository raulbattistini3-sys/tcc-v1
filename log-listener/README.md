# log-listener (moved)

The Go collector that lived here is replaced by the TypeScript server in
[`demo-monorepo-workspace/apps/server`](../demo-monorepo-workspace/apps/server). It speaks the same
protocol, so the extension's Settings don't change:

| | Go log-listener (before) | `apps/server` (now) |
|---|---|---|
| endpoint | `POST /ingest`, `GET /health` | same, plus read routes for the dashboard |
| auth | `Authorization: Bearer <token>`, `-token` / `$TCC_TOKEN` / random | same, `TCC_TOKEN` / random (printed at start) |
| port | 8787 | 8787 (`PORT`) |
| limits | 2 MiB body, 240 requests/min per IP | same |
| storage | `out/log-<UTC minute>.log`, one JSON line per request | Postgres: `ingest_batches` (body kept as sent, and as jsonb) and `telemetry_events` (one row per event) |

```sh
cd ../demo-monorepo-workspace
pnpm install
cp apps/server/.env.example apps/server/.env   # DATABASE_URL, DATABASE_CA_CERT, TCC_TOKEN
pnpm db:migrate
pnpm dev:server
```

The old `out/*.log` files hold one `{receivedAt, ip, body}` per line. `body` is a request exactly as the
extension sent it, so it can be replayed into the server with `POST /ingest` if you want them in the
database. A Node collector that still writes NDJSON files stays available as `npm run collector`
(`tools/collector.mjs`).
