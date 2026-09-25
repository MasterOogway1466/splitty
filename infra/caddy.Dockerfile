# Build context is the repo root (see infra/docker-compose.yml). This
# image both builds the static frontend AND serves it — Caddy handles
# `/` (this build's output) and reverse-proxies `/api/*` to the `api`
# service, so there is no separate always-on "web" container
# (docs/PLAN-PUBLIC.md §3: one hostname, one process serving both).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @splitty/web...

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY tsconfig.base.json ./
RUN pnpm --filter @splitty/shared build
RUN pnpm --filter @splitty/web build

FROM caddy:2-alpine
COPY --from=build /repo/apps/web/dist /srv/web
COPY infra/Caddyfile /etc/caddy/Caddyfile
