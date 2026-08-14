// Author: Brijesh Dave <https://github.com/brijeshdave>
// Drizzle client for the log database. Uses the dedicated log connection pool so
// log writes never contend with application queries.
import { drizzle } from "drizzle-orm/node-postgres";

import { logPool } from "@/core/db/pool.js";
import * as schema from "@/core/logdb/schema.js";

export const logDb = drizzle(logPool, { schema });

export { schema };
