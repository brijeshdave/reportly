// Author: Brijesh Dave <https://github.com/brijeshdave>
// Vitest global setup: provision and migrate the dedicated test databases once
// before the integration suite. Runs in the main process (before test.env is
// applied to workers), so it builds its own connections explicitly.
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import {
  ADMIN_URL,
  TEST_APP_DB,
  TEST_DATABASE_URL,
  TEST_LOG_DATABASE_URL,
  TEST_LOG_DB,
} from "./config.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const logMigrationsFolder = fileURLToPath(new URL("../drizzle-log", import.meta.url));

async function ensureDatabase(admin: pg.Client, name: string): Promise<void> {
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (!rowCount) await admin.query(`CREATE DATABASE "${name}"`);
}

export default async function setup(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await ensureDatabase(admin, TEST_APP_DB);
    await ensureDatabase(admin, TEST_LOG_DB);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }

  const logs = new pg.Pool({ connectionString: TEST_LOG_DATABASE_URL });
  try {
    await migrate(drizzle(logs), { migrationsFolder: logMigrationsFolder });
  } finally {
    await logs.end();
  }
}
