// Author: Brijesh Dave <https://github.com/brijeshdave>
// Applies pending migrations to the LOG database. Idempotent; invoked by the CLI
// alongside the app-database migrations.
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { logDb } from "@/core/logdb/index.js";

const migrationsFolder = fileURLToPath(new URL("../../../drizzle-log", import.meta.url));

export async function runLogMigrations(): Promise<void> {
  await migrate(logDb, { migrationsFolder });
}
