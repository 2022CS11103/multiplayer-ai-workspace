# Deploying ForgeAI

Five processes, all in `docker-compose.yml`:

| Service | Image | Role |
|---|---|---|
| `web` | `frontend/Dockerfile` | Next.js standalone server, port 3000 |
| `api` | `backend/Dockerfile` | FastAPI + WebSockets, port 8000. Runs `alembic upgrade head` on boot |
| `worker` | same image, `python -m app.worker` | Executes agent runs; adopts runs from crashed workers |
| `postgres` | `postgres:16` | Event log, rooms, files |
| `redis` | `redis:7` | Fan-out of live events between api and worker |

## Option A: one VPS with Docker (simplest)

Any 2 GB Linux box (Hetzner, DigitalOcean, Lightsail).

1. Point two DNS records at the server, for example `app.example.com` and `api.example.com`.
2. Clone the repo and create `.env` next to `docker-compose.yml`:

   ```bash
   ENVIRONMENT=production
   JWT_SECRET=<output of: openssl rand -hex 32>
   POSTGRES_PASSWORD=<another random value>
   FRONTEND_URL=https://app.example.com
   PUBLIC_API_URL=https://api.example.com
   PUBLIC_WS_URL=wss://api.example.com
   SEED_DEMO=true            # false once you no longer want the public demo room
   XAI_API_KEY=...           # or GEMINI_API_KEY / OPENAI_API_KEY; empty = mock agent
   METRICS_TOKEN=<random>    # protects /metrics
   SENTRY_DSN=               # optional
   ```

   `PUBLIC_API_URL` / `PUBLIC_WS_URL` are baked into the browser bundle at build time. Change them and you must rebuild `web`.

3. Remove the `ports:` entries for `postgres` and `redis` in `docker-compose.yml` so they are not reachable from the internet.
4. Put HTTPS in front. With [Caddy](https://caddyserver.com) installed on the host, `/etc/caddy/Caddyfile`:

   ```
   app.example.com {
       reverse_proxy localhost:3000
   }
   api.example.com {
       reverse_proxy localhost:8000
   }
   ```

   Caddy fetches certificates and proxies WebSockets without extra config.

5. `docker compose up -d --build`, then check `https://api.example.com/api/ready`.

Upgrades: `git pull && docker compose up -d --build`. The api runs migrations on start. In-flight agent runs are put back in the queue on shutdown and the worker resumes them from their last completed step.

## Option B: managed hosting

- **Frontend:** Vercel (root `frontend`). Set `NEXT_PUBLIC_API_URL=https://api...` and `NEXT_PUBLIC_WS_URL=wss://api...`.
- **Backend:** Render, Railway or Fly.io, from `backend/Dockerfile`.
  - Web service: default command. Env: everything in Option A plus `DATABASE_URL=postgresql+asyncpg://...`, `REDIS_URL=redis://...`, `AGENT_RUNNER=worker`, `DB_AUTO_CREATE=false`, `LOG_FORMAT=json`, `SANDBOX_MODE=mock`.
  - Background worker: same image and env, command `python -m app.worker`, `RUN_MIGRATIONS=false`.
  - The host must support WebSockets (all three do).
- **Postgres + Redis:** the host's managed add-ons (or Neon + Upstash). The `DATABASE_URL` scheme must be `postgresql+asyncpg://`.

If the host injects `PORT`, the api listens on it.

## Configuration that matters in production

| Variable | Why |
|---|---|
| `ENVIRONMENT=production` | Refuses the default `JWT_SECRET`; drops the `localhost:3000` CORS origin |
| `JWT_SECRET` | 32+ random chars. Rotating it logs everyone out |
| `FRONTEND_URL`, `CORS_ORIGINS` | Only these origins may call the API from a browser |
| `AGENT_RUNNER=worker` + Redis | Agent runs survive api restarts; several workers may run (a lease stops double execution) |
| `DB_AUTO_CREATE=false` | Alembic owns the schema |
| `SANDBOX_MODE` | `mock` in containers. Real code execution (`docker`) needs the worker to reach a Docker daemon; don't mount the host socket on a shared server |

## Observability

- `GET /api/health`: liveness. `GET /api/ready`: database check (returns 503 when the DB is down); used by the Docker healthcheck.
- `GET /metrics`: Prometheus (guard with `METRICS_TOKEN`). Worker metrics: port `WORKER_METRICS_PORT` (9100) inside the container. Main series: `forge_http_requests_total`, `forge_http_request_duration_seconds`, `forge_agent_runs_total{status}`, `forge_agent_runs_adopted_total`, `forge_tool_calls_total`, `forge_approvals_total{decision}`, `forge_llm_calls_total`, `forge_llm_errors_total`, `forge_llm_tokens_total`, `forge_llm_cost_usd_total`, `forge_ws_connections`.
- Logs: one JSON object per line with `request_id` (also returned as the `X-Request-ID` header). `docker compose logs -f api worker`.
- Errors: set `SENTRY_DSN`.

## Backups

The `postgres_data` volume is the whole product state (the event log is the source of truth). Nightly:

```bash
docker compose exec -T postgres pg_dump -U maw maw | gzip > backup-$(date +%F).sql.gz
```

## Schema changes

```bash
cd backend
alembic revision --autogenerate -m "describe change"   # review the file, then commit it
alembic upgrade head
```

CI fails if models and migrations drift (`tests/test_migrations.py`, and `alembic check` against Postgres).

An existing SQLite dev database made by `create_all` has no Alembic history: run `alembic stamp head` once before using migrations on it.

## Before charging money (not built yet)

Rate limiting on login/register, email verification and password reset, per-user AI spend limits, account deletion, billing, terms of service and privacy policy, and load testing beyond a handful of concurrent rooms.
