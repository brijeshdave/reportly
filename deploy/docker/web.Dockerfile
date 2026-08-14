# Author: Brijesh Dave <https://github.com/brijeshdave>
# Multi-stage build for the web app: Vite build, served as static files by nginx.
# Build context is the repo root.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@reportly/web

# The unprivileged image runs as uid 101 and writes its temp files under /tmp, so
# the container needs neither root nor a writable root filesystem. It listens on
# 8080 because a non-root process cannot bind a privileged port.
FROM nginxinc/nginx-unprivileged:1.31-alpine AS runtime
COPY deploy/docker/security-headers.conf /etc/nginx/conf.d/security-headers.conf
COPY deploy/docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
