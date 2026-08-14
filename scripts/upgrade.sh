#!/usr/bin/env bash
# Author: Brijesh Dave <https://github.com/brijeshdave>
# Upgrade a running production install: take a database backup, rebuild, migrate,
# restart, and verify. Stops at the first failure with the rollback command it
# would take to undo the step that failed.
#
# Usage:
#   scripts/upgrade.sh              # pull the latest code, then upgrade
#   scripts/upgrade.sh --no-pull    # upgrade the working tree as it stands
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE=compose.prod.yaml
PULL=1
[ "${1:-}" = "--no-pull" ] && PULL=0

die() { echo "ERROR: $*" >&2; exit 1; }

[ -f .env ] || die "No .env here. This looks like a fresh machine — run scripts/install-ubuntu.sh."

# The tls profile is only active if a hostname was configured; ask .env rather
# than guessing, or an upgrade quietly drops the TLS terminator.
PROFILE_ARGS=()
if grep -qE '^PUBLIC_HOSTNAME=.+' .env; then
  PROFILE_ARGS=(--profile tls)
fi

compose() { docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" "$@"; }

PREVIOUS="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "==> Backing up the database first"
# Through the app, so the dump lands in the same store as every scheduled backup
# and is visible (and restorable) from the Backups screen.
if compose exec -T api node dist/cli/index.js backup:database; then
  echo "    backup taken"
else
  echo "    WARNING: backup failed. Continuing would upgrade an unbacked-up database." >&2
  read -r -p "    Type 'continue' to proceed anyway: " answer
  [ "$answer" = "continue" ] || die "Stopped. Fix backups first: docker compose -f $COMPOSE_FILE exec api node dist/cli/index.js doctor"
fi

if [ "$PULL" = "1" ]; then
  echo "==> Pulling the latest code"
  git pull --ff-only || die "git pull failed. Resolve it by hand, or re-run with --no-pull."
fi

echo "==> Rebuilding images"
compose build || die "Build failed. Nothing has changed yet; roll back with: git checkout $PREVIOUS"

echo "==> Migrating and restarting"
# `up -d` runs the migrate gate first, then replaces api and web. Migrations are
# idempotent, so a re-run after a partial upgrade is safe.
compose up -d || die "Start failed. Roll back with: git checkout $PREVIOUS && scripts/upgrade.sh --no-pull"

echo "==> Waiting for readiness"
for attempt in $(seq 1 30); do
  if compose exec -T api node -e "fetch('http://127.0.0.1:3000/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "    ready after ${attempt}s"
    break
  fi
  [ "$attempt" = "30" ] && die "Not ready after 30s. Check: compose logs api — roll back with: git checkout $PREVIOUS && scripts/upgrade.sh --no-pull"
  sleep 1
done

echo "==> Checking the install"
compose exec -T api node dist/cli/index.js doctor

echo "==> Pruning superseded images"
docker image prune -f >/dev/null

echo
echo "Upgraded $PREVIOUS -> $(git rev-parse --short HEAD 2>/dev/null || echo unknown)."
echo "Roll back with: git checkout $PREVIOUS && scripts/upgrade.sh --no-pull"
