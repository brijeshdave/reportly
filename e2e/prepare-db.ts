// Author: Brijesh Dave <https://github.com/brijeshdave>
// Builds the e2e databases from nothing: drop, create, migrate, seed, then set a
// known superadmin password.
//
// It runs as the first half of the API server's own start command rather than from
// Playwright's globalSetup, because the server cannot boot against a database that
// does not exist yet — and globalSetup is not guaranteed to run before the server is
// launched. Making the start command do it removes the ordering question entirely.
//
// Dropping is only safe because these databases are ours alone (see config.ts). It
// is also the point: every run starts from the seed, so no run inherits whatever the
// one before it left behind.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { ADMIN_URL, E2E_APP_DB, E2E_LOG_DB, E2E_PASSWORD, apiEnv } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "..", "apps", "api");

function api(command: string, input?: string): void {
  execSync(command, {
    cwd: apiDir,
    encoding: "utf8",
    env: { ...process.env, ...apiEnv() },
    ...(input === undefined ? { stdio: ["ignore", "inherit", "inherit"] } : { input }),
  });
}

async function provision(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    for (const name of [E2E_APP_DB, E2E_LOG_DB]) {
      // A connection left open by a crashed previous run would block the drop.
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [name],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await admin.end();
  }
}

await provision();
api("pnpm cli migrate");
api("pnpm cli seed");
api("pnpm cli reset-superadmin --password-stdin", E2E_PASSWORD);
console.log(`e2e databases ready (${E2E_APP_DB}, ${E2E_LOG_DB}).`);
