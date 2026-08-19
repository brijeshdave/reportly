# FAQ — developing and operating Reportly

For people changing the code or running the server. If your question is about
using the app, see the [user FAQ](../user/faq.md).

---

## Getting set up

### What do I need?

Node 24+, pnpm 11+ (`corepack enable`), Docker. Then:

```bash
pnpm install
pnpm app:infra    # Postgres, Redis, Mailpit, then the API and web app
```

`pnpm app` alone skips the infrastructure if you already have it running.

### The API will not start and complains about an environment variable

Working as intended. Every variable is validated once, in `core/env.ts`, and the
process refuses to boot rather than run half-configured. The message names the
variable. `docs/reference/environment.md` is generated from that same schema, so
it is never out of date.

### `pnpm dev` runs but the browser cannot reach it

On Windows, Hyper-V and Docker Desktop reserve blocks of TCP ports and the blocks
move after a reboot. The dev server starts and serves fine inside WSL while
`localhost:<port>` refuses from the browser. Check with
`netsh interface ipv4 show excludedportrange protocol=tcp` and pick a port
outside every listed range.

---

## Working in the codebase

### Where does a new feature go?

`apps/api/src/features/<name>/`, with a fixed layering:

```
routes.ts    HTTP, the Zod schema, guards, audit
service.ts   business rules
repo.ts      the only file that touches Drizzle
tests/       beside the feature, never beside the source file
```

The web app mirrors it under `apps/web/src/routes/<name>/`, with every external
call in `src/services/<resource>.ts`. No `fetch` in a component.

### How do I add an optional module?

An **optional module** is a feature a company can switch off — cartridges is the
first, and the pattern is meant to be copied. Four pieces, and the last one is
what makes it a module rather than a feature with a hidden menu:

1. **A company-overridable setting.** A `SettingDef` in the shared registry with
   `companyOverridable: true`. Companies → Modules reads and writes it through
   `/companies/:id/settings`, which takes `companies:update` — administering a
   company should not require the keys to the server's password policy.
2. **`requireModule()` in every route**, resolving the company id. It throws
   **404, not 403**: "you may not" tells somebody the feature is there and they
   need a grant, which sends them to their administrator asking for the wrong
   thing. For a company that does not do this work, it genuinely is not there.
3. **`/me` reports it** under `modules`, and the sidebar drops the whole nav
   group. Read it through the settings registry, never by importing the feature.
4. **A static isolation guard** — `features/parts/tests/isolation.test.ts` is the
   model. Nothing outside the module may import it except the route
   registration; the module may import no other feature; every route must go
   through the module check. All three are read out of the source, because the
   edge that breaks this gets added by somebody in a hurry next year, not today.

Reach the rest of the app through `core/` only. Cartridges writes to the shared
point ledger and reads the device register, and both are tables in `core/db`
touched through its own repos — never another feature's service.

### Why can I not just import the schema in both places?

You can — from `@reportly/shared`. What you must not do is _re-declare_ it. A
type, a Zod schema, a permission constant, an error code: one definition, both
consumers. The same `can()` that guards an API route hides the nav entry.

### Do I need to write the OpenAPI docs?

No, and you should not. Every route declares a Zod `schema` with `params`,
`querystring`, `body`, `response`, `tags` and `summary`. That does double duty:
Fastify validates against it at runtime, and `core/docs.ts` turns it into the
spec at `/api/v1/docs`. Hand-maintained API docs rot; generated ones cannot.

One gotcha: a route parameter that should 404 rather than 400 must be
`z.string()` and checked in the handler, or the schema rejects it first.

### Why do departments carry a `path` and a `companyName`?

Because a picker rendering `d.name` is ambiguous, and it is ambiguous in a way the
server is in a much better position to resolve than every caller is.

`GET /departments` answers flat and the tree lives in `parentId`, so any client
that wants to show where a department sits has to assemble the tree itself. Two
did, badly: both recursed into a `children` field the payload has never had, so
they indented nothing while looking like they handled nesting. `path`
(`Engineering › Platform › Backend`) is built once in the service — the same
cycle-guarded walk the spreadsheet export uses — and every consumer gets it right.

`companyName` on `GET /users/:id/departments` answers a different problem. That
route deliberately returns memberships across **every** company, and
`departments_company_name_unique` is on `(company_id, name)` — unique within a
company, not across. So somebody in a "Maintenance" at two companies got the same
word twice with nothing to choose by. The company is the only thing that separates
them, so it travels with the row.

Note which fix applies where. Only lists that genuinely span companies show the
company; a form creating something company-scoped filters to the active company
instead, because a department it cannot post to is not a choice — the API rejects
it, and it used to sit in the dropdown looking exactly like the one that works.

### Why is `schedules.location_id` nullable, and what does NULL mean?

NULL is the **central rota** — the department's travelling staff — not "unknown"
and not "all sites". That is why the uniqueness is
`UNIQUE NULLS NOT DISTINCT (department_id, location_id, year, month)`: without
`NULLS NOT DISTINCT`, Postgres treats every NULL as its own value and a department
could hold any number of central rotas for one month.

The same trap sits in the query layer. `eq(col, null)` is never true in SQL, so
looking a rota up with a null site has to use `IS NULL` — get that wrong and the
month reads as "no rota yet" and offers to start a second one.

Two rules decide who is on a rota, and both are in `rosterFor`:

- a site's rota holds the people whose membership covers that site, and a
  membership covering _no_ sites means all of them (the meaning "no sites" already
  has everywhere else);
- **plus anyone already holding a cell on it**, whatever the rule says now. That
  second clause is not politeness. Every rota built before sites existed landed on
  the central rota in the migration, and a roster computed purely from the rule
  would render those months empty — the cells still in the table, with no row to
  show them against.

Creating a rota therefore refuses to guess: if the company has any sites, the
request must name one or pass `central: true`. "No site" would otherwise silently
mean the central rota, and a department's ordinary staff are not on it — the month
would open empty and read as a bug rather than a choice.

### Why do central staff have a flag instead of "no sites"?

Because "no sites" already means _all_ sites. Inferring travelling staff from an
empty site list would reclassify everybody an administrator had not finished
placing, and quietly move them off the rotas they are on.

`department_users.is_central` is explicit, and the two are kept from disagreeing:
setting the flag clears the site list, and the site picker goes quiet.

### How do I change the database?

Edit `core/db/schema.ts` — one file, because drizzle-kit loads it outside the TS
path resolver. Then write the migration **by hand**:

1. Add `apps/api/drizzle/NNNN_short_name.sql`, using the next number.
2. Add a matching entry to `apps/api/drizzle/meta/_journal.json` — `idx`, `tag`
   (the filename without `.sql`) and a `when` larger than the entry before it.
   The migrator reads that journal, not the directory listing, so a file with no
   entry is silently never applied.
3. `pnpm --filter @reportly/api db:migrate` to apply it.

`db:generate` is left in `package.json` but is not used here: drizzle-kit cannot
round-trip this schema, and hand-written SQL is also what lets a migration carry
a back-fill beside its DDL.

### What is `0000_baseline.sql`, and may I edit it?

It is the whole schema as one file, and **no**.

The schema was built over eighty-one migrations. For publishing, those were
replaced by a single baseline generated with `pg_dump --schema-only` from a
database migrated through the full original sequence — so a fresh install creates
the tables as they are rather than replaying every column that was ever added and
later dropped.

It carries the **original first migration's timestamp**, deliberately. Drizzle
decides what to run by comparing the journal's `when` against the newest applied
row and nothing else, so a database that already ran the old sequence sees a
baseline older than its last migration and skips it untouched. Only a database
with nothing applied runs it.

Change the schema the ordinary way — a new numbered migration on top. Editing the
baseline would rewrite history for fresh installs while doing nothing to any
database that already exists, which is the worst of both.

### Why did my re-seed not change the role?

It should now: system roles are **reconciled** against their definition, so
removing a permission removes the grant. That was not always true — the seed used
to insert and never delete, so a role's grants could only grow. Roles an
administrator cloned are deliberately untouched.

### A test is failing that I did not touch

Several static guards fail the build on purpose, and each names the problem:

- `core/db/tests/scoped-callers.test.ts` — a location-bearing repo whose read
  skips the scope helper. Scope it, or add an exemption **with a reason**.
- `core/db/seed/tests/permission-coverage.test.ts` — a permission enforced by
  nothing, or granted by no role. Wire it up, retire it, or exempt it with a
  reason.
- `features/parts/tests/isolation.test.ts` — something outside the cartridges
  module imports it, or one of its routes forgot `requireModule`. Either makes
  the module non-optional; see [adding one](#how-do-i-add-an-optional-module).
- `routes/tests/notification-links.test.ts` (web) — a notification links to a
  route the app does not declare. Emit `link: null` until the page exists rather
  than pointing at one that does not.

They exist because the same bug has happened four times: a column, a setting or a
permission that was written, displayed, and read by nothing. Do not delete the
assertion.

---

## Testing

### What kind of test do I write?

| Kind                    | Runs                                       | For                                      |
| ----------------------- | ------------------------------------------ | ---------------------------------------- |
| `*.test.ts`             | `pnpm test`, no infrastructure             | Pure logic, pure functions               |
| `*.integration.test.ts` | `test:integration`, needs Postgres + Redis | Routes, services, repositories           |
| `e2e/*.spec.ts`         | `test:e2e`, real browser                   | Flows spanning requests, cookies or time |

If it spans two requests, a browser, or time — 2FA, cookie behaviour, tail
polling — it belongs in `e2e/`. Unit and integration tests cover the logic; e2e
proves the seams.

### What does e2e deliberately NOT cover?

Two things, both on purpose.

**Backup and restore.** Restore replaces the database, and the e2e suite runs
serially against one shared stack — so a restore mid-run wipes the state every
later spec depends on. Taking a backup also needs `pg_dump` reachable from the
API host, which the test stack does not guarantee (see `PG_DUMP_CMD`). Both are
covered by `features/backups/tests/`, where the destruction is contained.

**Retrying and removing queue jobs.** Arranging a genuinely failed job means
breaking a worker on purpose; pausing `email` or corrupting a payload to force a
failure leaves every spec after it running against a damaged stack. The e2e specs
cover the screens — the list, pause/resume, a queue's schedules — and the API
tests cover the actions.

The rule behind both: an end-to-end test may not leave the stack worse than it
found it, because the next spec is still using it.

### Why do some specs take their own session?

Signing out revokes that session **on the server**, and the storage state the
suite shares points at exactly that token. So any spec that signs out would leave
whatever runs after it unauthenticated. Specs that sign anybody in or out declare
`test.use({ storageState: { cookies: [], origins: [] } })` and sign in themselves.

This was not theoretical: it cost eight specs the day a new one happened to sort
first alphabetically.

### Why is the integration suite serial?

`fileParallelism: false`. Suites share tables, and `resetDb()` truncates
everything before each test. Parallel files would race.

It runs in about eleven minutes. If that changes sharply, measure before
optimising — the last time it looked slow the obvious suspect (the seed) was 4%
of the cost, and truncating fifty-seven tables one statement at a time was the
other 96%.

### My web test passes alone and fails in the full run

Almost certainly timing under load, not a real failure — but check the actual
error before assuming. One that looked like a timeout turned out to be
`userEvent` typing characters out of order under contention, which is why every
`userEvent.setup()` here passes `{ delay: null }`.

---

## Running it in production

### How do I deploy?

`scripts/install-ubuntu.sh` on a fresh box; `scripts/upgrade.sh` thereafter. The
full walkthrough is [Deploying on Ubuntu](../ops/deployment-ubuntu.md).

### Is this install healthy?

```bash
cli doctor
```

Checks both databases, Redis, the SMTP connection, that the attachment store is
genuinely writable (it writes a probe, reads it back and deletes it — a missing
volume mount leaves a directory that exists but is read-only), and that
`pg_dump`/`pg_restore` exist and are at least the server's major version. Exits
non-zero, so a deploy script can gate on it.

### Where do attachments and backups live?

The `app-data` volume, mounted at `/data`. `STORAGE_LOCAL_DIR` and `LOG_DIR` both
point inside it. Without that volume they are written into the container and lost
on the next deploy — which is exactly what used to happen.

For object storage set `STORAGE_BACKEND=s3` and the `S3_*` variables, then run
`cli storage:migrate` to move the existing files. Changing the backend only
redirects new uploads; existing files keep working from where they are.

### Backups keep failing

Run `cli doctor`. The usual cause is `pg_dump` missing or older than the server —
the API image installs `postgresql18-client` for exactly this, and the client must
be at least the server's major version.

### Do I need to run migrations by hand?

No. The compose file runs them as a `migrate` service that `api` waits on with
`service_completed_successfully`, so the app cannot start against a schema it has
not migrated.

### How do I ship logs somewhere?

They are already JSON, one object per line, with a stable field set — point Loki,
Vector or ELK at stdout and they parse without configuration. The fields are
documented as a public interface; treat them as one.

To turn up one noisy area without raising the global level, set a per-feature
level under Settings → Logging.

### Something is wrong and I need more detail

Turn on debug mode (needs `debug:toggle`). It is per-user or system-wide, and it
expires on its own so nobody leaves it on.

---

### Which dependency upgrades are still waiting, and on what?

One is waiting and one is done. Neither was blocked on effort alone, so
re-deriving this from scratch is wasted work.

**TypeScript 7** — our code is ready. The whole workspace typechecks on 7.0.2 with
zero errors, and the build passes. What blocks it is `typescript-eslint`, whose
newest release still declares `typescript: <6.1.0` and refuses to load on 7 with
"typescript-eslint does not support TS 7.0". Taking TypeScript 7 today means
giving up linting entirely, which is a worse trade than waiting.

There is also nothing to buy yet. Timed cold on this repo, the API typecheck was
**15.0s on 5.9.3 and 16.1s on 7.0.2** — marginally slower, not the step change the
native compiler promises. So the case for taking it early is weaker than it looks:
re-check when typescript-eslint ships TS 7 support, and measure again then rather
than assuming the speed-up arrived.

**@tanstack/react-table 9** — done, 2026-08-11. Left here only as a record: it
was a rewrite rather than a bump (141 type errors at first contact), and the
package ships its own migration guide at
`node_modules/@tanstack/react-table/skills/migrate-v8-to-v9/SKILL.md`. Read that
before touching it again; it is an exhaustive rename map, not marketing.

## Releasing

### What has to be green?

```bash
pnpm turbo run typecheck lint test build
pnpm --filter @reportly/api test:integration
pnpm --filter @reportly/e2e test:e2e
pnpm format
```

Unit-green is not enough for anything touching a cross-cutting runtime concern.
A logging change once passed every unit test while silencing all logging, because
the only tests that touch that seam are integration ones.

### Why is zod still on 3?

Deferred deliberately. zod 4 moves 143 call sites across 66 files and rewrites the
internals two files here introspect (`describeSettingSchema`, `env-docs`). It
unlocks `fastify-type-provider-zod` 7 and is worth doing — as its own change,
with its own verification, not inside a dependency sweep.

`@tanstack/react-table` 9 and TypeScript 7 are held for the same reason.
