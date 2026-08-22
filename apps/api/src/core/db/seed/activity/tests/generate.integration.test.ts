// Author: Brijesh Dave <https://github.com/brijeshdave>
// The generator, against a real database.
//
// Three things are worth holding: it writes nothing to master data, it produces a
// history whose *shape* is usable (weekday-biased, some entries still open, points on
// the ledger), and `--purge` takes back exactly what it wrote and nothing else. The
// third is the one with teeth — a purge that over-reaches deletes somebody's real
// work, which is the failure this whole command has to be trusted not to cause.
import { eq, like, not, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/core/db/index.js";
import { appPool, logPool } from "@/core/db/pool.js";
import {
  categories,
  departmentUsers,
  departments,
  deviceTypes,
  devices,
  journalEntries,
  pointAwards,
  tasks,
  userCompanies,
  users,
} from "@/core/db/schema.js";
import { MARK, generateActivity, purgeActivity } from "@/core/db/seed/activity/generate.js";
import { takeInventory } from "@/core/db/seed/activity/inventory.js";
import { isWeekend } from "@/core/db/seed/activity/random.js";
import { resetDb } from "../../../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const DEPT_ENGINEERING = "22222222-2222-2222-2222-222222222221";

afterAll(async () => {
  await appPool.end();
  await logPool.end();
});

beforeEach(async () => {
  await resetDb();
});

/** A department with people in it — the generator's minimum. */
async function staffEngineering(): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, name] of ["Ravi Lead", "Sam Operator", "Priya Fitter"].entries()) {
    const id = `activity-user-${index}`;
    await db.insert(users).values({
      id,
      name,
      email: `${id}@reportly.test`,
      username: id,
    });
    await db.insert(userCompanies).values({ userId: id, companyId: DEMO_COMPANY_ID });
    await db.insert(departmentUsers).values({
      departmentId: DEPT_ENGINEERING,
      userId: id,
      rank: index === 0 ? "lead" : "member",
      reportsToId: index === 0 ? null : "activity-user-0",
    });
    ids.push(id);
  }

  const [type] = await db
    .insert(deviceTypes)
    .values({ departmentId: DEPT_ENGINEERING, name: "Press" })
    .returning({ id: deviceTypes.id });
  await db.insert(devices).values({
    companyId: DEMO_COMPANY_ID,
    departmentId: DEPT_ENGINEERING,
    typeId: type!.id,
    name: "Press 1",
  });
  await db.insert(categories).values({ departmentId: DEPT_ENGINEERING, name: "Breakdown" });

  return ids;
}

const RANGE = {
  from: new Date("2026-06-01T00:00:00.000Z"),
  to: new Date("2026-06-30T00:00:00.000Z"),
};

describe("seed:activity", () => {
  it("says what the master data can and cannot support, before writing anything", async () => {
    // An empty department is the common case on a fresh restore, and the answer
    // "nobody in the department" is more useful than an empty report later.
    const inventory = await takeInventory([DEMO_COMPANY_ID]);
    const engineering = inventory[0]!.departments.find((d) => d.id === DEPT_ENGINEERING);
    expect(engineering?.skips).toContain("nobody in the department — nothing can be filed");

    await staffEngineering();
    const after = await takeInventory([DEMO_COMPANY_ID]);
    const staffed = after[0]!.departments.find((d) => d.id === DEPT_ENGINEERING);
    expect(staffed?.members).toHaveLength(3);
    expect(staffed?.skips).not.toContain("nobody in the department — nothing can be filed");
  });

  it("generates a history without touching master data", async () => {
    const userIds = await staffEngineering();
    const before = {
      users: (await db.select({ n: sql<number>`count(*)::int` }).from(users))[0]!.n,
      departments: (await db.select({ n: sql<number>`count(*)::int` }).from(departments))[0]!.n,
      devices: (await db.select({ n: sql<number>`count(*)::int` }).from(devices))[0]!.n,
    };

    const counts = await generateActivity({ ...RANGE, volume: "normal", seed: 1 });

    expect(counts.entries).toBeGreaterThan(0);
    expect(counts.awards).toBeGreaterThan(0);
    expect(counts.tasks).toBeGreaterThan(0);

    // Master data is untouched: this command exists to work *with* what is there.
    const after = {
      users: (await db.select({ n: sql<number>`count(*)::int` }).from(users))[0]!.n,
      departments: (await db.select({ n: sql<number>`count(*)::int` }).from(departments))[0]!.n,
      devices: (await db.select({ n: sql<number>`count(*)::int` }).from(devices))[0]!.n,
    };
    expect(after).toEqual(before);

    // Everything it wrote belongs to the people who were already here.
    const authors = await db.selectDistinct({ id: journalEntries.authorId }).from(journalEntries);
    for (const author of authors) expect(userIds).toContain(author.id);
  });

  it("puts the work on working days, and leaves some of it unfinished", async () => {
    // The shape is the point: a uniform scatter gives flat charts, and a history where
    // everything is closed leaves Reviews and "awaiting review" empty.
    await staffEngineering();
    await generateActivity({ ...RANGE, volume: "heavy", seed: 7 });

    const entries = await db
      .select({ date: journalEntries.reportDate, statusId: journalEntries.statusId })
      .from(journalEntries);
    const weekdays = entries.filter((e) => !isWeekend(e.date.toISOString().slice(0, 10)));
    expect(weekdays.length / entries.length).toBeGreaterThan(0.6);

    const distinctStatuses = new Set(entries.map((e) => e.statusId));
    expect(distinctStatuses.size, "every entry ended in the same status").toBeGreaterThan(1);
  });

  it("is reproducible from its seed", async () => {
    await staffEngineering();
    const first = await generateActivity({ ...RANGE, volume: "light", seed: 42 });
    await purgeActivity();
    const second = await generateActivity({ ...RANGE, volume: "light", seed: 42 });
    expect(second).toEqual(first);
  });

  it("purges what it wrote, and only what it wrote", async () => {
    const [userId] = await staffEngineering();
    // Somebody's real work, filed while the demo data was on screen.
    await db.insert(tasks).values({
      companyId: DEMO_COMPANY_ID,
      title: "Real task somebody typed",
      assigneeId: userId!,
      assignerId: userId!,
      departmentId: DEPT_ENGINEERING,
      state: "open",
    });
    await db.insert(journalEntries).values({
      companyId: DEMO_COMPANY_ID,
      authorId: userId!,
      kind: "work",
      state: "submitted",
      title: "Real entry somebody wrote",
      departmentId: DEPT_ENGINEERING,
      reportDate: new Date("2026-06-15T09:00:00.000Z"),
    });

    await generateActivity({ ...RANGE, volume: "normal", seed: 3 });
    expect(
      (await db.select({ n: sql<number>`count(*)::int` }).from(journalEntries))[0]!.n,
    ).toBeGreaterThan(1);

    await purgeActivity();

    // The real rows survive; every generated one is gone.
    const remainingEntries = await db.select({ title: journalEntries.title }).from(journalEntries);
    expect(remainingEntries).toEqual([{ title: "Real entry somebody wrote" }]);
    const remainingTasks = await db.select({ title: tasks.title }).from(tasks);
    expect(remainingTasks).toEqual([{ title: "Real task somebody typed" }]);
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(pointAwards))[0]!.n).toBe(0);

    // And nothing marked is left anywhere it could resurface.
    const leftovers = await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(like(journalEntries.title, `%${MARK}`));
    expect(leftovers).toEqual([]);
  });

  it("writes nothing for a company with no departments staffed", async () => {
    const counts = await generateActivity({ ...RANGE, volume: "normal", seed: 5 });
    expect(counts.entries).toBe(0);
    expect(
      (
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(journalEntries)
          .where(not(eq(journalEntries.title, "")))
      )[0]!.n,
    ).toBe(0);
  });
});
