# Contributing

Thanks for considering it. This document is the short version of how the project
is built, so your first pull request is not a surprise for either of us.

## Contributor Licence Agreement

Opening a pull request signals your agreement to the [CLA](CLA.md). It is one page.
In short: you own what you contribute, you licence it to the project, and you keep
your copyright.

## Getting set up

```bash
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

docker compose up -d                                 # Postgres, Redis, Mailpit
pnpm --filter @reportly/api cli migrate
pnpm --filter @reportly/api cli seed
pnpm --filter @reportly/api cli reset-superadmin
pnpm dev
```

Full detail in [docs/installation.md](docs/installation.md).

## Before you open a pull request

```bash
pnpm turbo run typecheck lint test build      # everything, in one go
pnpm --filter @reportly/api test:integration  # needs Postgres + Redis running
pnpm format
```

CI runs exactly these. Green locally means green on the pull request.

## How the code is organised

```
apps/api        Fastify API. routes -> service -> repo.
apps/web        React app. components -> services -> http.
packages/shared Contracts both sides agree on.
```

Four conventions carry most of the weight:

**Shared contracts are shared.** A type, a Zod schema, a permission string or an
error code that both sides need lives in `packages/shared`. Never re-declare one.
If the API and the web app can disagree about something, eventually they will.

**Only the repository layer touches the database.** Routes call services, services
call repositories. A service that imports Drizzle is a bug.

**Every external call gets its own module.** `core/mail`, `core/queue`,
`core/redis`, and on the web side `services/*.ts`. No component calls `fetch`; no
service opens a connection.

**Tests live in a `tests/` folder inside the thing they test.**
`features/users/tests/`, `components/auth/tests/`, and so on. Never beside the
source file.

## Writing code

- Every source file starts with an author header and a one-line statement of what
  it is for.
- Comment the _why_, not the _what_. A comment explaining a constraint the code
  cannot express is worth writing; one narrating the next line is not.
- Match the surrounding style. The linter and formatter settle everything else.

## Writing tests

A test should fail for a reason someone would care about. Prefer pinning behaviour
that a future change could plausibly break — an invariant, a boundary, an error
path — over asserting that a function returns what it just computed.

Unit tests (`*.test.ts`) run without infrastructure. Anything needing a database is
an integration test (`*.integration.test.ts`) and runs against a dedicated test
database, created for you.

## Commits and pull requests

- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Small commits that each do one thing. The body explains why, not what.
- Fill in the pull request checklist. It mirrors what a reviewer checks anyway.

## Reporting bugs and asking for features

Use the issue templates. A bug report that includes the version, what you expected,
what happened, and how to reproduce it can be fixed. One that does not, usually
cannot.

Security vulnerabilities are different: do not open an issue. See
[SECURITY.md](SECURITY.md).
