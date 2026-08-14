// Author: Brijesh Dave <https://github.com/brijeshdave>
// Connection strings for integration tests. Uses dedicated databases on the dev
// Postgres so tests never touch the app database.
const base = process.env.TEST_PG_BASE ?? "postgres://reportly:reportly@localhost:5432";

export const TEST_APP_DB = "reportly_test";
export const TEST_LOG_DB = "reportly_test_logs";

export const ADMIN_URL = `${base}/postgres`;
export const TEST_DATABASE_URL = `${base}/${TEST_APP_DB}`;
export const TEST_LOG_DATABASE_URL = `${base}/${TEST_LOG_DB}`;
// A dedicated Redis database so tests can flush caches without touching dev data.
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";
