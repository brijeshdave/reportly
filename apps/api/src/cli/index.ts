// Author: Brijesh Dave <https://github.com/brijeshdave>
// Admin CLI entry point. Subcommands run maintenance tasks against the app DB and
// then exit.
//
//   pnpm --filter @reportly/api cli migrate
//   pnpm --filter @reportly/api cli seed
//   pnpm --filter @reportly/api cli reset-superadmin [--password-stdin]
//   pnpm --filter @reportly/api cli reset-2fa <email>
//   pnpm --filter @reportly/api cli storage:migrate [--dry-run]
//   pnpm --filter @reportly/api cli doctor
//   pnpm --filter @reportly/api cli backup:database
//   pnpm --filter @reportly/api cli seed:demo
import { eq } from "drizzle-orm";

import { runDoctor } from "@/cli/doctor.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { migrateStorage } from "@/core/storage/migrate.js";
import { resetTwoFactor } from "@/core/auth/two-factor.js";
import { db } from "@/core/db/index.js";
import { runMigrations } from "@/core/db/migrate.js";
import { seedDemoCartridges } from "@/core/db/seed/demo-cartridges.js";
import { appPool, logPool } from "@/core/db/pool.js";
import { users, companies } from "@/core/db/schema.js";
import { seedDemoData } from "@/core/db/seed/demo.js";
import { seedDatabase } from "@/core/db/seed/index.js";
import { env } from "@/core/env.js";
import { runLogMigrations } from "@/core/logdb/migrate.js";
import { redis } from "@/core/redis.js";
import { runDatabaseBackup } from "@/features/backups/service.js";

const command = process.argv[2];

const USAGE =
  "Usage: cli <migrate|seed|reset-superadmin [--password-stdin]|reset-2fa <email>|" +
  "storage:migrate [--dry-run]|doctor|backup:database|seed:demo|seed:demo-cartridges [companyId]>";

/**
 * The company to seed into when none was named.
 *
 * Only when there is exactly one: guessing which of several a demo fleet belongs
 * in is the kind of assumption that puts invented data in the wrong tenant.
 */
async function onlyCompanyId(): Promise<string> {
  const rows = await db.select({ id: companies.id, name: companies.name }).from(companies);
  if (rows.length === 1) return rows[0]!.id;
  throw new Error(
    rows.length === 0
      ? "No companies exist yet — run `cli seed` first."
      : `Name the company: ${rows.map((row) => `${row.name} (${row.id})`).join(", ")}`,
  );
}

/**
 * Moves every attachment onto the configured storage backend.
 *
 * Changing STORAGE_BACKEND only redirects new uploads; the existing files keep
 * working from where they are. This is the second half — run it after the switch.
 */
async function migrateStorageFiles(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    dryRun
      ? `Dry run — moving nothing. Target backend: ${env.STORAGE_BACKEND}\n`
      : `Moving attachments onto: ${env.STORAGE_BACKEND}\n`,
  );

  const result = await migrateStorage({ dryRun, onProgress: (m) => console.log(m) });

  console.log(
    `\n${dryRun ? "Would move" : "Moved"}: ${dryRun ? result.skipped : result.moved}` +
      `   Failed: ${result.failed.length}`,
  );
  for (const failure of result.failed) {
    console.error(`  ! ${failure.filename} (${failure.id}): ${failure.reason}`);
  }
  // A partial move must not look like a success to whatever is running this.
  if (result.failed.length > 0) {
    console.error(
      "\nThe files above were left where they were — nothing was deleted. Fix the cause and re-run; " +
        "this command is safe to run again.",
    );
    process.exitCode = 1;
  }
}

/**
 * Reads a password from stdin for `--password-stdin`.
 *
 * Stdin, and not an argument: a password on the command line is read by anyone who
 * runs `ps`, and lands in the shell history of whoever typed it. This is the same
 * bargain `docker login --password-stdin` makes, and for the same reason.
 */
async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  // A trailing newline is what `echo` adds, not part of what was meant.
  const password = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
  if (password === "") throw new Error("--password-stdin was given but stdin was empty.");
  return password;
}

/**
 * The last way back into an account whose second factor is gone.
 *
 * The web app has an administrator action for this, but it cannot help the case
 * that matters most: the *only* superadmin, locked out of the app entirely, with
 * nobody left who could click it. This runs on the server, so it is gated by shell
 * access to the box — the same trust level as `reset-superadmin`.
 */
async function resetTwoFactorFor(email: string | undefined): Promise<void> {
  if (!email) {
    console.error(`reset-2fa needs an email address.\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const [user] = await db
    .select({ id: users.id, enabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.email, email));

  if (!user) {
    console.error(`No user with the email ${email}.`);
    process.exitCode = 1;
    return;
  }

  const wasEnabled = await resetTwoFactor(user.id);
  console.log(
    wasEnabled
      ? `\nTwo-factor removed from ${email}, and every session signed out.\nThey can sign in with their password and enrol again under Your account > Security.\n`
      : `\n${email} had no two-factor enrolled; nothing to remove. Their sessions were signed out anyway.\n`,
  );
}

async function main(): Promise<void> {
  switch (command) {
    case "migrate":
      await runMigrations();
      await runLogMigrations();
      console.log("Migrations applied (app + log databases).");
      break;
    case "seed":
      await seedDatabase();
      console.log("Seed complete.");
      break;
    case "reset-superadmin": {
      const fromStdin = process.argv.includes("--password-stdin");
      const chosen = fromStdin ? await readPasswordFromStdin() : undefined;
      const password = await resetSuperadmin(chosen);

      // Only echo a password the operator has not already got. Printing back one
      // they typed in just puts it on another screen and in another scrollback.
      console.log(
        fromStdin
          ? `\nSuperadmin password set for ${env.SUPERADMIN_EMAIL}.\n`
          : `\nNew superadmin password (shown once — store it now):\n\n    ${password}\n`,
      );

      // A new password is not a way in while a second factor still stands. Say so
      // here rather than let the operator discover it at the sign-in screen, with
      // the one command that would have helped nowhere in sight.
      const [superadmin] = await db
        .select({ enabled: users.twoFactorEnabled })
        .from(users)
        .where(eq(users.email, env.SUPERADMIN_EMAIL));
      if (superadmin?.enabled) {
        console.log(
          `Note: this account still has two-factor enabled, so sign-in will ask for a code.\n` +
            `If the authenticator and the recovery codes are both gone, run:\n\n` +
            `    cli reset-2fa ${env.SUPERADMIN_EMAIL}\n`,
        );
      }
      break;
    }
    case "reset-2fa":
      await resetTwoFactorFor(process.argv[3]);
      break;
    case "storage:migrate":
      await migrateStorageFiles();
      break;
    case "seed:demo":
      // Never part of `seed`: this is invented data, and it refuses to run on a
      // database that already holds journal entries.
      await seedDemoData();
      console.log(
        "\nDemo data seeded: eight people on a reporting line, an asset tree, devices,\n" +
          "sixty journal entries over ten weeks, and the points ledger behind them.\n\n" +
          "None of the demo accounts have a password — sign in as the superadmin.\n",
      );
      break;
    case "seed:demo-cartridges": {
      // Unlike `seed:demo`, this runs happily alongside real work: it adds only
      // cartridges and their history, built from the company's OWN models,
      // printers, service kinds and consumables. Every identifier is prefixed
      // DEMO- so it can be found and removed again.
      const companyId = process.argv[3] ?? (await onlyCompanyId());
      const result = await seedDemoCartridges(companyId);
      if (result.skipped) {
        console.log(`Nothing seeded: ${result.reason}.`);
      } else {
        console.log(
          `\n${result.created} demo cartridges seeded, each with tours of duty and services —\n` +
            "two of them fail early every time, so the health reports have something to find.\n\n" +
            "Remove them again with:\n" +
            "  DELETE FROM point_awards WHERE service_event_id IN (\n" +
            "    SELECT id FROM service_events WHERE part_id IN (\n" +
            "      SELECT id FROM parts WHERE identifier LIKE 'DEMO-%'));\n" +
            "  DELETE FROM parts WHERE identifier LIKE 'DEMO-%';\n",
        );
      }
      break;
    }
    case "doctor":
      // Exit non-zero on a failure so a deploy script can gate on it.
      if (!(await runDoctor())) process.exitCode = 1;
      break;
    case "backup:database": {
      // The same code path as a scheduled backup, so the result lands in the
      // Backups screen and obeys the same retention. That matters for the
      // pre-upgrade backup in scripts/upgrade.sh: an operator looking for it
      // afterwards finds it where every other backup is.
      const backup = await runDatabaseBackup(null);
      if (backup.status === "completed") {
        const mb = (backup.sizeBytes / 1024 / 1024).toFixed(1);
        console.log(
          `\nDatabase backup taken: ${backup.id} (${mb} MB). It is listed under Backups.\n`,
        );
      } else {
        console.error(`\nDatabase backup FAILED: ${backup.error ?? "unknown error"}\n`);
        process.exitCode = 1;
      }
      break;
    }
    default:
      console.error(`Unknown command: ${command ?? "(none)"}\n${USAGE}`);
      process.exitCode = 1;
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Every connection must be closed or the process never exits. `reset-superadmin`
    // reads the password policy, which goes through the Redis-backed settings cache.
    await appPool.end();
    await logPool.end();
    await redis.quit();
  });
