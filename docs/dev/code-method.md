# How the code is organised

The conventions this codebase actually holds itself to, and — more usefully — why
each one exists. Most were written down after something went wrong.

[Architecture](../architecture.md) covers the shape of the system; this page is
about working inside it.

## Where a thing goes

```
apps/api/src/core/         cross-cutting: env, logger, errors, db, logdb, auth,
                           settings, queue, mail, audit, history, redis, storage
apps/api/src/lib/          reusable helpers (list queries, rate limits, db errors)
apps/api/src/features/*/   routes.ts → service.ts → repo.ts, plus tests/
apps/web/src/services/     every call that leaves the browser
apps/web/src/lib/          pure helpers and hooks
apps/web/src/components/   shared UI
apps/web/src/routes/       one folder per screen area
packages/shared/src/       contracts: entities/, auth/, http/, settings/
```

Four rules decide which of those a new piece of code belongs in:

**A fact both tiers need lives in `packages/shared`.** A schema, a permission
constant, an error code, the list of allowed page sizes, a pure function like
`can()`. Never declare the same shape twice — the API and the web app import the
same one, so they cannot disagree about it.

**Only `repo.ts` touches Drizzle.** Routes do HTTP, services hold rules,
repositories own the SQL. This is what makes "where is this table read?" a
question with one answer, which matters when the answer needs a company filter
adding to it.

**Anything that leaves the process gets its own module.** SMTP, Redis, the
queues, the database, better-auth, object storage. Never inline a call to an
external service in a route or a service — one module per integration means one
place to swap, mock, or add a timeout.

**No `fetch` inside a React component.** Every call goes through
`src/services/<resource>.ts`, typed against the shared contracts.

## Tests live inside the feature

`features/users/tests/`, not beside the source. Two kinds:

- **`*.test.ts`** must run with no infrastructure at all.
- **`*.integration.test.ts`** gets Postgres and Redis, and runs under
  `pnpm --filter @reportly/api test:integration`.

Anything spanning two requests, a real browser, or time — two-factor, cookies,
polling — belongs in `e2e/`, which drives the built app in a browser. The e2e
suite owns its own databases and ports, so it never touches your development
data.

The split matters more than it sounds. A cross-cutting change is **not** green on
a unit run: upgrading to Zod 4 passed typecheck, lint and every one of 550 unit
tests, and broke 228 integration tests.

## The guards that fail the build

Several tests exist purely to make a class of mistake impossible. Each one was
written after that mistake reached `main`. Do not weaken one to make a change
pass:

| Guard                      | Refuses                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `permission-coverage`      | A permission that nothing enforces, or that no role can hold. |
| `scoped-callers`           | A location-bearing repository that skips its scope helper.    |
| `queue/registry`           | A queue with no worker draining it.                           |
| `parts/isolation`          | Anything outside an optional module importing it.             |
| `env-example`              | An environment variable missing from `.env.example`.          |
| `no-stale-promises`        | UI text promising a feature as "coming soon".                 |
| `environment.md` generator | A committed reference that has drifted from the schema.       |

## The rule behind most of them

> **A stored value must be read by whatever it guards.**

Seven separate bugs here have been the same shape: a column, a setting or a
permission that was written, displayed, and acted on **nowhere**.

- A `status` column that deactivated nobody, so a disabled account kept working.
- A location scope computed, sent to the browser, and consulted by no query.
- A severity weight the interface described as driving the scoring maths, months
  after scoring stopped consulting it.

The last one is the instructive one, because the field was not merely unused —
the screen actively told administrators that changing it changed behaviour. A
dead field is untidy; a dead field the UI explains the effect of is a lie the
product tells.

So: when you add a stored value, add the code that acts on it **in the same
change**, and a test that exercises the acting path — not one that proves the
value round-trips.

The sharpest version of this came from the location scope. There was a helper
written specifically to apply it. It was exported, it was tested, and it had zero
callers.

> **A helper that guards nothing looks exactly like a helper that guards
> everything. Grep for callers, not for definitions.**

## Migrations

Hand-written SQL plus an entry in `apps/api/drizzle/meta/_journal.json`. The
migrator reads that journal rather than the directory, so **a file with no entry
is silently never applied**.

`drizzle-kit generate` is not used: it cannot round-trip this schema, and writing
the SQL by hand is also what lets a migration carry a data back-fill beside its
DDL.

`0000_baseline.sql` is the whole schema as one file and is not to be edited — see
the [developer FAQ](faq.md).

## Errors, and the trap in them

Every failure leaves the API as `{ error: { code, message, details? } }`.

Turning a database constraint violation into an HTTP status goes through
`lib/db-errors.ts` `isUniqueViolation()`. Do not read `err.code` off a thrown
error: Drizzle wraps driver errors and moves the Postgres code onto `.cause`, so
the obvious check silently never matches and a duplicate name becomes a 500.

A related trap, which has caused two runtime crashes: **`sql<Date>` on a raw
fragment is an assertion, not a conversion.** Postgres returns a string; the cast
only silences the compiler, and the crash arrives later at `.getTime()`. Select
the real column, or type it as `string` and convert deliberately.

## Before you call it done

```bash
pnpm turbo run typecheck lint test build
pnpm --filter @reportly/api test:integration
pnpm --filter @reportly/e2e test:e2e
pnpm format:check
```

`format:check` is a CI gate and the easiest of these to forget.

And then look at it. A passing test and a broken-looking screen coexist happily —
more than one fix here has been proven by its tests and been visibly wrong on the
page.
