// Author: Brijesh Dave <https://github.com/brijeshdave>
// The upgrade property of migration 0005, which is the only thing about it that can
// hurt anybody: a group holding one of the combined roles must come out holding both
// halves. Get that wrong and an organisation loses half its access during an upgrade,
// silently, and finds out when somebody cannot do their job.
//
// So the test recreates the *pre-migration* world — the old combined role, its grants,
// a group holding it — and replays the migration over it. The migration has already
// run against this database (global setup migrates it), which is exactly why replaying
// it also proves the thing is idempotent.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/core/db/index.js";
import { appPool, logPool } from "@/core/db/pool.js";
import { groupRoles, groups, permissions, rolePermissions, roles } from "@/core/db/schema.js";
import { resetDb } from "../../../../../test/reset-db.js";

const migrationFile = fileURLToPath(
  new URL("../../../../../drizzle/0005_role_recut.sql", import.meta.url),
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

/** Recreate a role that the migration expects to find, with the grants it had. */
async function oldRole(name: string, keys: string[]): Promise<string> {
  const [row] = await db.insert(roles).values({ name, isSystem: true }).returning({ id: roles.id });
  const perms = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.key, keys));
  await db
    .insert(rolePermissions)
    .values(perms.map((p) => ({ roleId: row!.id, permissionId: p.id })));
  return row!.id;
}

async function keysOfGroup(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ key: permissions.key })
    .from(groupRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, groupRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(groupRoles.groupId, groupId));
  return [...new Set(rows.map((r) => r.key))].sort();
}

async function rolesOfGroup(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ name: roles.name })
    .from(groupRoles)
    .innerJoin(roles, eq(roles.id, groupRoles.roleId))
    .where(eq(groupRoles.groupId, groupId));
  return rows.map((r) => r.name).sort();
}

describe("migration 0005 — the role re-cut", () => {
  it("carries a group across the tasks/downtime split without losing access", async () => {
    const oldId = await oldRole("Tasks & downtime editor", [
      "tasks:read",
      "tasks:create",
      "tasks:update",
      "downtime:read",
      "downtime:write",
    ]);
    const [group] = await db
      .insert(groups)
      .values({ name: "Line supervisors" })
      .returning({ id: groups.id });
    await db.insert(groupRoles).values({ groupId: group!.id, roleId: oldId });

    await replayMigration();

    // Both halves, and the combined role gone.
    expect(await rolesOfGroup(group!.id)).toEqual(["Downtime recorder", "Tasks admin"]);
    // Everything they could do yesterday, they can do today.
    for (const key of [
      "tasks:read",
      "tasks:create",
      "tasks:update",
      "downtime:read",
      "downtime:write",
    ]) {
      expect(await keysOfGroup(group!.id), key).toContain(key);
    }
  });

  it("carries a group across the reports/analytics split", async () => {
    const oldId = await oldRole("Reports & analytics viewer", [
      "reports:view:journal",
      "reports:view:downtime",
      "analytics:view",
      "journal:read",
    ]);
    const [group] = await db
      .insert(groups)
      .values({ name: "Plant managers" })
      .returning({ id: groups.id });
    await db.insert(groupRoles).values({ groupId: group!.id, roleId: oldId });

    await replayMigration();

    expect(await rolesOfGroup(group!.id)).toEqual(["Analytics viewer", "Reports viewer"]);
    const held = await keysOfGroup(group!.id);
    expect(held).toContain("reports:view:journal");
    expect(held).toContain("analytics:view");
    expect(held).toContain("journal:read");
  });

  it("takes deletion off the admin tiers and leaves it with a superadmin", async () => {
    await replayMigration();

    const admins = await db
      .select({ role: roles.name, key: permissions.key })
      .from(roles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(roles.isSystem, true));

    const deletesByRole = new Map<string, string[]>();
    for (const row of admins) {
      if (!row.key.endsWith(":delete")) continue;
      deletesByRole.set(row.role, [...(deletesByRole.get(row.role) ?? []), row.key]);
    }

    // No administrator, broad or per-area. (`Manager` keeps `comments:delete`, which
    // is withdrawing their *own* remark and is row-scoped to it — a different thing
    // from removing somebody else's record.)
    for (const [role, keys] of deletesByRole) {
      const isAdminTier = role === "Admin" || role.endsWith(" admin");
      expect(isAdminTier, `${role} still holds ${keys[0]}`).toBe(false);
    }
    // And a superadmin does hold them, or the keys would be unreachable.
    const superadmins = [...deletesByRole.keys()].filter(
      (role) => role === "Superadmin" || role.endsWith(" superadmin"),
    );
    expect(superadmins.length).toBeGreaterThan(0);
  });

  it("is safe to run twice", async () => {
    await replayMigration();
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(roles);
    await replayMigration();
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(roles);
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
