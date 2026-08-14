// Author: Brijesh Dave <https://github.com/brijeshdave>
// The three-tier restructure renamed nine system roles and merged three others.
// The danger in that is entirely about `group_roles`: it references a role by id,
// so replacing a role — new row in, old row out — would leave every group that
// held it pointing at nothing, and strip an organisation of access during an
// upgrade without a word.
//
// So these tests are about the property that matters: a group that held a role
// before the migration still holds one after it, and still has the permissions it
// was given. Migration 0064 renames in place for exactly this reason.
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/core/db/index.js";
import { appPool, logPool } from "@/core/db/pool.js";
import { groupRoles, groups, permissions, rolePermissions, roles } from "@/core/db/schema.js";
import { AREA_ROLES, SINGLE_TIER_ROLES, seedDatabase } from "@/core/db/seed/index.js";
import { redis } from "@/core/redis.js";
import { resetDb } from "../../../../../test/reset-db.js";

/** The permission keys a role grants, as the database has them. */
async function grantsOf(roleName: string): Promise<string[]> {
  const rows = await db
    .select({ key: permissions.key })
    .from(roles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(roles.name, roleName));
  return rows.map((r) => r.key).sort();
}

beforeEach(async () => {
  await resetDb();
  await seedDatabase();
});

afterAll(async () => {
  await appPool.end();
  await logPool.end();
  await redis.quit();
});

describe("three-tier area roles", () => {
  it("seeds every tier the definition lists", async () => {
    const seeded = await db.select({ name: roles.name }).from(roles);
    const names = new Set(seeded.map((r) => r.name));
    for (const role of AREA_ROLES) {
      expect(names, `${role.name} was not seeded`).toContain(role.name);
    }
  });

  it("grants each role exactly what its definition says, and no more", async () => {
    // The reconciliation guarantee, checked end to end rather than in the abstract.
    for (const role of AREA_ROLES) {
      expect(await grantsOf(role.name), `${role.name}`).toEqual([...role.permissions].sort());
    }
  });

  it("keeps a group's assignment across a re-seed", async () => {
    // The upgrade shape: a group holds an area role, the seed runs again, the
    // group still holds it. A rename that dropped the row would fail here.
    const [group] = await db
      .insert(groups)
      .values({ name: "Maintenance team" })
      .returning({ id: groups.id });
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, "Assets & devices editor"));
    await db.insert(groupRoles).values({ groupId: group!.id, roleId: role!.id });

    await seedDatabase();

    const held = await db
      .select({ roleId: groupRoles.roleId })
      .from(groupRoles)
      .where(and(eq(groupRoles.groupId, group!.id), eq(groupRoles.roleId, role!.id)));
    expect(held).toHaveLength(1);
  });

  it("gives every area three tiers, except where a middle tier would be meaningless", async () => {
    // Guards the shape itself. The exceptions are deliberate and declared beside
    // the roles they describe, not copied here — a single-tier role added to the
    // seed used to fail two tests that had no opinion about it.
    const tiered = AREA_ROLES.filter(
      (r) => !(SINGLE_TIER_ROLES as readonly string[]).includes(r.name),
    );

    const byArea = new Map<string, string[]>();
    for (const role of tiered) {
      const tier = role.name.split(" ").pop()!;
      const area = role.name.slice(0, -(tier.length + 1));
      byArea.set(area, [...(byArea.get(area) ?? []), tier]);
    }

    for (const [area, tiers] of byArea) {
      expect([...tiers].sort(), `${area} is missing a tier`).toEqual(["admin", "editor", "viewer"]);
    }
  });

  it("makes each tier a subset of the one above it", async () => {
    // A viewer who can do something their admin cannot is a mistake, every time.
    const byName = new Map(AREA_ROLES.map((r) => [r.name, new Set<string>(r.permissions)]));

    for (const role of AREA_ROLES) {
      if ((SINGLE_TIER_ROLES as readonly string[]).includes(role.name)) continue;
      const tier = role.name.split(" ").pop()!;
      if (tier === "admin") continue;
      const area = role.name.slice(0, -(tier.length + 1));
      const above = byName.get(`${area} ${tier === "viewer" ? "editor" : "admin"}`)!;
      const extra = [...byName.get(role.name)!].filter((p) => !above.has(p));
      expect(extra, `${role.name} grants what the tier above it does not`).toEqual([]);
    }
  });

  it("retires the merged roles rather than leaving them empty", async () => {
    const leftovers = await db
      .select({ name: roles.name })
      .from(roles)
      .where(inArray(roles.name, ["Group management", "Roles management", "User management"]));
    expect(leftovers).toEqual([]);
  });
});
