# Author: Brijesh Dave <https://github.com/brijeshdave>
# Multi-stage build for the Fastify API. Build context is the repo root.
FROM node:26-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile
# Turbo builds @reportly/shared first (dependsOn ^build), then the API.
RUN pnpm turbo run build --filter=@reportly/api
# Emit the API plus its production dependencies (workspace deps dereferenced).
RUN pnpm --filter=@reportly/api deploy --prod --legacy /app

FROM base AS runtime
ENV NODE_ENV=production
# The backup feature shells out to pg_dump and pg_restore (features/backups). The
# node image has neither, so every backup and restore in a container failed with
# ENOENT — the feature was unusable in exactly the deployment it exists for.
# `tar`, the other thing it shells out to, is already here via busybox.
#
# The client is deliberately a major AHEAD of, or equal to, the server: pg_dump
# refuses to dump a server newer than itself, but dumps older ones happily. So an
# 18 client covers a 16, 17 or 18 database and this line does not have to move
# every time the server does.
RUN apk add --no-cache postgresql18-client
WORKDIR /app
COPY --from=build /app ./
EXPOSE 3000
USER node
# Liveness from inside the container, so `docker compose ps` and orchestrators can
# see the process is actually serving rather than merely running.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
