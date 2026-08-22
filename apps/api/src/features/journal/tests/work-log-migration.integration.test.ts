// Author: Brijesh Dave <https://github.com/brijeshdave>
// Migration 0009, which rescues the work text already written on existing entries
// into the first item of their new timeline.
//
// Worth testing rather than trusting, for two reasons. It runs once against real data
// that nobody can re-create if it goes wrong; and the first draft had `A OR B AND NOT
// EXISTS`, which SQL reads as `A OR (B AND NOT EXISTS)` — so the guard against
// duplicating covered only half the rows, and a second run would have written every
// entry's work twice. That was caught by reading it. This catches the next one.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/core/db/index.js";
import { appPool, logPool } from "@/core/db/pool.js";
import { journalEntries, journalWorkLogs, userCompanies, users } from "@/core/db/schema.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const migrationFile = fileURLToPath(
  new URL("../../../../drizzle/0009_work_log_timeline.sql", import.meta.url),
);

afterAll(async () => {
  await appPool.end();
  await logPool.end();
});

beforeEach(async () => {
  await resetDb();
});

/** Run the migration the way drizzle does: one statement per breakpoint. */
async function replayMigration(): Promise<void> {
  const text = await readFile(migrationFile, "utf8");
  for (const statement of text.split("--> statement-breakpoint")) {
    if (statement.trim() === "") continue;
    await db.execute(sql.raw(statement));
  }
}

/** An entry as it looked before the timeline existed: work in the two text columns. */
async function entryWithWorkText(overrides: {
  workSummary?: string | null;
  workDetail?: string | null;
}): Promise<string> {
  const authorId = "work-migration-author";
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, authorId));
  if (!existing) {
    await db.insert(users).values({
      id: authorId,
      name: "Sam Operator",
      email: "sam@work-migration.test",
      username: authorId,
    });
    await db.insert(userCompanies).values({ userId: authorId, companyId: DEMO_COMPANY_ID });
  }

  const [row] = await db
    .insert(journalEntries)
    .values({
      companyId: DEMO_COMPANY_ID,
      authorId,
      kind: "issue",
      state: "submitted",
      title: "Belt snapped",
      reportDate: new Date("2026-08-01T09:00:00.000Z"),
      startedAt: new Date("2026-08-01T09:15:00.000Z"),
      endedAt: new Date("2026-08-01T10:05:00.000Z"),
      workSummary: overrides.workSummary ?? null,
      workDetail: overrides.workDetail ?? null,
    })
    .returning({ id: journalEntries.id });
  return row!.id;
}

async function itemsFor(reportId: string) {
  return db.select().from(journalWorkLogs).where(eq(journalWorkLogs.reportId, reportId));
}

describe("migration 0009 — rescuing the work already written", () => {
  it("turns an entry's work text into its first timeline item, with the times it had", async () => {
    const id = await entryWithWorkText({
      workSummary: "Replaced the drive belt",
      workDetail: "Spare from the east store.",
    });

    await replayMigration();

    const items = await itemsFor(id);
    expect(items).toHaveLength(1);
    expect(items[0]!.summary).toBe("Replaced the drive belt");
    expect(items[0]!.detail).toBe("Spare from the east store.");
    // Attributed to the author — the only person the old shape could have meant.
    expect(items[0]!.userId).toBe("work-migration-author");
    // Timed from the entry's own start and finish, the closest to a truthful
    // timestamp the old data holds.
    expect(items[0]!.startedAt?.toISOString()).toBe("2026-08-01T09:15:00.000Z");
    expect(items[0]!.finishedAt?.toISOString()).toBe("2026-08-01T10:05:00.000Z");
  });

  it("does not duplicate anything when it runs twice", async () => {
    // The precedence bug: with `A OR B AND NOT EXISTS`, an entry carrying a summary
    // skipped the guard entirely and would have been copied again on every run.
    const id = await entryWithWorkText({ workSummary: "Replaced the drive belt" });

    await replayMigration();
    await replayMigration();

    expect(await itemsFor(id)).toHaveLength(1);
  });

  it("gives a detail-only entry a usable line rather than an empty one", async () => {
    // `summary` is NOT NULL, and an entry whose author only filled in the long field
    // must still come out readable rather than blank.
    const id = await entryWithWorkText({ workDetail: "Tightened everything and ran it up." });

    await replayMigration();

    const items = await itemsFor(id);
    expect(items).toHaveLength(1);
    expect(items[0]!.summary).toBe("Work recorded before the timeline");
    expect(items[0]!.detail).toBe("Tightened everything and ran it up.");
  });

  it("leaves an entry with no work alone", async () => {
    const id = await entryWithWorkText({});

    await replayMigration();

    expect(await itemsFor(id)).toEqual([]);
  });
});
