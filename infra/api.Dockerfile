# Build context is the repo root (see infra/docker-compose.yml) since
# this is a pnpm workspace: apps/api depends on packages/shared.
# Pinned to Node 22 LTS for production stability rather than tracking
# whatever's newest in local dev.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @splitwise/api...

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY tsconfig.base.json ./
RUN pnpm --filter @splitwise/shared build
RUN pnpm --filter @splitwise/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/packages/shared/package.json /repo/packages/shared/package.json
COPY --from=build /repo/packages/shared/dist /repo/packages/shared/dist
COPY --from=build /repo/packages/shared/node_modules /repo/packages/shared/node_modules
COPY --from=build /repo/apps/api/node_modules /repo/apps/api/node_modules
COPY --from=build /repo/apps/api/package.json /repo/apps/api/package.json
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build /repo/apps/api/drizzle /repo/apps/api/drizzle

WORKDIR /repo/apps/api
EXPOSE 3000
# Migrations run on every container start — safe because Drizzle tracks
# applied migrations and this is always a single instance (docs/PLAN-PUBLIC.md
# §3a: one VM, no concern about replicas racing on the migration lock).
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
