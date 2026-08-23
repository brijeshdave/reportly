// Author: Brijesh Dave <https://github.com/brijeshdave>
// The starter vocabularies — severities, statuses, asset types — must not come back
// after an administrator has curated them.
//
// Reported from production: every upgrade re-created statuses that had been deleted,
// and a status renamed with different capitalisation ("On hold" -> "on hold") missed
// the by-name conflict target and arrived as a *second* row beside it. The seed was
// quietly arguing with the person who owns the workflow.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/core/db/index.js";
import { appPool, logPool } from "@/core/db/pool.js";
import { seedDatabase } from "@/core/db/seed/index.js";
import { assetTypes, journalStatuses, locations, severities } from "@/core/db/schema.js";
import { resetDb } from "../../../../../test/reset-db.js";

afterAll(async () => {
  await appPool.end();
  await logPool.end();
});

beforeEach(async () => {
  await resetDb();
});

const statusNames = async () =>
  (await db.select({ name: journalStatuses.name }).from(journalStatuses)).map((r) => r.name).sort();

describe("seeding a database that already has its vocabulary", () => {
  it("does not bring back a status somebody deleted", async () => {
    await db.delete(journalStatuses).where(eq(journalStatuses.name, "On hold"));
    const before = await statusNames();
    expect(before).not.toContain("On hold");

    await seedDatabase();

    expect(await statusNames()).toEqual(before);
  });

  it("does not add a second row when one is renamed to a different case", async () => {
    // The unique index is case-sensitive, so "on hold" never conflicted with the
    // seeded "On hold" and both ended up in the list.
    await db
      .update(journalStatuses)
      .set({ name: "on hold" })
      .where(eq(journalStatuses.name, "On hold"));
    const before = await statusNames();

    await seedDatabase();

    expect(await statusNames()).toEqual(before);
    expect((await statusNames()).filter((n) => n.toLowerCase() === "on hold")).toHaveLength(1);
  });

  it("leaves a curated severity list exactly as it is", async () => {
    await db.delete(severities);
    await db.insert(severities).values([{ name: "Nuisance", orderIndex: 0 }]);

    await seedDatabase();

    const names = (await db.select({ name: severities.name }).from(severities)).map((r) => r.name);
    expect(names).toEqual(["Nuisance"]);
  });

  it("does not re-activate an asset type that was retired", async () => {
    await db.update(assetTypes).set({ status: "inactive" }).where(eq(assetTypes.name, "Station"));

    await seedDatabase();

    const [row] = await db.select().from(assetTypes).where(eq(assetTypes.name, "Station"));
    expect(row!.status).toBe("inactive");
  });

  it("does not put a site back beside the one it was renamed to", async () => {
    // The second half of the same report: "Headquarters as locations gets created
    // everytime i migrate the production. i had renamed it to HO". Seeded by name,
    // the rename missed the conflict target and the old name arrived alongside it.
    const [remote] = await db
      .select({ companyId: locations.companyId })
      .from(locations)
      .where(eq(locations.name, "Headquarters"))
      .limit(1);
    expect(remote, "the first seed should have created it").toBeDefined();

    await db.update(locations).set({ name: "HO" }).where(eq(locations.name, "Headquarters"));

    await seedDatabase();

    const names = (
      await db
        .select({ name: locations.name })
        .from(locations)
        .where(eq(locations.companyId, remote!.companyId))
    )
      .map((row) => row.name)
      .sort();
    expect(names).toEqual(["HO", "Remote"]);
    expect(names).not.toContain("Headquarters");
  });

  it("does not re-create a site somebody deleted, so long as one site remains", async () => {
    // A company that has named its own sites has answered the question. The seed
    // adds nothing — including when only one of the two starters is left.
    const [any] = await db.select({ companyId: locations.companyId }).from(locations).limit(1);
    await db.delete(locations).where(eq(locations.name, "Headquarters"));

    await seedDatabase();

    const names = (
      await db
        .select({ name: locations.name })
        .from(locations)
        .where(eq(locations.companyId, any!.companyId))
    ).map((row) => row.name);
    expect(names).not.toContain("Headquarters");
  });

  it("still fills an empty database, which is what the vocabulary is for", async () => {
    await db.delete(journalStatuses);
    expect(await statusNames()).toEqual([]);

    await seedDatabase();

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(journalStatuses);
    expect(n).toBeGreaterThan(0);
  });
});
