# Reportly documentation

Practical guides for developers and operators. The technical spec lives with the
code; this folder is standalone-readable.

## API reference

The HTTP API is documented as **OpenAPI 3**, generated automatically from the
route schemas — it is always in sync with the running code. Start the API
(`pnpm app`) and open:

| URL                                    | What                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------- |
| http://localhost:3000/api/v1/docs      | Swagger UI — browse and try every endpoint                              |
| http://localhost:3000/api/v1/docs/json | Raw OpenAPI 3 spec (import into Postman/Insomnia, or generate a client) |

The auth, SSO and 2FA endpoints are **included** in that spec, under
`/api/v1/auth/*`. They are described by better-auth and merged into ours at
startup, so there is one reference rather than two, and it works offline.

Frontend developers should treat these as the source of truth for request/response
shapes. The shared request/response **types and Zod schemas** are also importable
directly from [`@reportly/shared`](https://github.com/brijeshdave/reportly/tree/main/packages/shared/src) — prefer importing those
over re-declaring shapes.

### Conventions that keep the docs accurate

- Every feature route declares a Zod `schema` (`params` / `querystring` / `body` /
  `response`). These schemas are the single source of truth: Fastify uses them for
  runtime validation **and** they are transformed into the OpenAPI spec. Add or
  change a schema → the docs update on the next run. No hand-written spec to drift.
- Group endpoints with a `tags` entry and give each a one-line `summary`.
- Error responses use the shared envelope `{ error: { code, message, details? } }`.

## Auth quick reference

- Sign up: `POST /api/v1/auth/sign-up/email` `{ email, password, name }`
- Sign in: `POST /api/v1/auth/sign-in/email` `{ email, password }` → session cookie
- 2FA: enrol `POST /api/v1/auth/two-factor/enable`; a 2FA sign-in returns
  `{ twoFactorRedirect: true }`, then `POST /api/v1/auth/two-factor/verify-totp`
- Password reset: `POST /api/v1/auth/request-password-reset` `{ email }`
- SSO: `POST /api/v1/auth/sign-in/oauth2` `{ providerId, callbackURL }`
- Current user: `GET /api/v1/me` (send `X-Company-Id` to scope permissions)

Superadmin password is set with `pnpm --filter @reportly/api cli reset-superadmin`.

## The standard list query

Every paginated list endpoint (`/users`, `/groups`, `/roles`, `/companies`,
`/logs`, `/audit-events`, `/history/:entityType/:id`) accepts the same query:

| Param      | Meaning                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `page`     | 1-based, default 1.                                                                                           |
| `pageSize` | One of **5, 10, 20, 50, 100**. Omit it and the API applies the caller's own default, then the organisation's. |
| `sortBy`   | A whitelisted column. Anything else is rejected.                                                              |
| `sortDir`  | `asc` or `desc`.                                                                                              |
| `filters`  | A JSON array of `{ field, op, value }`.                                                                       |

`op` is one of `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `nin`, `contains`,
`startsWith`, `endsWith`.

The response carries the navigation metadata, so clients never recompute page
arithmetic:

```json
{
  "data": [],
  "page": 2,
  "pageSize": 20,
  "total": 137,
  "totalPages": 7,
  "firstPage": 1,
  "lastPage": 7,
  "previousPage": 1,
  "nextPage": 3,
  "hasPrevious": true,
  "hasNext": true
}
```

Two endpoints return a plain array instead, because their result is already
complete and access-scoped: `GET /locations` (one company's locations, selected by
the `X-Company-Id` header) and `GET /sso/enabled-providers`.

## Headers

| Header         | Sent by | Why                                                                                    |
| -------------- | ------- | -------------------------------------------------------------------------------------- |
| `X-Company-Id` | client  | Which company to act in. Permissions are resolved against it.                          |
| `x-request-id` | client  | Traces one action through the API, its jobs, and the audit trail. Generated if absent. |

## Public endpoints

Reachable without a session, because the sign-in and sign-up screens need them
before one exists:

- `GET /api/v1/password-rules` — the rules a new password must satisfy. Only the
  string rules; expiry and reuse counts are internal.
- `GET /api/v1/sso/enabled-providers` — ids and labels only, never a client id,
  secret or issuer.
- `GET /api/v1/health`, `GET /api/v1/ready`

## Operating

See [the documentation index](index.md) for installation, configuration and
operations.
