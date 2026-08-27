// Author: Brijesh Dave <https://github.com/brijeshdave>
// A fresh database gets a whole workflow, not one status.
//
// A migration added the "Rejected" status for installs seeded before it existed.
// It also ran on *empty* databases — where it inserted that one row, and the seed,
// which skips statuses when the table is not empty, then declined to create the
// other eight. Every entry filed afterwards had no status at all, and a whole e2e
// run failed on a dropdown with one option in it.
//
// **These two do not reproduce that sequence.** `resetDb` truncates and re-seeds a
// database whose migrations ran long ago, so the empty-table case never arises
// here — removing the migration's guard leaves both of them green. What catches it
// is the e2e stack, which builds its database the same way a new install does:
// drop, migrate, seed. That is where the fault appeared (one status, and a status
// dropdown with one option) and where the guard fixed it.
//
// What these pin is the shape everything else assumes: "Open" first, and exactly
// one "Rejected", last of its group.
import { asc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/core/db/index.js";
import { appPool, logPool } from "@/core/db/pool.js";
import { journalStatuses } from "@/core/db/schema.js";
import { resetDb } from "../../../../test/reset-db.js";

beforeAll(async () => {
  await resetDb();
});
afterAll(async () => {
  await appPool.end();
  await logPool.end();
});

describe("a freshly built database", () => {
  it("has the whole status workflow, in order", async () => {
    const rows = await db
      .select({ name: journalStatuses.name, group: journalStatuses.group })
      .from(journalStatuses)
      .orderBy(asc(journalStatuses.orderIndex));

    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]?.name).toBe("Open");
    expect(rows.map((row) => row.name)).toContain("Resolved");
  });

  it("has exactly one status named Rejected, last of its group", async () => {
    const rows = await db
      .select({ name: journalStatuses.name, group: journalStatuses.group })
      .from(journalStatuses)
      .orderBy(asc(journalStatuses.orderIndex));

    const rejected = rows.filter((row) => row.group === "rejected");
    expect(rejected.filter((row) => row.name === "Rejected")).toHaveLength(1);
    // Last, so it never becomes "the first status of the rejected group" for
    // anything that asks that question — the rejection path finds it by name.
    expect(rejected.at(-1)?.name).toBe("Rejected");
  });
});
