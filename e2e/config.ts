// Author: Brijesh Dave <https://github.com/brijeshdave>
// Where the e2e stack lives: its own databases, its own Redis index, its own ports.
//
// Its own *everything*, because the suite writes as it runs — users, departments,
// reports — and it used to write them into the development database, which then
// carried "Ada Lovelace" and "E2E Dept-…" for good. Tests that leave a mess in the
// database you develop against are a tax on every day after they were written.
//
// The integration suite already does this (see apps/api/test/config.ts); these are
// separate databases again rather than shared ones, so `pnpm test:integration` and
// `pnpm test:e2e` can run at the same time without truncating each other's rows.
const base = process.env.E2E_PG_BASE ?? "postgres://reportly:reportly@localhost:5432";

export const E2E_APP_DB = "reportly_e2e";
export const E2E_LOG_DB = "reportly_e2e_logs";

export const ADMIN_URL = `${base}/postgres`;
export const E2E_DATABASE_URL = `${base}/${E2E_APP_DB}`;
export const E2E_LOG_DATABASE_URL = `${base}/${E2E_LOG_DB}`;

/** Redis db 0 is dev, 1 is the integration suite; 2 is ours. */
export const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? "redis://localhost:6379/2";

/** Ports of our own, so a running `pnpm dev` is left alone. */
export const E2E_API_PORT = Number(process.env.E2E_API_PORT ?? 3100);
export const E2E_WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);

export const E2E_API_URL = `http://localhost:${E2E_API_PORT}`;
export const E2E_WEB_URL = `http://localhost:${E2E_WEB_PORT}`;

/**
 * The password the suite signs in with.
 *
 * The default satisfies the *shipped* password policy (12 characters, an uppercase
 * letter, a digit): this database is seeded fresh, so it has the shipped defaults,
 * and a shorter one would be refused at the login form with nothing saying why.
 */
export const E2E_PASSWORD = process.env.E2E_SUPERADMIN_PASSWORD ?? "E2eOnly!Passw0rd";

/**
 * The superadmin's name, pinned rather than inherited.
 *
 * apiEnv sets it, so the seed says this whatever a developer's own apps/api/.env
 * happens to say. A spec that hardcoded the name of the account in one person's
 * development database is how this was found.
 */
export const E2E_SUPERADMIN_NAME = process.env.SUPERADMIN_NAME ?? "Super Admin";

/**
 * Whether we are pointed at a stack somebody else built.
 *
 * CI sets BASE_URL at a stack it started itself, against a throwaway database. In
 * that world we must not launch servers or drop databases — we are a guest. Locally
 * BASE_URL is unset and the suite owns the whole stack.
 */
export function isExternalStack(): boolean {
  return Boolean(process.env.BASE_URL);
}

/** The environment the e2e API server runs with. */
export function apiEnv(): Record<string, string> {
  return {
    NODE_ENV: "development",
    PORT: String(E2E_API_PORT),
    DATABASE_URL: E2E_DATABASE_URL,
    LOG_DATABASE_URL: E2E_LOG_DATABASE_URL,
    REDIS_URL: E2E_REDIS_URL,
    // The browser talks to the web origin and Vite proxies /api, so same-origin —
    // but better-auth still builds absolute URLs from these, and CORS still checks.
    BETTER_AUTH_URL: E2E_API_URL,
    WEB_URL: E2E_WEB_URL,
    CORS_ORIGIN: E2E_WEB_URL,
    // Pinned so the seed is the same for everyone, whatever their own .env says.
    SUPERADMIN_NAME: E2E_SUPERADMIN_NAME,
    // Queue management is off by default, which means its routes are not mounted
    // and its screens do not exist — so a browser test of them needs it on. The
    // `off` and `read` states are covered where they belong, by an API test that
    // builds the app in each mode and asserts on 404 versus 401.
    QUEUE_ADMIN: "manage",
  };
}
