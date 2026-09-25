# Splitty

Two deployment tracks are planned and documented in `docs/`:

- **`docs/PLAN.md`** — Tailscale-only, no accounts, small trusted circle.
- **`docs/PLAN-PUBLIC.md`** — public self-service signup, hosted on Oracle Cloud Always Free. **This is the track currently implemented.**

Phase 0 (accounts, auth, rate limiting/lockout, the Docker Compose stack, backups) is done. See `docs/PLAN-PUBLIC.md` §15 for the phased roadmap and `docs/RUNBOOK.md` for deploying this to a real Oracle VM.

## Repo layout

```
apps/api          Fastify + TypeScript backend
apps/web           React + Vite frontend
packages/shared    Shared TS types, zod schemas, money/currency utilities
infra              docker-compose.yml, Caddyfile, Dockerfiles, backup/restore scripts
docs               PLAN.md, PLAN-PUBLIC.md, RUNBOOK.md
```

## Local development

Requires Node 22+, pnpm, and Docker.

```bash
pnpm install
```

**A local Postgres is required for `apps/api`** (both for `pnpm dev:api` and for its test suite). Spin one up however you like; a throwaway container works:

```bash
docker run -d --name splitty-test-pg \
  -e POSTGRES_USER=splitty -e POSTGRES_PASSWORD=splitty -e POSTGRES_DB=splitty_test \
  -p 5433:5432 postgres:16-alpine
```

Then, in `apps/api`:

```bash
cp .env.example .env        # already points DATABASE_URL at the container above
pnpm db:migrate
pnpm db:seed                # currencies + starter category tree
```

Run everything:

```bash
pnpm typecheck               # all packages
pnpm test                    # builds packages/shared first, then runs all test suites
pnpm dev:api                 # http://localhost:3000
pnpm dev:web                 # http://localhost:5173 (proxies /api to the port above)
```

Note: `packages/shared` is consumed by its **compiled** output (`dist/`) at runtime — by both `apps/api` and Docker builds — but by its **source** (`src/`) for type-checking, so editors always see fresh types. If a change to `packages/shared` isn't showing up at runtime, rebuild it: `pnpm build:shared`. (`dev:api`/`dev:web`/`test` already do this automatically.)

## Full stack via Docker Compose

This is the same stack `docs/RUNBOOK.md` deploys to production, runnable locally for an end-to-end check:

```bash
cd infra
cp .env.example .env
# for a pure local HTTP smoke test (not production settings), also set:
#   COOKIE_SECURE=false
#   SITE_ADDRESS=localhost
#   APP_ORIGIN=http://localhost
docker compose up -d --build
docker compose exec api node dist/db/seed.js
```

Then open `https://localhost/` (Caddy uses its internal CA for `localhost`, so your browser — and `curl -k` — will need to accept a self-signed cert; a real domain in production gets a real Let's Encrypt cert automatically).

Backups: `infra/backup.sh` / `infra/restore.sh` — see `docs/PLAN-PUBLIC.md` §11 and `docs/RUNBOOK.md` §8 for what they do and why the restore path is tested, not just the backup.
