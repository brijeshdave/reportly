// Author: Brijesh Dave <https://github.com/brijeshdave>
// Resolves the per-request AuthContext from the authenticated user + active
// company: permissions (group -> role -> permission), location scope, and
// superadmin status. Downstream code reads only the resolved ctx.
import {
  ALL_PERMISSIONS,
  SYSTEM_ROLES_SETTING,
  type AuthContext,
  type Permission,
} from "@reportly/shared";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  groupRoles,
  groupUsers,
  groups,
  permissions as permissionsTable,
  roles,
  rolePermissions,
  userCompanies,
  userLocations,
} from "@/core/db/schema.js";
import { getSystemSetting } from "@/core/settings/service.js";

const SUPERADMIN_GROUP = "Superadmin";

/** True when the user belongs to the seeded Superadmin system group. */
export async function isSuperadmin(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: groups.id })
    .from(groupUsers)
    .innerJoin(groups, eq(groups.id, groupUsers.groupId))
    .where(
      and(
        eq(groupUsers.userId, userId),
        eq(groups.name, SUPERADMIN_GROUP),
        eq(groups.isSystem, true),
      ),
    );
  return rows.length > 0;
}

/**
 * Every group the user belongs to. Groups are a bundle of roles now — what the
 * person may do — so membership is not filtered by company; the company they are
 * *in* is a property of the user (see `hasCompanyAccess`).
 */
async function userGroupIds(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ groupId: groupUsers.groupId })
    .from(groupUsers)
    .where(eq(groupUsers.userId, userId));
  return rows.map((r) => r.groupId);
}

/** Whether the company is one the user has been given (or they are superadmin). */
export async function hasCompanyAccess(userId: string, companyId: string): Promise<boolean> {
  if (await isSuperadmin(userId)) return true;
  const rows = await db
    .select({ companyId: userCompanies.companyId })
    .from(userCompanies)
    .where(and(eq(userCompanies.userId, userId), eq(userCompanies.companyId, companyId)));
  return rows.length > 0;
}

export async function buildAuthContext(
  userId: string,
  companyId: string | null,
  debug = false,
): Promise<AuthContext> {
  if (await isSuperadmin(userId)) {
    return {
      userId,
      companyId,
      permissions: [...ALL_PERMISSIONS],
      locationIds: "all",
      isSuperadmin: true,
      debug,
    };
  }

  const empty: AuthContext = {
    userId,
    companyId,
    permissions: [],
    locationIds: [],
    isSuperadmin: false,
    debug,
  };
  if (!companyId) return empty;

  // The company must be one of theirs before anything else is resolved — a group
  // grants what you may do, but not where.
  if (!(await hasCompanyAccess(userId, companyId))) return empty;

  const groupIds = await userGroupIds(userId);
  if (groupIds.length === 0) return empty;

  // With the shipped roles switched off, they confer nothing — the assignments stay
  // in the database untouched, so the switch is reversible, and this is the one place
  // that has to honour it. A custom role is unaffected either way.
  const systemRoles = await getSystemSetting(SYSTEM_ROLES_SETTING);

  const permRows = await db
    .selectDistinct({ key: permissionsTable.key })
    .from(groupRoles)
    .innerJoin(roles, eq(roles.id, groupRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, groupRoles.roleId))
    .innerJoin(permissionsTable, eq(permissionsTable.id, rolePermissions.permissionId))
    .where(
      and(
        inArray(groupRoles.groupId, groupIds),
        systemRoles.enabled ? undefined : eq(roles.isSystem, false),
      ),
    );

  const locRows = await db
    .select({ locationId: userLocations.locationId })
    .from(userLocations)
    .where(eq(userLocations.userId, userId));

  // No rows means "every location of the company" — a person is unrestricted until
  // somebody narrows them to particular sites.
  const locationIds: string[] | "all" =
    locRows.length === 0 ? "all" : [...new Set(locRows.map((r) => r.locationId))];

  return {
    userId,
    companyId,
    permissions: permRows.map((r) => r.key as Permission),
    locationIds,
    isSuperadmin: false,
    debug,
  };
}
