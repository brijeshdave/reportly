// Author: Brijesh Dave <https://github.com/brijeshdave>
// `cli seed:activity` — fill a date range with plausible work, on top of the master
// data already in this database.
//
// The guards are `restore:dev`'s, for the same reason: fiction written into a real
// database is not undone by an apology. An env flag has to be set on purpose, a
// production NODE_ENV refuses outright, and a DATABASE_URL pointing anywhere but this
// machine refuses too — because the realistic accident is a copied .env, which
// NODE_ENV would not catch.
import { env } from "@/core/env.js";
import {
  generateActivity,
  purgeActivity,
  type GenerateOptions,
  type Volume,
} from "@/core/db/seed/activity/generate.js";
import { describeInventory, takeInventory } from "@/core/db/seed/activity/inventory.js";

function assertSafeTarget(): void {
  if (env.NODE_ENV === "production") {
    throw new Error("seed:activity refuses to run with NODE_ENV=production.");
  }
  if (env.ALLOW_DEV_SEED !== "true") {
    throw new Error(
      "Set ALLOW_DEV_SEED=true to allow this. It writes invented journal entries, " +
        "tasks, rotas and points into the database named by DATABASE_URL.",
    );
  }
  const host = (() => {
    try {
      return new URL(env.DATABASE_URL).hostname;
    } catch {
      return "";
    }
  })();
  const localish =
    host === "localhost" || host === "127.0.0.1" || host === "postgres" || host === "db";
  if (!localish) {
    throw new Error(
      `DATABASE_URL points at "${host}", which is not a local database. ` +
        "seed:activity only ever writes to one on this machine.",
    );
  }
}

/** `--months 2` means "the two months ending today". */
function resolveRange(from?: string, to?: string, months?: string): { from: Date; to: Date } {
  const end = to ? new Date(`${to}T00:00:00.000Z`) : new Date();
  if (from) return { from: new Date(`${from}T00:00:00.000Z`), to: end };

  const count = months ? Number(months) : 2;
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error("--months must be a positive number of months.");
  }
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - count);
  return { from: start, to: end };
}

export interface SeedActivityArgs {
  from?: string;
  to?: string;
  months?: string;
  volume?: string;
  seed?: string;
  dryRun: boolean;
  purge: boolean;
}

export async function runSeedActivity(args: SeedActivityArgs): Promise<void> {
  assertSafeTarget();

  if (args.purge) {
    const removed = await purgeActivity();
    console.log(
      `Purged generated data: ${removed.entries} journal entries, ${removed.tasks} tasks, ` +
        `${removed.downtime} downtime records (and everything that hangs off them).`,
    );
    return;
  }

  const range = resolveRange(args.from, args.to, args.months);
  const volume = (args.volume ?? "normal") as Volume;
  if (!["light", "normal", "heavy"].includes(volume)) {
    throw new Error("--volume must be light, normal or heavy.");
  }

  // What the master data can support, before anything is written. On its own this is
  // the answer to "why is that report empty?", which is worth printing every time.
  const inventory = await takeInventory();
  console.log("");
  for (const line of describeInventory(inventory)) console.log(line);
  console.log("");

  const options: GenerateOptions = {
    from: range.from,
    to: range.to,
    volume,
    seed: args.seed ? Number(args.seed) : range.from.getUTCDate() + range.to.getUTCMonth() * 31,
  };

  const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000);
  console.log(
    `Generating ${volume} activity for ${days} days ` +
      `(${range.from.toISOString().slice(0, 10)} → ${range.to.toISOString().slice(0, 10)}), seed ${options.seed}.`,
  );

  if (args.dryRun) {
    console.log("--dry-run: nothing written.");
    return;
  }

  const counts = await generateActivity(options);
  console.log("");
  console.log(`  journal entries      ${counts.entries}`);
  console.log(`  scores               ${counts.scores}`);
  console.log(`  point awards         ${counts.awards}`);
  console.log(`  downtime records     ${counts.downtime}`);
  console.log(`  tasks                ${counts.tasks}`);
  console.log(`  routine completions  ${counts.routineCompletions}`);
  console.log(`  rota days            ${counts.scheduleDays}`);
  console.log("");
  console.log("Undo it with: cli seed:activity --purge");
}
