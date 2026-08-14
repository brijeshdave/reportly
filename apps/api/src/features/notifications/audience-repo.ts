// Author: Brijesh Dave <https://github.com/brijeshdave>
// The reads that turn an event into a list of people, and a list of people into
// what each of them can actually receive.
//
// Every one is company-scoped. A recipient who is not in the event's company is
// not a recipient — that is the whole boundary, and it is enforced here rather
// than trusted to each of the dozen call sites that emit.
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  departmentUsers,
  groupRoles,
  groupUsers,
  groups,
  permissions as permissionsTable,
  rolePermissions,
  userCompanies,
  users,
} from "@/core/db/schema.js";

const SUPERADMIN_GROUP = "Superadmin";

/**
 * Keep only the candidates who belong to this company.
 *
 * The last gate before anyone is written a notification. Superadmins are members
 * of every company by construction, so they pass without a `user_companies` row —
 * the same rule `hasCompanyAccess` applies.
 */
export async function membersOfCompany(
  candidateIds: string[],
  companyId: string,
): Promise<string[]> {
  if (candidateIds.length === 0) return [];

  const [assigned, superadmins] = await Promise.all([
    db
      .selectDistinct({ userId: userCompanies.userId })
      .from(userCompanies)
      .where(
        and(inArray(userCompanies.userId, candidateIds), eq(userCompanies.companyId, companyId)),
      ),
    db
      .selectDistinct({ userId: groupUsers.userId })
      .from(groupUsers)
      .innerJoin(groups, eq(groups.id, groupUsers.groupId))
      .where(
        and(
          inArray(groupUsers.userId, candidateIds),
          eq(groups.name, SUPERADMIN_GROUP),
          eq(groups.isSystem, true),
        ),
      ),
  ]);

  const allowed = new Set([...assigned, ...superadmins].map((r) => r.userId));
  // Preserve the caller's order; audiences are built nearest-first.
  return candidateIds.filter((id) => allowed.has(id));
}

/** Everyone in a department, at any rank. The department belongs to a company, so
 *  the caller still passes the event's company and the result is filtered by it. */
export async function membersOfDepartment(
  departmentId: string,
  companyId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: departmentUsers.userId })
    .from(departmentUsers)
    .where(eq(departmentUsers.departmentId, departmentId));
  return membersOfCompany(
    rows.map((r) => r.userId),
    companyId,
  );
}

/**
 * Everyone who holds a permission, anywhere on the installation.
 *
 * For events that belong to no tenant — a failed backup, a jammed queue. There is
 * deliberately no company filter: the whole point is that the event is about the
 * server, so narrowing to one company would silently drop the operator who
 * happens to be a member of a different one.
 *
 * Resolved the same way `buildAuthContext` resolves it — group → role →
 * permission — because two different answers to "who may do this" is how a
 * notification reaches somebody who cannot open the page it links to.
 * Superadmins hold everything implicitly and have no grants to find, so they are
 * unioned in.
 */
export async function holdersOfPermissionAnywhere(permission: string): Promise<string[]> {
  const [granted, superadmins] = await Promise.all([
    db
      .selectDistinct({ userId: groupUsers.userId })
      .from(groupUsers)
      .innerJoin(groupRoles, eq(groupRoles.groupId, groupUsers.groupId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, groupRoles.roleId))
      .innerJoin(permissionsTable, eq(permissionsTable.id, rolePermissions.permissionId))
      .where(eq(permissionsTable.key, permission)),
    db
      .selectDistinct({ userId: groupUsers.userId })
      .from(groupUsers)
      .innerJoin(groups, eq(groups.id, groupUsers.groupId))
      .where(and(eq(groups.name, SUPERADMIN_GROUP), eq(groups.isSystem, true))),
  ]);

  const ids = [...new Set([...granted, ...superadmins].map((row) => row.userId))];
  if (ids.length === 0) return [];

  // Still only active accounts: a deactivated administrator should not be sent
  // operational mail about a server they can no longer sign in to.
  const active = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.status, "active")));
  return active.map((row) => row.id);
}

/* ------------------------------ deliverability ----------------------------- */

/** Where a person can be reached, and whether each destination is proven. */
export interface ContactRow {
  userId: string;
  name: string;
  email: string;
  mobile: string | null;
  whatsappOnMobile: boolean;
  telegramOnMobile: boolean;
  discordHandle: string | null;
  mobileVerifiedAt: Date | null;
  whatsappVerifiedAt: Date | null;
  telegramVerifiedAt: Date | null;
  discordVerifiedAt: Date | null;
}

export async function contactsFor(userIds: string[]): Promise<ContactRow[]> {
  if (userIds.length === 0) return [];
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      mobile: users.mobile,
      whatsappOnMobile: users.whatsappOnMobile,
      telegramOnMobile: users.telegramOnMobile,
      discordHandle: users.discordHandle,
      mobileVerifiedAt: users.mobileVerifiedAt,
      whatsappVerifiedAt: users.whatsappVerifiedAt,
      telegramVerifiedAt: users.telegramVerifiedAt,
      discordVerifiedAt: users.discordVerifiedAt,
    })
    .from(users)
    .where(and(inArray(users.id, userIds), eq(users.status, "active")));
}
