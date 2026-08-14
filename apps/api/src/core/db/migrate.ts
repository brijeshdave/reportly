// Author: Brijesh Dave <https://github.com/brijeshdave>
// Applies pending SQL migrations to the app database. Idempotent: drizzle records
// applied migrations and skips them on re-run. Invoked via the CLI (cli migrate).
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db } from "@/core/db/index.js";

const migrationsFolder = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
}
