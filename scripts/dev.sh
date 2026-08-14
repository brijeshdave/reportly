#!/usr/bin/env bash
# Author: Brijesh Dave <https://github.com/brijeshdave>
# One-shot dev launcher: ensure env files, install deps, build the shared package
# (it is consumed as a built dependency), optionally start infra, then run the API
# and web together with hot reload.
#
# Usage:
#   scripts/dev.sh              # app only (API + web)
#   scripts/dev.sh --infra      # also start postgres + redis + mailpit via compose
set -euo pipefail

cd "$(dirname "$0")/.."

WITH_INFRA=0
for arg in "$@"; do
  case "$arg" in
    --infra | --with-infra) WITH_INFRA=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

echo "==> Ensuring env files"
for env in .env apps/api/.env apps/web/.env; do
  if [ ! -f "$env" ]; then
    cp "${env}.example" "$env"
    echo "    created $env"
  fi
done

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies"
  pnpm install
fi

echo "==> Building @reportly/shared (consumed as a built package)"
pnpm --filter @reportly/shared build

if [ "$WITH_INFRA" = "1" ]; then
  echo "==> Starting infrastructure (postgres, redis, mailpit)"
  docker compose up -d
fi

echo "==> Starting API (http://localhost:3000) and web (http://localhost:5173)"
echo "    Health: http://localhost:3000/api/v1/health   |   Ctrl-C to stop"
exec pnpm dev
