# Operations

## The command line

Run from the repository, or inside the API container with
`node dist/cli/index.js <command>`.

| Command                 | What it does                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `cli migrate`           | Applies migrations to **both** databases. Idempotent.                                       |
| `cli seed`              | Seeds permissions, system roles and groups, the superadmin, and a demo company. Idempotent. |
| `cli reset-superadmin`  | Prints a new random superadmin password, once. `--password-stdin` sets a chosen one.        |
| `cli reset-2fa <email>` | Removes an account's two-factor enrolment and signs it out everywhere.                      |
| `cli storage:migrate`   | Moves attachments onto the configured backend. `--dry-run` reports without moving.          |

```bash
pnpm --filter @reportly/api cli migrate
```

Run `migrate` before starting a new version. In Kubernetes, run it as a `Job` —
the pods do not migrate on boot.

## Superadmin password recovery

The superadmin password is never stored anywhere you can read it, and there is no
reset link. If it is lost:

```bash
pnpm --filter @reportly/api cli reset-superadmin
```

The new password is printed once and never again. It is generated to satisfy the
configured password policy.

If the superadmin account itself is gone, `cli seed` recreates it (from
`SUPERADMIN_EMAIL`), then reset its password.

### Setting a chosen password

Sometimes a generated password is the wrong tool — an automated environment needs
the credential **before** anything can read it back off a terminal. Pass it on
stdin:

```bash
printf '%s' "$SUPERADMIN_PASSWORD" | pnpm --filter @reportly/api cli reset-superadmin --password-stdin
```

**On stdin, not as an argument.** A password in `argv` is visible to anyone who can
run `ps` and lands in the shell history of whoever typed it.

The chosen password is held to the same configured policy as a generated one, and
the command refuses it otherwise — this path writes the hash directly, so nothing
else would check it.

## Two-factor lockout

Losing an authenticator is ordinary; losing the recovery codes with it is not, but
it happens. There is no self-service way out — better-auth's own disable endpoint
demands the account's password **and** a passing second factor, which is exactly
what the locked-out person cannot produce.

**For a normal user**, an administrator removes it from the app: **Users → the
person → Security → Remove**. It needs the `users:manage-2fa` permission (held by
Superadmin and Admin, not Manager), signs that account out everywhere, is written to
the audit trail, and emails the person that it happened.

**For the last superadmin**, that screen is no help — they are the one locked out,
and nobody is left to click it. Use the command line, which is gated by shell access
to the box rather than by a session:

```bash
pnpm --filter @reportly/api cli reset-2fa admin@example.com
```

A password reset alone will not get them in: the second factor still stands, and
sign-in still asks for a code. `reset-superadmin` says so when it notices.

> Removing a second factor leaves an account on its password alone. Anyone who can
> talk you into doing it has got past that factor without ever touching it — treat a
> reset request as an identity check, not a chore.

## Backups

Two databases, and they matter differently.

| Database        | Contains                               | If you lose it             |
| --------------- | -------------------------------------- | -------------------------- |
| `reportly`      | Everything: users, groups, audit trail | Unrecoverable              |
| `reportly_logs` | Log lines only                         | You lose history, not data |

```bash
pg_dump "$DATABASE_URL"     > reportly-$(date +%F).sql
pg_dump "$LOG_DATABASE_URL" > reportly-logs-$(date +%F).sql   # optional
```

Redis holds sessions, caches and the job queue. It does not need backing up: losing
it signs everyone out and drops queued emails, but nothing else.

**Profile pictures live in `reportly`**, as rows in `user_avatars` — not on disk,
because both containers run with a read-only root filesystem and a file would need a
volume or an object store to run and to back up. They ride along with the dump above.
The browser shrinks each one to 256px before uploading, so budget roughly **30 KB per
person who sets one**: ten thousand users is a few hundred megabytes, not gigabytes.

Restore with `psql "$DATABASE_URL" < dump.sql`, then run `cli migrate`.

> `docker compose down -v` deletes the Postgres **and** Redis volumes. There is no
> confirmation prompt. Use `docker compose down` (no `-v`) to stop the stack.

## Log database sizing

Logs live in their own database so their volume can never affect the application.
They still consume disk.

A rough figure: an ordinary request writes 2 log rows, and a row averages about
half a kilobyte. Ten requests per second is therefore around 900 MB per day.

Three levers, all under **Settings → Logging**:

- **Retention** (`databaseDays`) — a daily job deletes anything older. This is the
  main control.
- **Levels** — raise `default` from `info` to `warn` and the volume collapses.
  Override individual features back down to `debug` while investigating.
- **Sinks** — turn the `database` sink off entirely if you ship logs elsewhere. The
  `console` sink is what a log collector reads in Kubernetes.

Debug mode multiplies volume, which is why it always expires.

### Shipping logs elsewhere

Each line is JSON on stdout with a stable shape: `level`, `time`, `msg`,
`feature`, `requestId`, `userId`, `companyId`. Loki, ELK and friends can index
`requestId` directly, which is what makes a request traceable across the API and
its background jobs.

## Security posture

What the shipped configuration already does, so you know what you are relying on
and what is left to you.

- **Refuses to boot insecure.** In `production` the API will not start with the
  development signing secret, or with a plain-HTTP `WEB_URL`/`BETTER_AUTH_URL` on a
  real hostname (set `ALLOW_INSECURE_HTTP=true` only for a trusted private
  network). The startup error names exactly what is wrong.
- **Session cookies** are `HttpOnly` and `SameSite=Lax`, and carry `Secure` (with
  the `__Secure-` prefix) once you serve over HTTPS. Because the app and API share
  one origin, `SameSite=Lax` is what defends against cross-site request forgery.
- **Both containers run unprivileged**: a non-root user, a read-only root
  filesystem, and all Linux capabilities dropped. The only writable paths are
  scratch space (`/tmp`, and `/app/logs` when the file sink is on). The web tier
  sends a strict Content-Security-Policy and related headers on everything it
  serves; the API sends its own via helmet.
- **Client IP.** Rate limits and audit records use the IP from `TRUST_PROXY`. Set
  it to the number of proxy hops in front of the API (the bundled nginx is `1`), or
  to a list of trusted proxy addresses. Left unset, the app trusts no forwarded
  header — safe, but every caller looks like the proxy.
- **Left to you:** TLS termination, network policy between pods, secret storage
  (a real secret manager rather than the `secret.yaml` template), and keeping
  dependencies current — CI fails on a high-severity advisory in anything shipped.

## Data collection & privacy

Security and audit events (sign-in, 2FA, password change, and every data
mutation) record the **device** they came from, so an event can be correlated and
an unfamiliar device or location noticed. This is device fingerprinting, and you
should know exactly what it captures — and disclose it to your users where the law
requires (for example under the GDPR), especially if Reportly is reachable outside
your organisation.

What is captured, per event, under `details.device`:

- **From the request (server-side):** client IP, the full `X-Forwarded-For` proxy
  chain, the User-Agent parsed into browser / OS / device type, the `Sec-CH-UA-*`
  client hints, and the `Accept-Language` header.
- **From the browser (client-side):** timezone, screen and viewport size, language
  list, platform, logical CPU cores, approximate device memory, the WebGL GPU
  string, and a composite **fingerprint** hash derived from those plus a canvas
  render. Collected once per session and sent in an `X-Device-Info` header.
- **Location (optional, off by default):** none, unless you configure `GEOIP_DB`
  with a MaxMind database, in which case the IP is resolved to country/region/city.

Where it lives and how to narrow it:

- It is stored only on `audit_events` (the app database), never in a third-party
  service, and it is redacted from logs like everything else sensitive.
- It is retained as long as the audit trail is — the trail is append-only by
  design, so prune it with your database backup/retention policy if you must.
- To collect **less**, remove the client fingerprint at its source: the
  `X-Device-Info` header is attached in `apps/web/src/services/http.ts` and built
  in `apps/web/src/lib/device-info.ts`. Dropping fields there (or the header
  entirely) leaves only the server-side request data, which every web server sees
  anyway. The server parser is `apps/api/src/core/device.ts`.

If you present a privacy policy, state that you collect device and network
information for security and audit purposes, name the categories above, and give
your retention period.

## Troubleshooting

### The API will not start

It validates its environment at startup and fails with the exact list of what is
wrong. Read the message. Every variable is in the
[environment reference](reference/environment.md).

`docker compose -f compose.prod.yaml` refuses to start at all without
`BETTER_AUTH_SECRET` and `SMTP_HOST`.

### `/api/v1/ready` returns 503

It pings both databases and Redis, and the body names the one that is down:

```json
{ "status": "degraded", "checks": { "appDb": "ok", "logDb": "down", "redis": "ok" } }
```

`/api/v1/health` answers as long as the process is alive; that is the difference
between the liveness and readiness probes.

### Email is not arriving

Mail is queued through Redis and sent by a worker inside the API process. A failure
is retried, so nothing is lost — but nothing is delivered either.

1. Check the SMTP variables. In development, mail goes to Mailpit
   (<http://localhost:8025>), never to a real inbox.
2. **Logs → Search**, filter `feature` = `email`.
3. If Redis was down, queued jobs are gone. Re-send the invitation.

### Someone cannot sign in

- **Wrong password five times?** The sign-in rate limit is per IP. Wait for the
  window (default 60 seconds).
- **Two-factor lost?** They can use a recovery code on the challenge screen. If
  those are gone too, an administrator cannot help — the account needs a password
  reset, which also clears the pending two-factor challenge.
- **Signed in but sees nothing?** They are in no group. Groups are the only source
  of permissions. Their user page shows this.
- **Signed in but everything returns `PASSWORD_EXPIRED`?** Their password is older
  than `expiryDays` (**Settings → Authentication**). The app should have sent them
  to change it; if they are using the API directly, only `/me` and `/auth/*` answer
  until they do.
- **Deactivated?** **Users → _the user_** shows their status; reactivate them.

### A user sees the wrong data after switching company

The company picker re-scopes every query. If something looks stale, it is a cache,
not the database: reload. The API scopes by the `X-Company-Id` header on every
request and never trusts the client's idea of what it may see.

### Settings changed but nothing happened

Almost everything applies immediately. The exceptions are environment variables,
which are infrastructure and need a restart.

If a setting screen shows values you did not set, another administrator changed
them: **Audit** records every settings write, with before and after.
