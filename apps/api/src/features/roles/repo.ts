// Author: Brijesh Dave <https://github.com/brijeshdave>
// Role repository — the only code touching roles and their permission join.
// A role is a named bundle of permission keys; services call these.
import { asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { groupRoles, groups, permissions, rolePermissions, roles } from "@/core/db/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";
import type { ResolvedListQuery } from "@reportly/shared";

export interface RoleRow {
  id: string;
  name: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const listConfig: ListConfig = {
  columns: { name: roles.name, isSystem: roles.isSystem, createdAt: roles.createdAt },
  defaultSort: roles.name,
};

export async function listRoles(
  query: ResolvedListQuery,
): Promise<{ rows: RoleRow[]; total: number }> {
  const { where, orderBy, limit, offset } = buildListParts(listConfig, query);

  // System roles first by default: they are the vocabulary a custom role is built
  // from, so they belong at the top of the list. An explicit sort still wins.
  const order = query.sortBy ? [orderBy] : [desc(roles.isSystem), asc(roles.name)];

  const rows = await db
    .select()
    .from(roles)
    .where(where)
    .orderBy(...order)
    .limit(limit)
    .offset(offset);
  const counted = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(roles)
    .where(where);
  return { rows, total: counted[0]?.count ?? 0 };
}

export async function getRoleById(id: string): Promise<RoleRow | null> {
  const [row] = await db.select().from(roles).where(eq(roles.id, id));
  return row ?? null;
}

/**
 * Permission keys per role id. Fetched for a whole page of roles in one query so
 * the matrix view doesn't issue a request per row.
 */
export async function permissionsForRoles(roleIds: string[]): Promise<Map<string, string[]>> {
  const byRole = new Map<string, string[]>(roleIds.map((id) => [id, []]));
  if (roleIds.length === 0) return byRole;

  const rows = await db
    .select({ roleId: rolePermissions.roleId, key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(inArray(rolePermissions.roleId, roleIds));

  for (const row of rows) byRole.get(row.roleId)?.push(row.key);
  return byRole;
}

/** A group that holds this role. */
export interface RoleReference {
  id: string;
  name: string;
}

export async function insertRole(name: string): Promise<RoleRow> {
  const [row] = await db.insert(roles).values({ name }).returning();
  return row!;
}

export async function updateRoleName(id: string, name: string): Promise<RoleRow | null> {
  const [row] = await db
    .update(roles)
    .set({ name, updatedAt: new Date() })
    .where(eq(roles.id, id))
    .returning();
  return row ?? null;
}

export async function deleteRoleRow(id: string): Promise<void> {
  await db.delete(roles).where(eq(roles.id, id));
}

/** Replaces the role's whole permission set. Unknown keys are ignored. */
export async function setRolePermissions(roleId: string, keys: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (keys.length === 0) return;

    const rows = await tx
      .select({ id: permissions.id })
      .from(permissions)
      .where(inArray(permissions.key, keys));
    if (rows.length === 0) return;

    await tx.insert(rolePermissions).values(rows.map((row) => ({ roleId, permissionId: row.id })));
  });
}

/* ------------------------------ Import / export ---------------------------- */

/** Every role with the permission keys it grants — for export. */
export async function rolesWithPermissionKeys(): Promise<
  { name: string; isSystem: boolean; permissions: string[] }[]
> {
  const all = await db
    .select({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
    .from(roles)
    .orderBy(desc(roles.isSystem), asc(roles.name));
  const keys = await permissionsForRoles(all.map((r) => r.id));
  return all.map((r) => ({
    name: r.name,
    isSystem: r.isSystem,
    permissions: (keys.get(r.id) ?? []).sort(),
  }));
}

/** Every role (id + name + system flag), for matching an import against. */
export async function allRolesBasic(): Promise<{ id: string; name: string; isSystem: boolean }[]> {
  return db.select({ id: roles.id, name: roles.name, isSystem: roles.isSystem }).from(roles);
}

/** One resolved role import row: keys, or null to leave the role's permissions unchanged. */
export interface ResolvedRoleRow {
  name: string;
  permissionKeys: string[] | null;
}

/**
 * Apply a role import in one transaction, keyed by name. An existing (non-system) role has
 * its permission set replaced where the row lists keys; a new name is inserted. System roles
 * are rejected before this runs, and keys are validated by the caller, so every key resolves.
 * All-or-nothing: a failure rolls the whole import back.
 */
export async function upsertRoles(
  rows: ResolvedRoleRow[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: roles.id, name: roles.name }).from(roles);
    const byName = new Map(existing.map((r) => [r.name.trim().toLowerCase(), r.id]));
    for (const row of rows) {
      let id = byName.get(row.name.trim().toLowerCase());
      if (id) {
        updated += 1;
      } else {
        const [ins] = await tx.insert(roles).values({ name: row.name }).returning({ id: roles.id });
        id = ins!.id;
        byName.set(row.name.trim().toLowerCase(), id);
        created += 1;
      }
      if (row.permissionKeys !== null) {
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
        if (row.permissionKeys.length > 0) {
          const perms = await tx
            .select({ id: permissions.id })
            .from(permissions)
            .where(inArray(permissions.key, row.permissionKeys));
          if (perms.length > 0) {
            await tx
              .insert(rolePermissions)
              .values(perms.map((p) => ({ roleId: id!, permissionId: p.id })));
          }
        }
      }
    }
  });
  return { created, updated };
}

/**
 * Groups holding this role. `group_roles` cascades on delete, so without this a
 * deleted role would silently strip permissions from every group that held it.
 */
export async function groupsHolding(roleId: string): Promise<RoleReference[]> {
  return db
    .select({ id: groups.id, name: groups.name })
    .from(groupRoles)
    .innerJoin(groups, eq(groups.id, groupRoles.groupId))
    .where(eq(groupRoles.roleId, roleId))
    .orderBy(groups.name);
}

/**
 * What switching the shipped roles off would cost, in people.
 *
 * Counted before the switch is flicked rather than discovered afterwards: somebody
 * whose only access comes through a system role loses everything the moment it stops
 * conferring, and "everything" here means they sign in to an empty app. The count is
 * the difference between a decision and a surprise.
 *
 * Superadmins are excluded — the Superadmin *group* bypasses roles entirely, which is
 * also why whoever turns this off can always turn it back on.
 */
export async function systemRoleImpact(): Promise<{ users: number; groups: number }> {
  const result = await db.execute<{ users: number; groups: number }>(sql`
    WITH group_kinds AS (
      SELECT gr."group_id" AS id,
             bool_or(r."is_system") AS has_system,
             bool_or(NOT r."is_system") AS has_custom
        FROM "group_roles" gr
        JOIN "roles" r ON r."id" = gr."role_id"
       GROUP BY gr."group_id"
    ),
    -- The Superadmin group grants its access directly rather than through a role, so
    -- its members lose nothing and must not be counted. It is also the escape hatch:
    -- whoever switches the shipped roles off can always switch them back on.
    superadmins AS (
      SELECT DISTINCT gu."user_id"
        FROM "group_users" gu
        JOIN "groups" g ON g."id" = gu."group_id"
       WHERE g."is_system" AND g."name" = 'Superadmin'
    ),
    losers AS (
      SELECT DISTINCT gu."user_id"
        FROM "group_users" gu
        JOIN group_kinds gk ON gk."id" = gu."group_id"
       WHERE gk."has_system"
         AND gu."user_id" NOT IN (SELECT "user_id" FROM superadmins)
    ),
    keepers AS (
      SELECT DISTINCT gu."user_id"
        FROM "group_users" gu
        JOIN group_kinds gk ON gk."id" = gu."group_id"
       WHERE gk."has_custom"
    )
    SELECT
      (SELECT count(*)::int FROM losers WHERE "user_id" NOT IN (SELECT "user_id" FROM keepers))
        AS users,
      (SELECT count(*)::int
         FROM group_kinds gk
         JOIN "groups" g ON g."id" = gk."id"
        WHERE gk."has_system" AND NOT gk."has_custom" AND g."name" <> 'Superadmin')
        AS groups
  `);
  const row = result.rows[0];
  return { users: Number(row?.users ?? 0), groups: Number(row?.groups ?? 0) };
}
