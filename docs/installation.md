# Installation

Three ways to run Reportly. All of them need the same four things: Postgres (two
databases), Redis, an SMTP relay, and the two application processes.

Every variable named below is described in the
[environment reference](reference/environment.md).

## Prerequisites

- Node 24 or newer, and pnpm 11 (`corepack enable`)
- Docker with Compose, for the development stack
- An SMTP relay for anything other than development

## Development (Docker Compose)

The compose file provides Postgres, Redis and [Mailpit](https://mailpit.axllent.org/),
which captures outgoing mail instead of sending it.

```bash
pnpm install

cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

docker compose up -d
pnpm --filter @reportly/api cli migrate     # both databases
pnpm --filter @reportly/api cli seed        # idempotent
pnpm --filter @reportly/api cli reset-superadmin
pnpm dev
```

| Service  | URL                                 |
| -------- | ----------------------------------- |
| Web      | <http://localhost:5173>             |
| API      | <http://localhost:3000>             |
| API docs | <http://localhost:3000/api/v1/docs> |
| Mailpit  | <http://localhost:8025>             |

`reset-superadmin` prints a random password **once**. Sign in with
`SUPERADMIN_EMAIL` (default `admin@reportly.local`) and that password.

> `docker compose down -v` deletes the Postgres and Redis volumes. Never run it
> against an environment whose data you want to keep.

## Where the data lives

By default every service keeps its data in a **named Docker volume**. Docker
creates them, gets the ownership right, and they survive a redeploy — nothing to
set up.

If you would rather see the data on the host — to back it up with the rest of the
filesystem, or to reach the uploads and backup files directly — each compose file
carries a **commented bind-mount alternative** beside every volume. Create the
directories first:

```bash
scripts/data-dirs.sh              # ./data
scripts/data-dirs.sh /srv/reportly-data
```

That builds the tree and gives each folder to the user its container runs as:

```
data/
├── postgres/          the database cluster    (uid 70)
├── redis/             sessions, queues        (uid 999)
├── api/               (uid 1000)
│   ├── uploads/         attachments and avatars
│   └── logs/            log files, when the file sink is on
├── backups/           (uid 1000)
│   ├── db/              pg_dump archives
│   └── files/           tar.gz of the upload store
└── caddy/             issued certificates     (uid 0)
```

Then uncomment the matching line in `compose.dev.yaml` or `compose.prod.yaml` —
search for `bind mount`.

::: warning Ownership is the whole difficulty
A bind mount keeps the host directory's ownership, and none of these containers
run as root. Point one at a folder owned by you and Postgres refuses to start,
Redis cannot write, and the API fails on the first upload — with errors that read
like a broken image. Run the script rather than creating the folders by hand, and
see [Operations](operations.md#a-container-will-not-start-after-switching-to-a-bind-mount)
if something will not start.
:::

**Backups get their own directory.** The application writes them through the
storage backend, so on disk they land under the upload root at `backups/db` and
`backups/files`. The compose comment mounts `./data/backups` over that path, which
puts them somewhere obvious on the host without the application needing to know —
handy, since a backup you cannot find is a backup you will not restore. Postgres
gets the same directory **read-only**, so a dump can be restored by hand from
inside that container.

You do not have to choose one for everything. Mixing is fine, and the common
choice is a bind mount for `data/api` — where the uploads and backups are — with
Postgres left on a named volume, which avoids both the ownership trap and the
filesystem overhead a bind mount adds on Docker Desktop.

## Production (Docker Compose)

`compose.prod.yaml` builds both images and runs the full stack. It refuses to
start unless you supply the values that must not have defaults:

```bash
cat > .env <<'EOF'
POSTGRES_USER=reportly
POSTGRES_PASSWORD=<a strong password>
BETTER_AUTH_SECRET=<openssl rand -base64 32>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=<relay user>
SMTP_PASS=<relay password>
MAIL_FROM=Reportly <no-reply@example.com>

# Where users reach Reportly. Emailed links point at WEB_URL.
WEB_URL=https://reportly.example.com
BETTER_AUTH_URL=https://reportly.example.com
CORS_ORIGIN=https://reportly.example.com

# The API sits behind the web container's nginx (one hop), so it reads the client
# IP from the forwarded header. Without this, rate limits and audit records would
# see nginx instead of the caller.
TRUST_PROXY=1
EOF

docker compose -f compose.prod.yaml up -d --build

# Once, on first boot:
docker compose -f compose.prod.yaml exec api node dist/cli/index.js migrate
docker compose -f compose.prod.yaml exec api node dist/cli/index.js seed
docker compose -f compose.prod.yaml exec api node dist/cli/index.js reset-superadmin
```

`BETTER_AUTH_SECRET` signs session cookies. If it were left at its development
default, anyone could forge a session. Compose will not start without it.

In `production` the API also refuses to start if `WEB_URL` or `BETTER_AUTH_URL`
is a plain-HTTP address on a real hostname, because the session cookie would then
be sent without its `Secure` flag. If you are deliberately running over HTTP on a
trusted private network, set `ALLOW_INSECURE_HTTP=true`. (Loopback addresses such
as `http://localhost` are always allowed — a browser treats them as secure.)

Put a TLS-terminating reverse proxy in front of the `web` container, and route
`/api` to the API. Sessions are cookie-based, so the browser must reach both
through the same origin. The `web` container listens on **8080** (it runs as a
non-root user, which cannot bind port 80); map your external port to it. When you
add another proxy hop in front, increase `TRUST_PROXY` to match the number of
hops, or set it to your proxy's address range.

## Kubernetes

Manifests live in `deploy/k8s`, aggregated by Kustomize.

```bash
cp deploy/k8s/secret.example.yaml deploy/k8s/secret.yaml   # gitignored
# edit secret.yaml: database URLs, BETTER_AUTH_SECRET, SMTP credentials

kubectl apply --dry-run=client -k deploy/k8s               # validate first
kubectl apply -k deploy/k8s
```

Notes:

- In a real cluster, replace `secret.yaml` with a managed secret (External Secrets,
  Sealed Secrets, or your cloud provider's) and set real image tags.
- The web pod serves static assets. Route `/api` to the `reportly-api` service with
  an Ingress.
- Probes: `GET /api/v1/health` is liveness — it answers as long as the process is
  up. `GET /api/v1/ready` is readiness — it pings both databases and Redis, and
  returns 503 if any is unreachable. Use `ready` as the readiness gate so a pod
  with a broken database never receives traffic.
- Migrations are not run by the pods. Run them as a `Job` before rolling out a new
  version.

## Bare Node

```bash
pnpm install
pnpm build

export DATABASE_URL=postgres://...
export LOG_DATABASE_URL=postgres://...
export REDIS_URL=redis://...
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
# ...and the rest of the environment reference

node apps/api/dist/cli/index.js migrate
node apps/api/dist/cli/index.js seed
node apps/api/dist/server.js
```

Serve `apps/web/dist` with any static file server, and proxy `/api` to the API.

## Verifying the install

1. `curl http://localhost:3000/api/v1/ready` returns `200`.
2. Sign in as the superadmin.
3. Open **Settings → Debug**, turn debug on for 15 minutes, then open
   **Logs → Live tail**. Lines appear as you navigate.
4. Invite a user (**Users → Invite user**) and confirm the mail arrives — in
   development, in Mailpit.

If step 4 produces no mail, the SMTP settings are wrong: the job is queued and
retried, so nothing is lost, but nothing is delivered either. See
[Operations](operations.md#email-is-not-arriving).
