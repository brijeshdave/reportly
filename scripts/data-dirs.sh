#!/usr/bin/env bash
# Create the bind-mount directory tree, owned by the users the containers run as.
#
# Only needed if you switch a service from a named Docker volume to a bind mount
# (see the commented lines in compose.dev.yaml / compose.prod.yaml). Named volumes
# are the default and need none of this — Docker creates them and gets the
# ownership right on its own.
#
# The reason this script exists: a bind-mounted directory keeps the *host's*
# ownership, and none of these containers run as root. A folder owned by you is a
# folder Postgres refuses to start on and the API cannot write an upload into. The
# failures read like a broken image rather than a permissions problem, which is
# what makes them expensive.
#
# The uids below are read from the images, not guessed:
#   postgres:18-alpine  postgres  70
#   redis:8-alpine      redis     999
#   the API image       node      1000   (deploy/docker/api.Dockerfile: USER node)
#   caddy:2-alpine      root      0
#
# Usage:
#   scripts/data-dirs.sh              # ./data
#   scripts/data-dirs.sh /srv/reportly-data
#
# Safe to re-run: it creates what is missing and re-applies ownership, and never
# deletes anything.
set -euo pipefail

ROOT="${1:-${DATA_ROOT:-./data}}"

POSTGRES_UID=70
REDIS_UID=999
API_UID=1000
CADDY_UID=0

say() { printf '  %s\n' "$*"; }

# chown needs root unless you already own the target as that uid. Rather than
# demand sudo for the whole script, ask for it only where it is needed, and say
# plainly when it could not be done — a silently unowned directory is the failure
# this script exists to prevent.
own() {
  local path="$1" uid="$2" label="$3"
  if chown -R "${uid}:${uid}" "$path" 2>/dev/null; then
    say "${label}: ${path} (uid ${uid})"
  elif command -v sudo >/dev/null 2>&1 && sudo chown -R "${uid}:${uid}" "$path" 2>/dev/null; then
    say "${label}: ${path} (uid ${uid}, via sudo)"
  else
    say "${label}: ${path} — COULD NOT SET OWNER to uid ${uid}"
    say "         run: sudo chown -R ${uid}:${uid} ${path}"
    FAILED=1
  fi
}

FAILED=0

echo "Creating the bind-mount tree under ${ROOT}"

mkdir -p \
  "${ROOT}/postgres" \
  "${ROOT}/redis" \
  "${ROOT}/api/uploads" \
  "${ROOT}/api/logs" \
  "${ROOT}/api/backups" \
  "${ROOT}/caddy/data" \
  "${ROOT}/caddy/config"

own "${ROOT}/postgres" "$POSTGRES_UID" "postgres  "
own "${ROOT}/redis" "$REDIS_UID" "redis     "
# One owner for the whole api tree: uploads, logs and backups are all written by
# the same process, and splitting the ownership only invites one of them to be
# missed.
own "${ROOT}/api" "$API_UID" "api       "
own "${ROOT}/caddy" "$CADDY_UID" "caddy     "

echo
if [ "$FAILED" = "1" ]; then
  echo "Some directories could not be given the right owner — see above."
  echo "The containers using them will fail to start until that is fixed."
  exit 1
fi

echo "Done. To use these instead of named volumes, uncomment the bind-mount"
echo "lines in compose.dev.yaml / compose.prod.yaml (search for 'bind mount')."
