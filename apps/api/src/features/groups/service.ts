// Author: Brijesh Dave <https://github.com/brijeshdave>
// Group business logic: serialization, system-row protection (immutable but
// clonable), the location-belongs-to-a-group-company invariant, and the standard
// list query. The repository owns all DB access.
import {
  ERROR_CODES,
  type Group,
  type ResolvedListQuery,
  type PaginatedResult,
  toPaginatedResult,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import {
  type GroupRow,
  type ResolvedGroupRow,
  allGroups,
  allRoles,
  cloneGroupRow,
  deleteGroupRow,
  getGroupById,
  getGroupRoleIds,
  getGroupUserIds,
  getGroupsForUser,
  groupsWithRoleNames,
  insertGroup,
  listGroups as listGroupRows,
  setGroupRoles,
  setGroupUsers,
  updateGroupNameRow,
  upsertGroups,
} from "@/features/groups/repo.js";
import type { GroupExportRow, GroupParseResult } from "@/features/groups/import-parse.js";

function serialize(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    isSystem: row.isSystem,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireGroup(id: string): Promise<GroupRow> {
  const row = await getGroupById(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Group not found");
  return row;
}

async function requireEditable(id: string): Promise<GroupRow> {
  const row = await requireGroup(id);
  if (row.isSystem) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "System groups are immutable (clone instead)",
    );
  }
  return row;
}

export async function listGroups(query: ResolvedListQuery): Promise<PaginatedResult<Group>> {
  const { rows, total } = await listGroupRows(query);
  return toPaginatedResult(rows.map(serialize), total, query);
}

export async function getGroup(id: string): Promise<Group> {
  return serialize(await requireGroup(id));
}

export async function createGroup(name: string): Promise<Group> {
  return serialize(await insertGroup(name));
}

/**
 * The ids currently assigned to a group. The detail page reads these before it
 * writes: the assignment endpoints replace the whole set, so an editor that
 * couldn't read the current members would silently drop them.
 */
export async function getAssignments(id: string): Promise<{
  users: string[];
  roles: string[];
}> {
  await requireGroup(id);
  const [users, roles] = await Promise.all([getGroupUserIds(id), getGroupRoleIds(id)]);
  return { users, roles };
}

/**
 * What deleting this group costs. A group holds no data of its own: every foreign
 * key pointing at it is a join row. Deleting one revokes access and destroys
 * nothing — no user, role, company or location — so it is not guarded like a
 * company or a location. The count is here so the confirmation can be honest
 * about who loses what.
 */
export async function groupImpact(id: string): Promise<{
  members: number;
  roles: number;
}> {
  await requireGroup(id);
  const [users, roles] = await Promise.all([getGroupUserIds(id), getGroupRoleIds(id)]);
  return { members: users.length, roles: roles.length };
}

/** The groups a user belongs to. */
export async function groupsForUser(userId: string): Promise<Group[]> {
  return (await getGroupsForUser(userId)).map(serialize);
}

export async function updateGroup(id: string, name: string): Promise<Group> {
  await requireEditable(id);
  const row = await updateGroupNameRow(id, name);
  return serialize(row!);
}

export async function deleteGroup(id: string): Promise<void> {
  await requireEditable(id);
  await deleteGroupRow(id);
}

export async function assignRoles(id: string, roleIds: string[]): Promise<void> {
  await requireEditable(id);
  await setGroupRoles(id, roleIds);
}

export async function assignUsers(id: string, userIds: string[]): Promise<void> {
  // Membership is mutable even for the Superadmin system group (its *definition*
  // is not), but it must never be left without a member.
  const group = await requireGroup(id);
  if (group.isSystem && group.name === "Superadmin" && userIds.length === 0) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "The Superadmin group must keep at least one member",
    );
  }
  await setGroupUsers(id, userIds);
}

export async function cloneGroup(sourceId: string, name: string): Promise<Group> {
  await requireGroup(sourceId);
  return serialize(await cloneGroupRow(sourceId, name));
}

/* ------------------------------ Import / export ---------------------------- */

/** Export every group with the roles it carries (and its system flag, for reference). */
export async function exportGroups(): Promise<GroupExportRow[]> {
  return groupsWithRoleNames();
}

export interface GroupImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/**
 * Apply an uploaded group file. Role names are resolved to ids; a group matched by name
 * has its role set replaced (when the file lists roles). System groups are immutable, so a
 * row naming one is refused. All-or-nothing: any bad row leaves the groups untouched, with
 * every problem's line number.
 */
export async function importGroups(parsed: GroupParseResult): Promise<GroupImportOutcome> {
  const problems = [...parsed.problems];
  if (parsed.rows.length === 0) return { created: 0, updated: 0, problems };

  const [roles, groupsNow] = await Promise.all([allRoles(), allGroups()]);
  const roleIds = new Map(roles.map((r) => [r.name.trim().toLowerCase(), r.id]));
  const systemByName = new Set(
    groupsNow.filter((g) => g.isSystem).map((g) => g.name.trim().toLowerCase()),
  );

  const resolved: ResolvedGroupRow[] = [];
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    const key = row.name.trim().toLowerCase();
    if (seen.has(key))
      problems.push({
        line: row.line,
        message: `"${row.name}" appears more than once in the file`,
      });
    seen.add(key);

    if (systemByName.has(key)) {
      problems.push({
        line: row.line,
        message: `"${row.name}" is a system group and cannot be changed by import (clone it instead)`,
      });
      continue;
    }

    let ids: string[] | null = null;
    if (row.roles !== null) {
      ids = [];
      for (const name of row.roles) {
        const id = roleIds.get(name.trim().toLowerCase());
        if (!id) {
          problems.push({ line: row.line, message: `No role called "${name}"` });
        } else {
          ids.push(id);
        }
      }
    }
    resolved.push({ name: row.name, roleIds: ids });
  }

  if (problems.length > 0) return { created: 0, updated: 0, problems };

  const { created, updated } = await upsertGroups(resolved);
  return { created, updated, problems: [] };
}
