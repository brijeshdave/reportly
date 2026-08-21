// Author: Brijesh Dave <https://github.com/brijeshdave>
// Group repository — the only code touching groups and their assignment joins
// (roles/users). Scope — which companies and sites — belongs to the user now.
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { groupRoles, groupUsers, groups, locations, roles } from "@/core/db/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";
import type { ResolvedListQuery } from "@reportly/shared";

export interface GroupRow {
  id: string;
  name: string;
  isSystem: boolean;
  requiresTwoFactor: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const listConfig: ListConfig = {
  columns: {
    name: groups.name,
    isSystem: groups.isSystem,
    requiresTwoFactor: groups.requiresTwoFactor,
    createdAt: groups.createdAt,
  },
  defaultSort: groups.name,
};

export async function listGroups(
  query: ResolvedListQuery,
): Promise<{ rows: GroupRow[]; total: number }> {
  const { where, orderBy, limit, offset } = buildListParts(listConfig, query);
  const rows = await db
    .select()
    .from(groups)
    .where(where)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);
  const counted = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(groups)
    .where(where);
  return { rows, total: counted[0]?.count ?? 0 };
}

export async function getGroupById(id: string): Promise<GroupRow | null> {
  const [row] = await db.select().from(groups).where(eq(groups.id, id));
  return row ?? null;
}

export async function insertGroup(name: string, requiresTwoFactor = false): Promise<GroupRow> {
  const [row] = await db.insert(groups).values({ name, requiresTwoFactor }).returning();
  return row!;
}

export async function updateGroupRow(
  id: string,
  fields: { name?: string; requiresTwoFactor?: boolean },
): Promise<GroupRow | null> {
  const [row] = await db
    .update(groups)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(groups.id, id))
    .returning();
  return row ?? null;
}

export async function deleteGroupRow(id: string): Promise<void> {
  await db.delete(groups).where(eq(groups.id, id));
}

export async function getGroupRoleIds(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ roleId: groupRoles.roleId })
    .from(groupRoles)
    .where(eq(groupRoles.groupId, groupId));
  return rows.map((r) => r.roleId);
}

export async function getGroupUserIds(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: groupUsers.userId })
    .from(groupUsers)
    .where(eq(groupUsers.groupId, groupId));
  return rows.map((r) => r.userId);
}

/** The groups a user belongs to, for the user detail page. */
export async function getGroupsForUser(userId: string): Promise<GroupRow[]> {
  return db
    .select({
      id: groups.id,
      name: groups.name,
      isSystem: groups.isSystem,
      requiresTwoFactor: groups.requiresTwoFactor,
      createdAt: groups.createdAt,
      updatedAt: groups.updatedAt,
    })
    .from(groupUsers)
    .innerJoin(groups, eq(groups.id, groupUsers.groupId))
    .where(eq(groupUsers.userId, userId))
    .orderBy(groups.name);
}

/** Company id for each of the given location ids. */
export async function companiesForLocations(
  locationIds: string[],
): Promise<{ id: string; companyId: string }[]> {
  if (locationIds.length === 0) return [];
  return db
    .select({ id: locations.id, companyId: locations.companyId })
    .from(locations)
    .where(inArray(locations.id, locationIds));
}

export async function setGroupRoles(groupId: string, roleIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(groupRoles).where(eq(groupRoles.groupId, groupId));
    if (roleIds.length > 0) {
      await tx.insert(groupRoles).values(roleIds.map((roleId) => ({ groupId, roleId })));
    }
  });
}

export async function setGroupUsers(groupId: string, userIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(groupUsers).where(eq(groupUsers.groupId, groupId));
    if (userIds.length > 0) {
      await tx.insert(groupUsers).values(userIds.map((userId) => ({ groupId, userId })));
    }
  });
}

/** Clone a group's roles into a new editable group. */
export async function cloneGroupRow(sourceId: string, name: string): Promise<GroupRow> {
  return db.transaction(async (tx) => {
    const [group] = await tx.insert(groups).values({ name, isSystem: false }).returning();
    const newId = group!.id;

    const roles = await tx
      .select({ roleId: groupRoles.roleId })
      .from(groupRoles)
      .where(eq(groupRoles.groupId, sourceId));
    if (roles.length > 0) {
      await tx.insert(groupRoles).values(roles.map((r) => ({ groupId: newId, roleId: r.roleId })));
    }

    return group!;
  });
}

/* ------------------------------ Import / export ---------------------------- */

/** Every group with the names of the roles it carries — for export. */
export async function groupsWithRoleNames(): Promise<
  { name: string; isSystem: boolean; roles: string[] }[]
> {
  const rows = await db
    .select({
      groupId: groups.id,
      name: groups.name,
      isSystem: groups.isSystem,
      roleName: roles.name,
    })
    .from(groups)
    .leftJoin(groupRoles, eq(groupRoles.groupId, groups.id))
    .leftJoin(roles, eq(roles.id, groupRoles.roleId))
    .orderBy(groups.name);
  const byGroup = new Map<string, { name: string; isSystem: boolean; roles: string[] }>();
  for (const row of rows) {
    let g = byGroup.get(row.groupId);
    if (!g) {
      g = { name: row.name, isSystem: row.isSystem, roles: [] };
      byGroup.set(row.groupId, g);
    }
    if (row.roleName) g.roles.push(row.roleName);
  }
  return [...byGroup.values()];
}

/** Every group (id + name + system flag), for matching an import against. */
export async function allGroups(): Promise<{ id: string; name: string; isSystem: boolean }[]> {
  return db.select({ id: groups.id, name: groups.name, isSystem: groups.isSystem }).from(groups);
}

/** Every role (id + name), for resolving an import's role names. */
export async function allRoles(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: roles.id, name: roles.name }).from(roles);
}

/** One resolved group import row: role ids, or null to leave the group's roles unchanged. */
export interface ResolvedGroupRow {
  name: string;
  roleIds: string[] | null;
}

/**
 * Apply a group import in one transaction, keyed by name. An existing (non-system) group
 * has its role set replaced where the row lists roles; a new name is inserted. System
 * groups are rejected before this runs. All-or-nothing: a failure rolls the whole import
 * back.
 */
export async function upsertGroups(
  rows: ResolvedGroupRow[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: groups.id, name: groups.name }).from(groups);
    const byName = new Map(existing.map((g) => [g.name.trim().toLowerCase(), g.id]));
    for (const row of rows) {
      let id = byName.get(row.name.trim().toLowerCase());
      if (id) {
        updated += 1;
      } else {
        const [ins] = await tx
          .insert(groups)
          .values({ name: row.name, isSystem: false })
          .returning({ id: groups.id });
        id = ins!.id;
        byName.set(row.name.trim().toLowerCase(), id);
        created += 1;
      }
      if (row.roleIds !== null) {
        await tx.delete(groupRoles).where(eq(groupRoles.groupId, id));
        if (row.roleIds.length > 0) {
          await tx
            .insert(groupRoles)
            .values(row.roleIds.map((roleId) => ({ groupId: id!, roleId })));
        }
      }
    }
  });
  return { created, updated };
}
