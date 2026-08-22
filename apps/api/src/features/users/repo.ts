// Author: Brijesh Dave <https://github.com/brijeshdave>
// User repository — the only code touching the users table for profile/admin
// operations (better-auth owns auth-table writes). Services call these.
import { and, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  companies,
  designations,
  groupRoles,
  groupUsers,
  groups,
  permissions,
  locations,
  rolePermissions,
  roles,
  sessions,
  userCompanies,
  userLocations,
  users,
} from "@/core/db/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";
import type { ResolvedListQuery } from "@reportly/shared";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  designationId: string | null;
  /** The catalogue name, resolved by the join. Read-only. */
  designation: string | null;
  employeeId: string | null;
  countsOnLeaderboard: boolean;
  mobile: string | null;
  whatsappOnMobile: boolean;
  telegramOnMobile: boolean;
  discordHandle: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  mobileVerifiedAt: Date | null;
  whatsappVerifiedAt: Date | null;
  telegramVerifiedAt: Date | null;
  discordVerifiedAt: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const SUPERADMIN_GROUP = "Superadmin";

const cols = {
  id: users.id,
  name: users.name,
  email: users.email,
  username: users.username,
  avatarUrl: users.avatarUrl,
  designationId: users.designationId,
  designation: designations.name,
  employeeId: users.employeeId,
  countsOnLeaderboard: users.countsOnLeaderboard,
  mobile: users.mobile,
  whatsappOnMobile: users.whatsappOnMobile,
  telegramOnMobile: users.telegramOnMobile,
  discordHandle: users.discordHandle,
  emailVerified: users.emailVerified,
  twoFactorEnabled: users.twoFactorEnabled,
  mobileVerifiedAt: users.mobileVerifiedAt,
  whatsappVerifiedAt: users.whatsappVerifiedAt,
  telegramVerifiedAt: users.telegramVerifiedAt,
  discordVerifiedAt: users.discordVerifiedAt,
  status: users.status,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

const listConfig: ListConfig = {
  columns: {
    name: users.name,
    email: users.email,
    username: users.username,
    designation: designations.name,
    employeeId: users.employeeId,
    mobile: users.mobile,
    status: users.status,
    createdAt: users.createdAt,
  },
  defaultSort: users.name,
};

export async function listUsers(
  query: ResolvedListQuery,
): Promise<{ rows: UserRow[]; total: number }> {
  const { where, orderBy, limit, offset } = buildListParts(listConfig, query);
  const rows = await db
    .select(cols)
    .from(users)
    .leftJoin(designations, eq(designations.id, users.designationId))
    .where(where)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);
  const counted = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(where);
  return { rows, total: counted[0]?.count ?? 0 };
}

/** Every read of a user resolves their designation name through the catalogue. */
const withDesignation = () =>
  db.select(cols).from(users).leftJoin(designations, eq(designations.id, users.designationId));

export async function getUserById(id: string): Promise<UserRow | null> {
  const [row] = await withDesignation().where(eq(users.id, id));
  return row ?? null;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const [row] = await withDesignation().where(eq(users.email, email));
  return row ?? null;
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const [row] = await withDesignation().where(eq(users.username, username));
  return row ?? null;
}

/**
 * Match people to the identities somebody typed at a login form.
 *
 * Both columns, and case-insensitively, because a login accepts either and does not
 * care about capitalisation — so `Banti.Patel` at the form must find the row that
 * stores `banti.patel`, or the lockout badge lands on nobody.
 */
export async function usersByIdentities(
  identities: string[],
): Promise<{ id: string; email: string; username: string | null }[]> {
  if (identities.length === 0) return [];
  const wanted = identities.map((identity) => identity.toLowerCase());
  return db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(
      or(
        inArray(sql`lower(${users.email})`, wanted),
        inArray(sql`lower(${users.username})`, wanted),
      ),
    );
}

/** The profile fields a user is created with. A credential account, if any, is
 * added separately — better-auth owns that table. */
export interface NewUser {
  id: string;
  name: string;
  email: string;
  username: string;
  designationId?: string | null;
  employeeId?: string | null;
  countsOnLeaderboard?: boolean;
  mobile?: string | null;
  whatsappOnMobile?: boolean;
  telegramOnMobile?: boolean;
  discordHandle?: string | null;
  status?: string;
  mustChangePassword?: boolean;
}

// A write cannot RETURNING a column that lives on another table, and the
// designation name now does — so the row is read back through the join instead.
export async function insertUser(fields: NewUser): Promise<UserRow> {
  const [inserted] = await db
    .insert(users)
    .values({
      ...fields,
      // What the admin typed, preserved for display; `username` is the lowercased
      // key better-auth matches a login against.
      displayUsername: fields.username,
      status: fields.status ?? "active",
    })
    .returning({ id: users.id });
  return (await getUserById(inserted!.id))!;
}

export async function updateUserRow(
  id: string,
  fields: Partial<
    Pick<
      UserRow,
      | "name"
      | "avatarUrl"
      | "designationId"
      | "employeeId"
      | "countsOnLeaderboard"
      | "username"
      | "mobile"
      | "whatsappOnMobile"
      | "telegramOnMobile"
      | "discordHandle"
      | "status"
    >
  > & { displayUsername?: string; mustChangePassword?: boolean },
): Promise<UserRow | null> {
  const [updated] = await db
    .update(users)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return updated ? getUserById(updated.id) : null;
}

export async function isSuperadminMember(userId: string): Promise<boolean> {
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

/** Count OTHER active members of the Superadmin group (excludes `userId`). */
export async function countOtherActiveSuperadmins(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(groupUsers)
    .innerJoin(groups, eq(groups.id, groupUsers.groupId))
    .innerJoin(users, eq(users.id, groupUsers.userId))
    .where(
      and(
        eq(groups.name, SUPERADMIN_GROUP),
        eq(groups.isSystem, true),
        eq(users.status, "active"),
        ne(users.id, userId),
      ),
    );
  return rows[0]?.count ?? 0;
}

/** One of a user's live sessions. `token` identifies it for revocation. */
export interface SessionRow {
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/** Sessions that have not yet expired, newest first. */
export async function listUserSessions(userId: string): Promise<SessionRow[]> {
  return db
    .select({
      token: sessions.token,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.createdAt));
}

/** The user a session token belongs to, so a revoke cannot cross accounts. */
export async function userIdForSessionToken(token: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.token, token));
  return row?.userId ?? null;
}

// --- where a person may work: their companies, and the sites within them ---

export async function getUserCompanyIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ companyId: userCompanies.companyId })
    .from(userCompanies)
    .where(eq(userCompanies.userId, userId));
  return rows.map((r) => r.companyId);
}

export async function getUserLocationIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ locationId: userLocations.locationId })
    .from(userLocations)
    .where(eq(userLocations.userId, userId));
  return rows.map((r) => r.locationId);
}

export async function setUserCompanies(userId: string, companyIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(userCompanies).where(eq(userCompanies.userId, userId));
    if (companyIds.length > 0) {
      await tx.insert(userCompanies).values(companyIds.map((companyId) => ({ userId, companyId })));
    }
  });
}

export async function setUserLocations(userId: string, locationIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(userLocations).where(eq(userLocations.userId, userId));
    if (locationIds.length > 0) {
      await tx
        .insert(userLocations)
        .values(locationIds.map((locationId) => ({ userId, locationId })));
    }
  });
}

/** Company id for each of the given location ids — for validating a scope save. */
export async function companiesForLocationIds(
  locationIds: string[],
): Promise<{ id: string; companyId: string }[]> {
  if (locationIds.length === 0) return [];
  return db
    .select({ id: locations.id, companyId: locations.companyId })
    .from(locations)
    .where(inArray(locations.id, locationIds));
}

// --- group membership, and what it adds up to ---

export async function setUserGroups(userId: string, groupIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(groupUsers).where(eq(groupUsers.userId, userId));
    if (groupIds.length > 0) {
      await tx.insert(groupUsers).values(groupIds.map((groupId) => ({ groupId, userId })));
    }
  });
}

/**
 * The roles a person ends up with, and the permissions those add up to — the answer
 * to "why can they do that". Derived from their groups, exactly as the auth context
 * derives it, rather than recomputed from a second rule.
 */
export async function effectiveAccess(
  userId: string,
): Promise<{ roles: { id: string; name: string; isSystem: boolean }[]; permissions: string[] }> {
  const roleRows = await db
    .selectDistinct({ id: roles.id, name: roles.name, isSystem: roles.isSystem })
    .from(groupUsers)
    .innerJoin(groupRoles, eq(groupRoles.groupId, groupUsers.groupId))
    .innerJoin(roles, eq(roles.id, groupRoles.roleId))
    .where(eq(groupUsers.userId, userId))
    .orderBy(roles.name);

  const permRows = await db
    .selectDistinct({ key: permissions.key })
    .from(groupUsers)
    .innerJoin(groupRoles, eq(groupRoles.groupId, groupUsers.groupId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, groupRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(groupUsers.userId, userId));

  return { roles: roleRows, permissions: permRows.map((r) => r.key).sort() };
}

/* ------------------------------ Import / export ---------------------------- */

/** Designations by name (active + inactive), for resolving an import. */
export async function designationsByName(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: designations.id, name: designations.name }).from(designations);
}

/** Companies by name, for resolving an import's company placement. */
export async function companiesByName(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: companies.id, name: companies.name }).from(companies);
}

/** Groups by name (with the system flag), for resolving an import's group placement. */
export async function groupsByName(): Promise<{ id: string; name: string; isSystem: boolean }[]> {
  return db.select({ id: groups.id, name: groups.name, isSystem: groups.isSystem }).from(groups);
}

/** One exportable user row, designation name resolved. */
export interface UserExportRaw {
  id: string;
  name: string;
  email: string;
  username: string;
  employeeId: string | null;
  designation: string | null;
  mobile: string | null;
  status: string;
}

/** Every user with their designation name — the base of the export and the import match. */
export async function allUsersForExport(): Promise<UserExportRaw[]> {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      employeeId: users.employeeId,
      designation: designations.name,
      mobile: users.mobile,
      status: users.status,
    })
    .from(users)
    .leftJoin(designations, eq(designations.id, users.designationId))
    .orderBy(users.name);
}

/** Group names per user id — for the export's Groups column. */
export async function groupNamesByUser(): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ userId: groupUsers.userId, name: groups.name })
    .from(groupUsers)
    .innerJoin(groups, eq(groups.id, groupUsers.groupId))
    .orderBy(groups.name);
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push(r.name);
    out.set(r.userId, list);
  }
  return out;
}

/** Company names per user id — for the export's Companies column. */
export async function companyNamesByUser(): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ userId: userCompanies.userId, name: companies.name })
    .from(userCompanies)
    .innerJoin(companies, eq(companies.id, userCompanies.companyId))
    .orderBy(companies.name);
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push(r.name);
    out.set(r.userId, list);
  }
  return out;
}
