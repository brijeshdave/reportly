// Author: Brijesh Dave <https://github.com/brijeshdave>
// Postgres connection pools: the app database and the separate log database.
// A short connection timeout keeps readiness checks fast when the DB is down.
import pg from "pg";

import { env } from "@/core/env.js";

const poolOptions = { connectionTimeoutMillis: 3000 };

export const appPool = new pg.Pool({ connectionString: env.DATABASE_URL, ...poolOptions });
export const logPool = new pg.Pool({ connectionString: env.LOG_DATABASE_URL, ...poolOptions });

/** Ping a pool with `SELECT 1`; returns true when reachable. */
export async function pingPool(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/** End both pools (process shutdown / test teardown). */
export async function closePools(): Promise<void> {
  await Promise.allSettled([appPool.end(), logPool.end()]);
}
