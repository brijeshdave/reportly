// Author: Brijesh Dave <https://github.com/brijeshdave>
// The Drizzle client for the app database, bound to the full schema. Repositories
// import `db` from here; nothing else talks to Postgres directly.
import { drizzle } from "drizzle-orm/node-postgres";

import { appPool } from "@/core/db/pool.js";
import * as schema from "@/core/db/schema.js";
import { incrementQueryCount } from "@/core/request-context.js";

export const db = drizzle(appPool, {
  schema,
  // Count queries per request so debug mode can report them.
  logger: { logQuery: () => incrementQueryCount() },
});

export { schema };
export type Database = typeof db;
