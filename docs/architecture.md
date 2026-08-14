# Architecture

What the pieces are, how a request moves through them, and the handful of rules
that decide where new code goes.

This page is about the shape of the system. [How the code is
organised](dev/code-method.md) is about working inside it.

## The stack

| Piece             | What                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `apps/api`        | Fastify 5 on Node 24, ESM. The HTTP API, the background workers, the migrations and the CLI.    |
| `apps/web`        | React 19 with Vite 8 and Tailwind 4. TanStack Router, Query and Table; Recharts for the charts. |
| `packages/shared` | Zod schemas, the permission constants and `can()`, error codes, pure helpers.                   |
| `e2e`             | Playwright, driving the built app in a real browser against a real API.                         |
| `docs`            | These pages, and the site built from them.                                                      |

Postgres 18 holds the data, Redis 8 holds everything transient, and a second
Postgres database holds the logs.

## A request, end to end

```
browser
  │  session cookie, X-Company-Id, x-request-id
  ▼
web (nginx in production, Vite in development)
  │  proxies /api
  ▼
api ── onRequest ──► request id into AsyncLocalStorage
  │                  company context resolved from the header
  │                  permissions resolved for this caller in this company
  │
  ├─► routes.ts    HTTP, Zod validation, the permission guard, the audit row
  │     └─► service.ts   the rules
  │           └─► repo.ts   the only code that touches Drizzle
  │
  ├─► Postgres  reportly         application data
  ├─► Postgres  reportly_logs    logs, separate so their volume never touches the app
  ├─► Redis                      sessions, caches, rate limits, queues
  └─► BullMQ                     email, notifications, backups, maintenance, routine awards
```

The same `x-request-id` travels the whole way: into the log lines, into the audit
row, and — through `core/request-context.ts` and AsyncLocalStorage — into any
background job the request enqueues. One id answers "everything that happened
because of that click", including the job that ran a minute later.

## Why the log database is separate

Logs are the highest-volume thing the system writes and the least important thing
it stores. Given one database they compete with the application for connections,
for disk and for vacuum, and a busy afternoon of debug logging becomes an
application problem.

They have their own connection string, their own migrations, and their own
retention job. Point `LOG_DATABASE_URL` at the same server in a small
installation, or at a different one when logging outgrows the box. Nothing in the
application reads them, so losing them entirely costs you history and nothing
else.

## What Redis is doing

Four distinct jobs, which is worth knowing before sizing anything:

- **Sessions.** better-auth's secondary storage. This is what makes API instances
  interchangeable — see [Scaling](ops/scaling.md).
- **Caches.** Settings especially: they are read on nearly every request and
  written rarely, and an uncached settings read would be a query per request.
- **Rate limits.** Fixed windows, per IP, on the endpoints worth protecting.
- **Queues.** BullMQ's backing store.

The Redis database index in the URL is honoured, which is how the development,
test and e2e stacks share one Redis without colliding.

## The queues

Five, each with a worker:

| Queue           | Carries                                           |
| --------------- | ------------------------------------------------- |
| `email`         | Invitations, password resets, verification codes. |
| `notifications` | Delivery across the six channels.                 |
| `backup`        | Scheduled database and file backups.              |
| `maintenance`   | Log retention, and the periodic housekeeping.     |
| `routine-award` | Month-end routine compliance awards.              |

Work that can wait goes on a queue, so a request never blocks on SMTP or on
`pg_dump`. A queue missing from the registry fails the build — a queue nothing
drains looks exactly like a queue with nothing to do.

## The log contract

Every log line is one JSON object, on stdout and — when the file sink is on — in
`$LOG_DIR/app-YYYY-MM-DD.log`. These fields are stable: treat them as a public
interface, because a collector will. Redaction happens before serialization, so no
sink ever sees a secret.

| Field           | Meaning                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `time`          | ISO-8601 UTC timestamp                                                     |
| `level`         | `fatal｜error｜warn｜info｜debug｜trace`, as a word rather than a number   |
| `msg`           | The human-readable message                                                 |
| `reqId`         | The request id — the same value on the API line, its jobs, and client logs |
| `feature`       | The area: `api`, `auth`, `email`, `client`, `debug`, `maintenance`, …      |
| `userId`        | The actor, where one is known                                              |
| everything else | Free-form context, also stored as a `context` column in the log database   |

Loki, ELK and Vector can consume this without a parser you have to maintain.

## The layering rule

```
routes.ts → service.ts → repo.ts → Drizzle → Postgres
```

- **`routes.ts`** is HTTP: the Zod schema, the permission guard, the audit row.
- **`service.ts`** is the rules. It knows nothing about HTTP.
- **`repo.ts`** is the only code allowed to touch Drizzle.

The point of the last one is not purity, it is that "where does this table get
read?" has exactly one answer. Company scoping and location scoping are enforced
in repositories, and a static test fails the build when a location-bearing
repository skips its scope helper.

## Access, in one paragraph

Permissions are strings — `journal:read`, `settings:manage`. Roles bundle them.
Groups hold roles **and** the companies and locations those roles apply to. Users
get everything from their groups, which is why a new user has no access at all
until they are added to one.

The same `can()` from `packages/shared` is used by the API's guards, by the web
app's route guards, and by the `<Can>` component that shows or hides a button.
One implementation, three callers: the sidebar cannot offer a page the API would
refuse, because both ask the same question of the same code.

Separately, the **department tree carries a reporting line** — who reports to
whom. That chain, walked to any depth, decides whose journal entries you can see
and score. Rank is a label; the chain is the authority.

## Optional modules

Some features are not for everybody. Cartridges is the worked example: a company
that does not refill anything should never see the screens.

The pattern is fixed, and every future optional module should follow it:

1. A setting the company controls.
2. A `requireModule()` guard that throws **404, not 403**.
3. `/me` reports which modules are on, so the navigation can hide them.
4. A static test that fails the build if anything outside the module imports it.

404 rather than 403 because a company that does not use a module should not learn
that it exists. The isolation test is what keeps the module genuinely removable
rather than merely switched off.

A second switch works one level up: **the server**, not the company. Queue
administration is mounted only when `QUEUE_ADMIN` is set, so on an installation
that does not want it the routes do not exist at all.

## What is generated, and what is not

Three things regenerate themselves, and must never be hand-edited:

- **The OpenAPI spec** at `/api/v1/docs`, from the Zod schemas each route already
  declares for validation. One declaration, doing both jobs, so the reference
  cannot drift from the code.
- **`docs/reference/environment.md`**, from the environment schema. A test
  compares the committed file against the generator, so a new variable cannot
  ship undocumented.
- **`0000_baseline.sql`**, from a migrated database.

Everything else — including these pages — goes stale silently, which is why
documentation is part of the definition of done rather than a follow-up.
