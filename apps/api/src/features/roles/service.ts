// Author: Brijesh Dave <https://github.com/brijeshdave>
// Role business logic. System roles are the definition of what a permission set
// means, so they are immutable — changing one would silently re-grant every group
// that holds it. Custom roles may be created, edited and deleted; deleting one
// that a group holds is refused rather than cascaded.
import {
  ALL_PERMISSIONS,
  ERROR_CODES,
  type PaginatedResult,
  type Permission,
  type ResolvedListQuery,
  type Role,
  toPaginatedResult,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { isUniqueViolation } from "@/lib/db-errors.js";
import {
  allRolesBasic,
  deleteRoleRow,
  getRoleById,
  groupsHolding,
  insertRole,
  listRoles as listRoleRows,
  permissionsForRoles,
  rolesWithPermissionKeys,
  setRolePermissions,
  updateRoleName,
  upsertRoles,
  type ResolvedRoleRow,
  type RoleReference,
  type RoleRow,
} from "@/features/roles/repo.js";
import type { RoleExportRow, RoleParseResult } from "@/features/roles/import-parse.js";

function serialize(row: RoleRow, permissions: string[]): Role {
  return {
    id: row.id,
    name: row.name,
    isSystem: row.isSystem,
    // Sorted so the matrix view renders columns in a stable order.
    permissions: [...permissions].sort() as Permission[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listRoles(query: ResolvedListQuery): Promise<PaginatedResult<Role>> {
  const { rows, total } = await listRoleRows(query);
  const byRole = await permissionsForRoles(rows.map((row) => row.id));
  return toPaginatedResult(
    rows.map((row) => serialize(row, byRole.get(row.id) ?? [])),
    total,
    query,
  );
}

export async function getRole(id: string): Promise<Role> {
  const row = await getRoleById(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Role not found");
  const byRole = await permissionsForRoles([row.id]);
  return serialize(row, byRole.get(row.id) ?? []);
}

async function requireRole(id: string): Promise<RoleRow> {
  const row = await getRoleById(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Role not found");
  return row;
}

/**
 * A system role is the definition of what a permission set means. Editing one
 * would silently re-grant every group that holds it, so they are frozen — clone
 * one to get an editable copy.
 */
async function requireEditable(id: string): Promise<RoleRow> {
  const row = await requireRole(id);
  if (row.isSystem) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "System roles are immutable (clone instead)",
    );
  }
  return row;
}

const DUPLICATE = () => new AppError(409, ERROR_CODES.CONFLICT, "A role with that name exists");

export async function createRole(name: string, permissions: Permission[]): Promise<Role> {
  let row: RoleRow;
  try {
    row = await insertRole(name);
  } catch (err) {
    if (isUniqueViolation(err)) throw DUPLICATE();
    throw err;
  }
  await setRolePermissions(row.id, permissions);
  return getRole(row.id);
}

/** Renaming and re-permissioning are independent; either may be omitted. */
export async function updateRole(
  id: string,
  input: { name?: string; permissions?: Permission[] },
): Promise<Role> {
  await requireEditable(id);

  if (input.name !== undefined) {
    try {
      await updateRoleName(id, input.name);
    } catch (err) {
      if (isUniqueViolation(err)) throw DUPLICATE();
      throw err;
    }
  }
  // Changing a role's permissions changes what every group holding it may do.
  if (input.permissions !== undefined) await setRolePermissions(id, input.permissions);

  return getRole(id);
}

/** The groups that would lose these permissions if the role changed or vanished. */
export async function roleReferences(id: string): Promise<RoleReference[]> {
  await requireRole(id);
  return groupsHolding(id);
}

/**
 * `group_roles` cascades on delete, so deleting a held role would strip its
 * permissions from those groups without a word. Refuse while anything holds it.
 */
export async function deleteRole(id: string): Promise<void> {
  await requireEditable(id);

  const held = await groupsHolding(id);
  if (held.length > 0) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This role is assigned to one or more groups. Remove it from them first.",
      { groups: held },
    );
  }
  await deleteRoleRow(id);
}

/** An editable copy of any role, system ones included. Nothing else is copied. */
export async function cloneRole(sourceId: string, name: string): Promise<Role> {
  const source = await getRole(sourceId);
  return createRole(name, source.permissions);
}

/* ------------------------------ Import / export ---------------------------- */

/** Export every role with the permission keys it grants (and its system flag). */
export async function exportRoles(): Promise<RoleExportRow[]> {
  return rolesWithPermissionKeys();
}

export interface RoleImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/**
 * Apply an uploaded role file. Permission keys are validated against the catalogue; a role
 * matched by name has its permission set replaced (when the file lists keys). System roles
 * are immutable, so a row naming one is refused. All-or-nothing: any bad row leaves the
 * roles untouched, with every problem's line number.
 */
export async function importRoles(parsed: RoleParseResult): Promise<RoleImportOutcome> {
  const problems = [...parsed.problems];
  if (parsed.rows.length === 0) return { created: 0, updated: 0, problems };

  const known = new Set<string>(ALL_PERMISSIONS);
  const systemByName = new Set(
    (await allRolesBasic()).filter((r) => r.isSystem).map((r) => r.name.trim().toLowerCase()),
  );

  const resolved: ResolvedRoleRow[] = [];
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
        message: `"${row.name}" is a system role and cannot be changed by import (clone it instead)`,
      });
      continue;
    }

    if (row.permissions !== null) {
      for (const perm of row.permissions) {
        if (!known.has(perm)) {
          problems.push({ line: row.line, message: `"${perm}" is not a permission` });
        }
      }
    }
    resolved.push({ name: row.name, permissionKeys: row.permissions });
  }

  if (problems.length > 0) return { created: 0, updated: 0, problems };

  const { created, updated } = await upsertRoles(resolved);
  return { created, updated, problems: [] };
}
