#!/usr/bin/env bash
# Author: Brijesh Dave <https://github.com/brijeshdave>
# First-run installer for a fresh Ubuntu server. Checks the prerequisites,
# generates the secrets, writes .env, brings the stack up, migrates and seeds,
# and prints the superadmin password once.
#
# Idempotent in the way that matters: it refuses to overwrite an existing .env,
# and migrate/seed are both safe to run again. To re-run after a partial
# install, keep the .env it wrote and use scripts/upgrade.sh instead.
#
# Usage:
#   scripts/install-ubuntu.sh                          # http on port 8080
#   scripts/install-ubuntu.sh --host reportly.acme.com # https via Caddy
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE=compose.prod.yaml
PUBLIC_HOSTNAME=""
ACME_EMAIL=""
SMTP_HOST=""

while [ $# -gt 0 ]; do
  case "$1" in
    --host) PUBLIC_HOSTNAME="${2:?--host needs a hostname}"; shift 2 ;;
    --email) ACME_EMAIL="${2:?--email needs an address}"; shift 2 ;;
    --smtp-host) SMTP_HOST="${2:?--smtp-host needs a host}"; shift 2 ;;
    -h | --help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

echo "==> Checking prerequisites"
command -v docker >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/engine/install/ubuntu/"
docker compose version >/dev/null 2>&1 || die "The Docker Compose plugin is missing. Install docker-compose-plugin."
docker info >/dev/null 2>&1 || die "Cannot talk to the Docker daemon. Is it running, and is this user in the 'docker' group? (newgrp docker)"
command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets (apt install openssl)."
echo "    docker $(docker version --format '{{.Server.Version}}'), compose $(docker compose version --short)"

if [ -f .env ]; then
  die ".env already exists. Refusing to overwrite it — it holds the database password,
       and replacing it would lock this deployment out of its own data.
       To upgrade an existing install, run scripts/upgrade.sh instead."
fi

echo "==> Generating secrets"
# `tr -d` because a stray newline inside a compose value truncates it silently.
DB_PASSWORD="$(openssl rand -base64 24 | tr -d '\n=/+' | cut -c1-32)"
AUTH_SECRET="$(openssl rand -base64 32 | tr -d '\n')"

if [ -n "$PUBLIC_HOSTNAME" ]; then
  SCHEME=https
  ORIGIN="https://${PUBLIC_HOSTNAME}"
  # Caddy, then the web container's nginx: two hops to the real client IP.
  TRUST_PROXY=2
  WEB_PUBLIC_PORT="127.0.0.1:8080"
  PROFILE_ARGS=(--profile tls)
else
  SCHEME=http
  ORIGIN="http://localhost:8080"
  TRUST_PROXY=1
  WEB_PUBLIC_PORT="8080"
  PROFILE_ARGS=()
  echo "    no --host given: serving plain HTTP on port 8080."
  echo "    Session cookies will not carry the Secure flag. Use --host for TLS."
fi

echo "==> Writing .env"
umask 077
cat > .env <<EOF
# Written by scripts/install-ubuntu.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ).
# Treat this file as a secret: it holds the database password and the cookie
# signing key. See .env.production.example for what each value does.

POSTGRES_USER=reportly
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=reportly
POSTGRES_LOG_DB=reportly_logs

BETTER_AUTH_SECRET=${AUTH_SECRET}

WEB_URL=${ORIGIN}
BETTER_AUTH_URL=${ORIGIN}
CORS_ORIGIN=${ORIGIN}
ALLOW_INSECURE_HTTP=$([ "$SCHEME" = "http" ] && echo true || echo false)

PUBLIC_HOSTNAME=${PUBLIC_HOSTNAME}
ACME_EMAIL=${ACME_EMAIL}
TRUST_PROXY=${TRUST_PROXY}
WEB_PUBLIC_PORT=${WEB_PUBLIC_PORT}

# Mail is required for invitations and password resets. Fill this in and run
#   docker compose -f ${COMPOSE_FILE} up -d api
# to apply it. Until then nobody but the superadmin can be onboarded.
SMTP_HOST=${SMTP_HOST:-localhost}
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
MAIL_FROM=Reportly <no-reply@${PUBLIC_HOSTNAME:-reportly.local}>

SUPERADMIN_EMAIL=admin@${PUBLIC_HOSTNAME:-reportly.local}
SUPERADMIN_NAME=Super Admin

STORAGE_BACKEND=local
STORAGE_MAX_UPLOAD_MB=50
EOF
umask 022
echo "    .env written (mode 600)"

# The compose file bind mounts ./data, so the tree has to exist and be owned by
# the uid each container runs as before anything starts. Postgres refuses to run
# on a directory it does not own, and the API fails on its first upload — both
# with errors that read like a broken image rather than a permissions problem.
echo "==> Creating the data directories"
"$(dirname "$0")/data-dirs.sh"

echo "==> Building and starting the stack (this takes a few minutes on first run)"
docker compose -f "$COMPOSE_FILE" "${PROFILE_ARGS[@]}" up -d --build

echo "==> Seeding"
# Migrations already ran: the `migrate` service is a gate `api` waits on.
docker compose -f "$COMPOSE_FILE" exec -T api node dist/cli/index.js seed

echo "==> Checking the install"
docker compose -f "$COMPOSE_FILE" exec -T api node dist/cli/index.js doctor || true

echo
echo "==> Superadmin password (shown once, not stored anywhere readable)"
docker compose -f "$COMPOSE_FILE" exec -T api node dist/cli/index.js reset-superadmin

cat <<EOF

Reportly is up.

  Address    ${ORIGIN}
  Sign in as admin@${PUBLIC_HOSTNAME:-reportly.local} with the password above.

Next:
  1. Set SMTP_HOST and the relay credentials in .env, then:
       docker compose -f ${COMPOSE_FILE} up -d api
     Without a mail relay you cannot invite anyone.
  2. Open Settings and work through docs/ops/deployment-ubuntu.md.
  3. Turn on scheduled backups (Settings -> Backups) and check one restores.

Upgrades:  scripts/upgrade.sh
Logs:      docker compose -f ${COMPOSE_FILE} logs -f api
EOF
