# Security policy

## Reporting a vulnerability

**Please do not open a public issue.**

Report vulnerabilities privately through
[GitHub's private advisory form](https://github.com/brijeshdave/reportly/security/advisories/new).

Include what you can: the version or commit, a description, and the steps to
reproduce. A working proof of concept helps, but a clear description of the flaw
is enough to start.

You can expect an acknowledgement within a few days, and an assessment shortly
after. If the report is accepted, we will agree a disclosure timeline with you and
credit you in the advisory unless you prefer otherwise.

## Supported versions

Reportly is pre-1.0. Only the latest release receives security fixes.

## Deploying safely

A default deployment is not a safe deployment. Two things must be right:

- **`BETTER_AUTH_SECRET`** signs session cookies. It has a development default. If
  you leave it, anyone who reads this repository can forge a session for your
  installation. The production compose file refuses to start without it; other
  deployment methods do not, so set it.
- **Serve Reportly over TLS.** Sessions are cookie-based.

Beyond that:

- Run `cli reset-superadmin` and store the printed password somewhere safe. It is
  shown once.
- Restrict `CORS_ORIGIN` to the origin you serve the web app from.
- Turn on two-factor authentication for administrators.
- Leave `METRICS_ENABLED` off unless the metrics endpoint is on a private network.

See [Operations](docs/operations.md) for the rest.

## What Reportly already does

For reviewers, and so you know what not to re-report:

- Passwords are hashed by better-auth. The configured policy is enforced by the
  server on every path that sets one, not only in the browser. That includes reuse
  (only hashes of previous passwords are kept) and expiry, which locks a stale
  password out of every endpoint but the one that changes it.
- Sign-in, sign-up and password-reset requests are rate limited per IP.
- Password reset gives the same answer for a known and an unknown address, so the
  form cannot be used to enumerate accounts.
- SSO logins link to an existing account only when its email is **verified**.
- Permissions are checked on the server for every request. The UI hides what you
  cannot use, but hiding is not the enforcement.
- Deactivating a user takes effect immediately: their existing sessions are revoked,
  a new sign-in is refused even with the correct password, and any session that
  somehow survives is rejected on the next request.
- Company scope is taken from the `X-Company-Id` header and re-checked against the
  caller's groups. The client cannot widen its own scope.
- Request bodies on authentication routes are never logged, even in debug mode.
- Log output is redacted for known credential fields.
- The audit trail is append-only: the API exposes no path that edits or deletes it.
- There is exactly one way to be an administrator: the permissions your groups
  grant. No parallel role column, no impersonation, no unaudited admin surface.
- Session tokens never appear in a URL, so they are never written to the logs.
- Client secrets for SSO providers are never returned by the API, only whether one
  is set.
