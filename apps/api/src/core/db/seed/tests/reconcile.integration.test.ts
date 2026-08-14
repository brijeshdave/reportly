// Author: Brijesh Dave <https://github.com/brijeshdave>
// A re-seed must make a system role's grants MATCH its definition, not merely
// top them up.
//
// The seed used to insert with onConflictDoNothing and delete nothing, so a
// system role's permissions could only ever grow. Taking a permission away from
// a definition did nothing on an existing install, which meant the role an
// administrator saw in the matrix was the union of every version that had ever
// shipped. These tests exercise the acting path — a grant that should be gone is
// gone — rather than that the seed runs without error.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/core/db/index.js";
import { appPool, logPool } from "@/core/db/pool.js";
import { permissions, rolePermissions, roles } from "@/core/db/schema.js";
import { seedDatabase } from "@/core/db/seed/index.js";
import { redis } from "@/core/redis.js";
import { resetDb } from "../../../../../test/reset-db.js";

async function roleIdByName(name: string): Promise<string> {
  const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name));
  if (!row) throw new Error(`no role called ${name}`);
  return row.id;
}

async function permissionIdByKey(key: string): Promise<string> {
  const [row] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, key));
  if (!row) throw new Error(`no permission called ${key}`);
  return row.id;
}

async function grantCount(roleId: string, permissionId: string): Promise<number> {
  const rows = await db
    .select({ roleId: rolePermissions.roleId })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)));
  return rows.length;
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

describe("system role reconciliation", () => {
  it("removes a grant the definition no longer lists", async () => {
    // Stand in for "this permission used to be on this role": Assets & devices viewer is
    // read-only by definition, so a delete grant is exactly the kind of leftover
    // a tightened definition should clear.
    const roleId = await roleIdByName("Assets & devices viewer");
    const strayId = await permissionIdByKey("assets:delete");
    await db.insert(rolePermissions).values({ roleId, permissionId: strayId });
    expect(await grantCount(roleId, strayId)).toBe(1);

    await seedDatabase();

    expect(await grantCount(roleId, strayId)).toBe(0);
  });

  it("keeps the grants the definition does list", async () => {
    const roleId = await roleIdByName("Assets & devices viewer");
    const kept = await permissionIdByKey("assets:read");
    await seedDatabase();
    expect(await grantCount(roleId, kept)).toBe(1);
  });

  it("leaves a role an administrator made alone", async () => {
    // Reconciliation is for system roles. A cloned-and-tailored role belongs to
    // whoever built it, and a re-seed must not touch it — otherwise upgrading the
    // app would quietly rewrite an organisation's own access model.
    const [custom] = await db
      .insert(roles)
      .values({ name: "Night shift lead", isSystem: false })
      .returning({ id: roles.id });
    const permissionId = await permissionIdByKey("assets:delete");
    await db.insert(rolePermissions).values({ roleId: custom!.id, permissionId });

    await seedDatabase();

    expect(await grantCount(custom!.id, permissionId)).toBe(1);
  });
});
