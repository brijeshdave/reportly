# Operations

## The command line

> **The examples below say `-f compose.prod.yaml`.** If you keep your own compose
> file — `compose.yaml` and the three other names Compose recognises are gitignored
> for exactly that reason — substitute it, or export `COMPOSE_FILE` once and drop the
> `-f` entirely. `scripts/upgrade.sh` works it out for itself; see
> [Upgrades](ops/deployment-ubuntu.md#upgrades).

Run from the repository with `pnpm --filter @reportly/api cli <command>`, or
**inside the API container** with `node dist/cli/index.js <command>`:

```bash
docker compose exec api node dist/cli/index.js doctor
```

The container has no workspace, so the `pnpm --filter` form there makes corepack
try to install one and fails with `EACCES`. Note `exec api` — the _service_ name,
not the container name.

| Command                 | What it does                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `cli migrate`           | Applies migrations to **both** databases. Idempotent.                                       |
| `cli seed`              | Seeds permissions, system roles and groups, the superadmin, and a demo company. Idempotent. |
| `cli reset-superadmin`  | Prints a new random superadmin password, once. `--password-stdin` sets a chosen one.        |
| `cli reset-2fa <email>` | Removes an account's two-factor enrolment and signs it out everywhere.                      |
| `cli storage:migrate`   | Moves attachments onto the configured backend. `--dry-run` reports without moving.          |
| `cli seed:activity`     | Fills a date range with demo work on top of the master data already here. Development only. |

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

### Working on a copy of production, safely

To reproduce something with real data, load a production backup into a development
database — but never as-is. **A development server holding production data still
believes it is production.** It has the reminder cron and six notification
channels, and the first scheduled job after the restore emails and messages real
staff and customers from your laptop.

**When a backup fails.** The row says why, in the list itself — no hovering. Every
attempt also keeps its own log: press the document icon to download what that run
said (when it started, what was run, how it ended, and the tool's output). It is
stored with the attempt, so it is still there weeks later whether or not the log
database is switched on. Passwords are stripped from it before it is written.

A failure also notifies everyone holding `backups:manage` — **including whoever
pressed the button**. Every other kind of event skips the person who caused it;
for a failure that rule left a manual backup failing silently to nobody at all.

> **Percent-encode the password in `DATABASE_URL`.** `@`, `#`, `/` and `?` are
> reserved in a URL, and while the app's driver copes, other tools read the same
> string differently. Use `%40` for `@`, `%23` for `#`, `%2F` for `/`. `cli doctor`
> now proves the backup tools can really connect, so run it after any change.

**Getting the dump across.** No new machinery: on the production server open
**Backups** (needs `backups:manage`), press **Back up now** for the database, then
**Download** the row it creates. Copy that file to the development machine. Backups
are also taken on a schedule, so any recent row will do — you do not have to make a
fresh one.

`restore:dev` then restores and makes it safe in one run:

```bash
ALLOW_DEV_RESTORE=true pnpm --filter @reportly/api cli restore:dev   --file reportly-2026-08-19.dump   --confirm "overwrite my development database"
```

It refuses unless all of these hold: `NODE_ENV` is not `production`,
`ALLOW_DEV_RESTORE=true`, `DATABASE_URL` points at a local database, and the
confirmation phrase is typed. Then, in the same transaction as the restore:

| Made safe                                               | Kept                       |
| ------------------------------------------------------- | -------------------------- |
| Every local password becomes `Admin@123`                | Journal entries            |
| Two-factor removed, everyone signed out                 | Routines, rotas, shifts    |
| Emails keep their name, lose the domain — `x@dev.local` | Assets, devices, parts     |
| Phone numbers, Discord handles, provider tokens erased  | Departments and the line   |
| Twilio/Telegram/Discord and OIDC secrets deleted        | Points and the audit trail |
| Every channel but the in-app bell switched off          |                            |

Add `--logs <dump>` to restore the log database too; without it your development
logs are left alone.

### Filling a copy with something to look at

A restored copy has your real people, departments, shifts and machines — and, if the
production data is young, very little _work_ to show. Every report opens empty, which
looks like a bug and is not one.

```bash
ALLOW_DEV_SEED=true pnpm --filter @reportly/api cli seed:activity --months 2
```

It generates journal entries and their status trail, scores and the points ledger,
downtime, tasks, routine completions and a published rota per month — **on top of the
master data already there, which it never touches.**

| Flag                            |                                                    |
| ------------------------------- | -------------------------------------------------- |
| `--months N`                    | the N months ending today (default 2)              |
| `--from` / `--to`               | an explicit range, `YYYY-MM-DD`                    |
| `--volume light｜normal｜heavy` | roughly 1, 3 or 6 entries per person per week      |
| `--seed N`                      | reproduce an earlier run exactly                   |
| `--dry-run`                     | print what the master data supports, write nothing |
| `--purge`                       | remove everything a previous run wrote             |

**It prints what it can and cannot generate before writing**, per department — a
department with nobody in it cannot file anything, one with no devices has no
downtime. That summary is worth a `--dry-run` on its own.

The shape is deliberate: weekdays carry most of the work, one week is a bad week on
one machine so reliability visibly dips, and a few entries are left open at the end so
Reviews is not empty. Every row is marked, and `--purge` matches on that mark — so
anything **you** typed while looking at the demo data survives it.

Guarded like `restore:dev`: `ALLOW_DEV_SEED=true` must be set, `NODE_ENV=production`
is refused outright, and a `DATABASE_URL` pointing anywhere but this machine is
refused too.

> **One simplification worth knowing.** A department's entries are all filed against
> the first site its people work at. A department spread across three plants will look
> more concentrated than it really is, which matters if you are checking the
> location-scoping of a report specifically.

**What it does about notifications.** Every channel except the in-app bell is
switched off, in both places that decide: the app-wide delivery setting and each
person's own preferences. Mobile numbers, WhatsApp/Telegram flags and Discord
handles are erased outright, so even a channel switched back on by hand has no
number to reach. Turn individual channels on again from **Settings → Notifications**
if a piece of work needs them.

**Two things it cannot do for you.** It does not touch `.env` — if you copied
production's, your development box is still holding production secrets and pointing
at production's SMTP. And it restores the database only: attachments live in the
file store, so downloads will 404 unless you restore that separately.

## The message log

**System → Messages** (`logs:view`) records every email, SMS, WhatsApp, Telegram
and Discord message Reportly sends: what kind it was, who it was for, whether it
arrived, and what the provider said if it did not.

Two things it deliberately does not hold:

- **The message body.** A password-reset email contains a working reset link. A log
  that stored it would be a second front door with a longer memory than the token.
- **The full destination.** Addresses are redacted as they are written —
  `b•••@example.com`, `+91•••4321` — so the row never held the address at all and
  no future screen can reveal it. Enough to recognise; not enough to harvest a
  directory.

Retention is per channel (**Settings → Messages**), because the rows are not worth
the same: an email row carrying a provider's refusal is evidence months later, a
WhatsApp line mirroring a bell notification is noise after a fortnight. Setting a
channel to **0 days** stops it being logged at all — nothing is written, rather
than written and swept up later. Rows already there are left alone.

Non-superadmins see their own company's messages plus the ones belonging to no
company (a password reset belongs to a person, not a tenant) — the same rule the
audit trail uses.

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

### A container will not start after switching to a bind mount

Almost always ownership, and the error rarely says so plainly.

A **named volume** is created and owned by Docker, which gets it right. A **bind
mount** keeps whatever ownership the host directory already had — and none of
these containers run as root. A folder owned by you is a folder the service
cannot write to.

Run the setup script, which creates the tree with the right owner for each
service:

```bash
scripts/data-dirs.sh              # ./data
scripts/data-dirs.sh /srv/reportly-data
```

If you would rather do it by hand, these are the users the images run as:

| Directory       | Service  | Owner | Fix                                 |
| --------------- | -------- | ----- | ----------------------------------- |
| `data/postgres` | Postgres | 70    | `sudo chown -R 70:70 data/postgres` |
| `data/redis`    | Redis    | 999   | `sudo chown -R 999:999 data/redis`  |
| `data/api`      | API      | 1000  | `sudo chown -R 1000:1000 data/api`  |
| `data/caddy`    | Caddy    | 0     | `sudo chown -R 0:0 data/caddy`      |

What each failure looks like:

**Postgres** exits immediately, and the log says the data directory has the wrong
ownership or permissions — it refuses to run on a directory it does not own, by
design. Nothing is corrupted; it never started.

**Redis** starts but cannot write its append-only file, so it logs a write error
and every restart loses whatever was in memory. Sessions and queues live here, so
the symptom people report is "everyone got signed out again".

**The API** starts fine and fails only when it first writes: an upload returns a
500, backups fail, and `cli doctor` reports the attachment store is not writable.
It is the one where the cause and the symptom are furthest apart — the container
looks healthy for hours.

Two more that look like permissions and are not:

- **The directory did not exist.** Docker creates a missing bind-mount source as
  an empty directory owned by root, which then fails for a different reason. Run
  the script rather than letting Docker guess.
- **Postgres 18 keeps its data one level down.** Mount `/var/lib/postgresql`, not
  `/var/lib/postgresql/data`. Mount the old path and the container starts happily,
  initialises inside its own filesystem, and loses everything on the next
  recreate — with no error at all. The compose files already have this right;
  it only bites if you edit the path.

### Choosing between a named volume and a bind mount

Named volumes are the default and are the right choice for most installations:
Docker handles ownership, and `docker compose down` leaves them alone.

Reach for a bind mount when you want the data **visible on the host** — to back it
up with the rest of the filesystem, to copy uploads off, or to inspect a backup
file without going through the container. The commented lines in
`compose.dev.yaml` and `compose.prod.yaml` show exactly where.

`data/api` is the one most people actually want, since it holds the uploads and
the backup files. There is no need to switch all of them: mixing is fine, and
leaving Postgres on a named volume avoids both the ownership trap and the
filesystem overhead a bind mount adds on Docker Desktop.

::: warning `docker compose down -v` deletes named volumes
That is the flag that destroys a database. A bind mount survives it, which is one
honest argument in its favour.
:::

### "Superadmin user not found — run `cli seed` first"

The database has its schema but not its seed data. Migrations run automatically —
the compose file runs them as a `migrate` service the API waits on — but
**seeding is a separate, deliberate step**, because it writes rows rather than
structure.

```bash
docker compose -f compose.prod.yaml exec api node dist/cli/index.js seed
docker compose -f compose.prod.yaml exec api node dist/cli/index.js reset-superadmin
```

`seed` is idempotent: run it on a populated database and it adds only what is
missing. It creates the permissions, the four system roles, the Superadmin group,
a demo company, and the superadmin account named by `SUPERADMIN_EMAIL` — **with
no password**. That is why `reset-superadmin` is a second step; it prints one,
once.

If `seed` runs cleanly and `reset-superadmin` still cannot find the account, the
row exists under a **different** address. The superadmin is created at a fixed id,
so changing `SUPERADMIN_EMAIL` after the first seed leaves the original row alone
and the new address never appears. Check what is actually there:

```bash
docker compose -f compose.prod.yaml exec postgres \
  psql -U "$POSTGRES_USER" -d reportly -c "select email, username from users limit 5;"
```

Then either set `SUPERADMIN_EMAIL` back to that address and restart the API, or
update the row to the address you want. It is the same account either way.

Worth confirming the variable arrived at all — an unset one silently falls back to
its default, which is a different address again:

```bash
docker compose -f compose.prod.yaml exec api printenv SUPERADMIN_EMAIL
```

### "Cannot find module '@reportly/shared/dist/index.js'" when running the CLI

You are running the **development** command on a server:

```bash
pnpm --filter @reportly/api cli reset-superadmin     # source, needs a build
```

That runs TypeScript from source, and `apps/api` imports `@reportly/shared`
through its compiled output — which nothing has built on a deployment host. Use
the container, which already has everything compiled:

```bash
docker compose -f compose.prod.yaml exec api node dist/cli/index.js reset-superadmin
```

Every CLI command works that way on a server: `migrate`, `seed`, `doctor`,
`reset-superadmin`, `reset-2fa`, `storage:migrate`.

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

1. **System → Messages** is the first place to look. Every message Reportly sends
   is recorded there with its status, and a failed one carries **the provider's own
   refusal, word for word**. That is usually the entire diagnosis: "API key not
   authorized for this domain: example.com" says exactly what to change, and no
   amount of reading SMTP settings would have found it.
2. Check the SMTP variables. In development, mail goes to Mailpit
   (<http://localhost:8025>), never to a real inbox.
3. **Logs → Search**, filter `feature` = `email`.
4. If Redis was down, queued jobs are gone. Re-send the invitation.

> **A connection test is not a delivery test.** `cli doctor` reporting that
> `smtp.example.com:465 accepted the connection` proves the relay is reachable and
> nothing more. A provider can accept the TCP connection and refuse every message
> afterwards — which is precisely what happened on one installation for a week.

### Writes are being refused with 409 in one company

Check whether that company is deactivated (**Companies → _name_**). A deactivated
company refuses every write to its own data — the guarded paths are listed in
`features/companies/scoped-routes.ts` — while leaving reads, exports and the app's
own administration (users, settings, groups, roles, and reactivating the company)
working. **Reactivate** lifts it immediately; the status is cached for 30 seconds,
and that cache is dropped the moment the status changes.

### Someone cannot sign in

- **Wrong password five times?** They are throttled. The limit counts **failed**
  sign-ins for that account from that address — so one person's mistakes never
  refuse a colleague's correct password, even on the same office connection, and a
  sign-in that succeeds clears the count.
  - **See who is stuck:** **Users** shows a **Locked out** badge in the _Sign-in_
    column, for anybody holding `users:manage-2fa`.
  - **Let them back in:** **Users → _the user_ → Security → Release**. Audited.
  - **From the command line**, when nobody can reach the screen:
    `pnpm --filter @reportly/api cli unlock <username|email|ip>` — the IP form
    releases a whole site behind one gateway.
  - Or wait: the window clears on its own (default 60 seconds).
  - The ceiling and window are **Settings → Authentication**.
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
