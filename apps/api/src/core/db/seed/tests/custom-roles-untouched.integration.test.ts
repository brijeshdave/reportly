// Author: Brijesh Dave <https://github.com/brijeshdave>
// A custom role is the administrator's, and the seed may not touch it.
//
// Roles are unique by name, so somebody who makes "Tasks admin" for their own use
// occupies a name a later release may ship. The seed used to look roles up by name
// alone and reconcile whatever it found — deleting every permission its definition
// did not list. That overwrote four hand-made roles on a real database, and the
// comment above the loop had claimed for months that custom roles were safe.
//
// The test that would have caught it: make a custom role with a shipped name, seed,
// and check it still says what its owner said.
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/core/db/index.js";
import { appPool, logPool } from "@/core/db/pool.js";
import { seedDatabase } from "@/core/db/seed/index.js";
import { permissions, rolePermissions, roles } from "@/core/db/schema.js";
import { resetDb } from "../../../../../test/reset-db.js";

afterAll(async () => {
  await appPool.end();
  await logPool.end();
});

beforeEach(async () => {
  await resetDb();
});

async function keysOf(roleName: string): Promise<string[]> {
  const [role] = await db.select().from(roles).where(eq(roles.name, roleName));
  if (!role) return [];
  const rows = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, role.id));
  return rows.map((r) => r.key).sort();
}

describe("seeding and a custom role that shares a shipped name", () => {
  it("leaves the administrator's role exactly as they left it", async () => {
    // Their "Tasks admin" is nothing like the shipped one — deliberately, because
    // that is the point: it is theirs.
    await db.delete(roles).where(eq(roles.name, "Tasks admin"));
    const [mine] = await db
      .insert(roles)
      .values({ name: "Tasks admin", isSystem: false })
      .returning({ id: roles.id });
    const [journalRead] = await db
      .select()
      .from(permissions)
      .where(eq(permissions.key, "journal:read"));
    await db.insert(rolePermissions).values({ roleId: mine!.id, permissionId: journalRead!.id });

    await seedDatabase();

    expect(await keysOf("Tasks admin")).toEqual(["journal:read"]);
    const [after] = await db.select().from(roles).where(eq(roles.name, "Tasks admin"));
    expect(after!.isSystem, "the seed must not adopt a custom role").toBe(false);
  });

  it("still reconciles the shipped roles it does own", async () => {
    // The other half: skipping a name it cannot claim must not stop it maintaining
    // the rest, or one collision would freeze every other role's definition.
    const [role] = await db.select().from(roles).where(eq(roles.name, "Journal editor"));
    const [unrelated] = await db
      .select()
      .from(permissions)
      .where(eq(permissions.key, "backups:manage"));
    await db.insert(rolePermissions).values({ roleId: role!.id, permissionId: unrelated!.id });

    await seedDatabase();

    expect(await keysOf("Journal editor")).not.toContain("backups:manage");
  });
});
