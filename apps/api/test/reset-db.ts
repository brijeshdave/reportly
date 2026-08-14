// Author: Brijesh Dave <https://github.com/brijeshdave>
// Per-test reset: truncate every table, re-apply the seeds, flush the (test-only)
// Redis database, empty the local upload directory, and rebuild the auth instance.
// Flushing + reloading matters because settings are Redis-cached and baked into the
// better-auth instance — without it, a settings change in one test would leak into
// the next.
import { rm } from "node:fs/promises";
import { sql } from "drizzle-orm";

import { reloadAuth } from "@/core/auth/auth.js";
import { db } from "@/core/db/index.js";
import { reloadDebugConfig } from "@/core/debug/service.js";
import { seedDatabase } from "@/core/db/seed/index.js";
import { env } from "@/core/env.js";
import { logDb } from "@/core/logdb/index.js";
import { appLogs } from "@/core/logdb/schema.js";
import { reloadLogging } from "@/core/logger.js";
import { redis } from "@/core/redis.js";
import { localRoot } from "@/core/storage/local.js";

export async function resetDb(): Promise<void> {
  // ONE truncate naming every table, not a loop of one truncate each.
  //
  // This runs before every integration test — 436 times a run — and it was the
  // single most expensive thing in the suite: 2345ms against the ~94ms the seed
  // costs. TRUNCATE takes an ACCESS EXCLUSIVE lock and flushes, so fifty-seven
  // separate statements pay that fifty-seven times over. Naming them all in one
  // statement pays it once, and measures at 362ms — about fourteen minutes off a
  // twenty-six minute run.
  //
  // Deliberately no RESTART IDENTITY: the loop did not reset sequences either,
  // and this is meant to be a change in speed and nothing else.
  await db.execute(sql`
    DO $$
    DECLARE tables text;
    BEGIN
      SELECT string_agg(quote_ident(tablename), ', ')
        INTO tables
        FROM pg_tables WHERE schemaname = 'public';
      IF tables IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || tables || ' CASCADE';
      END IF;
    END $$;
  `);
  await seedDatabase();
  await logDb.delete(appLogs);
  await redis.flushdb();
  // Truncating the attachments table says nothing to the filesystem, so without
  // this every run leaves its uploads behind and the directory grows forever.
  await rm(localRoot(env.STORAGE_LOCAL_DIR), { recursive: true, force: true });
  await reloadAuth();
  await reloadLogging();
  await reloadDebugConfig();
}
