// Author: Brijesh Dave <https://github.com/brijeshdave>
// Load a production backup into a development database, and make it safe in the
// same breath.
//
// The order is the whole design: restore and scrub are one command and one run,
// because the window between them is a development server holding live data with
// its reminder cron and six notification channels still pointed at real people.
// There is no "restore now, tidy up after" mode on purpose.
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { scrubForDevelopment, DEV_PASSWORD } from "@/features/backups/dev-scrub.js";
import {
  forwardPasswordThroughDocker,
  pgTarget,
  redactSecrets,
} from "@/features/backups/pg-connection.js";
import { env } from "@/core/env.js";
import { logger } from "@/core/logger.js";
import { pgRestoreArgv, runCapture } from "@/features/backups/service.js";

/** Typed by the operator, so this can never be a mistyped flag. */
const CONFIRMATION = "overwrite my development database";

export interface RestoreDevOptions {
  /** Path to a `pg_dump -Fc` file, as taken by the Backups screen. */
  file: string;
  /** The confirmation phrase, typed. */
  confirm?: string;
  /** Also restore the log database from this second dump. Off unless asked. */
  logsFile?: string;
}

/**
 * Every reason this must not run, checked before anything is touched.
 *
 * Deliberately several overlapping checks rather than one clever one: this command
 * drops a database, and the cost of a false refusal is a flag, while the cost of a
 * false permission is somebody's production data.
 */
function assertSafeTarget(): void {
  if (env.NODE_ENV === "production") {
    throw new Error("restore:dev refuses to run with NODE_ENV=production.");
  }
  if (env.ALLOW_DEV_RESTORE !== "true") {
    throw new Error(
      "Set ALLOW_DEV_RESTORE=true to allow this. It wipes the database named by DATABASE_URL.",
    );
  }
  // A production URL reaching a development box is the realistic accident — a
  // copied .env, a shared secret store — and NODE_ENV would not catch it.
  const url = env.DATABASE_URL;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  const localish =
    host === "localhost" || host === "127.0.0.1" || host === "postgres" || host === "db";
  if (!localish) {
    throw new Error(
      `DATABASE_URL points at "${host}", which is not a local database. ` +
        "restore:dev only ever writes to one on this machine.",
    );
  }
}

/** pg_restore into the target, replacing what is there. */
async function restoreInto(databaseUrl: string, dump: Buffer, label: string): Promise<void> {
  const [cmd, ...prefix] = forwardPasswordThroughDocker(pgRestoreArgv());
  const target = pgTarget(databaseUrl);
  const { code, stderr } = await runCapture(
    cmd!,
    [...prefix, "--clean", "--if-exists", "--no-owner", "--no-privileges", ...target.args],
    dump,
    target.childEnv,
  );
  // pg_restore reports non-zero for harmless "does not exist" noise on --clean, so
  // the exit code alone is not the signal; a real failure names an error.
  if (code !== 0 && /error:/i.test(stderr)) {
    logger.error(
      { feature: "backups", stderr: redactSecrets(stderr).slice(0, 2000) },
      `${label} restore failed`,
    );
    throw new Error(`${label} restore failed — see the log for pg_restore's output.`);
  }
}

/**
 * Read a dump named the way a person typed it.
 *
 * `pnpm --filter` runs the command inside `apps/api`, so a relative path typed at
 * the repository root resolves somewhere nobody meant and the command answers
 * with a bare ENOENT. pnpm leaves the real invocation directory in INIT_CWD;
 * relative paths are resolved against it, and a missing file says which path was
 * actually tried.
 */
async function readDump(file: string): Promise<Buffer> {
  const from = process.env.INIT_CWD ?? process.cwd();
  const path = isAbsolute(file) ? file : resolve(from, file);
  try {
    return await readFile(path);
  } catch {
    throw new Error(`No dump at ${path} — check the path, or give an absolute one.`);
  }
}

export async function restoreDev(options: RestoreDevOptions): Promise<void> {
  assertSafeTarget();
  if (options.confirm !== CONFIRMATION) {
    throw new Error(`Type --confirm "${CONFIRMATION}" to proceed. Nothing has been changed.`);
  }

  const dump = await readDump(options.file);
  // Not a hand-rolled mask: `:[^:@]*@` stops at the first `@`, so a password
  // containing one is only half hidden — which is the bug this whole change is about.
  console.log(`\nRestoring ${options.file} into ${redactSecrets(env.DATABASE_URL)}`);
  await restoreInto(env.DATABASE_URL, dump, "Database");

  // Straight on, in the same run. Nothing else may happen in between.
  const report = await scrubForDevelopment();

  if (options.logsFile) {
    console.log(`Restoring logs from ${options.logsFile}`);
    await restoreInto(env.LOG_DATABASE_URL, await readDump(options.logsFile), "Log database");
  }

  console.log(`
Restored and scrubbed.

  passwords set to ${DEV_PASSWORD}   ${report.passwordsReset}
  two-factor removed                 ${report.twoFactorRemoved}
  sessions dropped                   ${report.sessionsDropped}
  emails moved to @dev.local         ${report.emailsRewritten}
  phone numbers and handles cleared  ${report.contactDetailsCleared}
  provider tokens cleared            ${report.oidcTokensCleared}
  password history dropped           ${report.passwordHistoryDropped}
  pending verifications dropped      ${report.verificationsDropped}
  notification channels switched off ${report.notificationPreferencesReset}
  secrets removed                    ${report.settingsCleared.join(", ") || "none found"}
  log database                       ${options.logsFile ? "restored" : "left alone"}

Journal entries, routines, rotas, assets and points are all still here — that is
the point of the copy. Everything that could reach a real person is not.
`);
}
