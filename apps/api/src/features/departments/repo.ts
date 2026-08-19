// Author: Brijesh Dave <https://github.com/brijeshdave>
// Department repository — the only code touching the departments and
// department_users tables. Every query is scoped to a company id so a caller can
// never reach another company's org tree.
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/core/db/index.js";
import {
  companies,
  departmentUserLocations,
  departmentUsers,
  departments,
  designations,
  locations,
  users,
} from "@/core/db/schema.js";

export interface DepartmentRow {
  id: string;
  companyId: string;
  parentId: string | null;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepartmentNodeRow extends DepartmentRow {
  memberCount: number;
  hodCount: number;
}

export interface DepartmentMemberRow {
  userId: string;
  name: string;
  email: string;
  designation: string | null;
  employeeId: string | null;
  rank: string;
  isCentral: boolean;
  reportsToId: string | null;
  reportsToName: string | null;
  locationIds: string[];
}

export interface UserDepartmentRow {
  departmentId: string;
  companyId: string;
  companyName: string;
  name: string;
  rank: string;
  isCentral: boolean;
  reportsToId: string | null;
  reportsToName: string | null;
  locationIds: string[];
}

/** Just enough of a department to resolve its ancestors into a path. */
export interface DepartmentAncestryRow {
  id: string;
  companyId: string;
  parentId: string | null;
  name: string;
}

export interface DownlineRow {
  userId: string;
  name: string;
  email: string;
  designation: string | null;
  rank: string;
  departmentId: string;
  departmentName: string;
  reportsToId: string | null;
  depth: number;
}

const cols = {
  id: departments.id,
  companyId: departments.companyId,
  parentId: departments.parentId,
  name: departments.name,
  status: departments.status,
  createdAt: departments.createdAt,
  updatedAt: departments.updatedAt,
};

/** Every department of one company with its member/HOD counts, name-ordered. The
 * tree is assembled from `parentId` by the caller. */
export async function listDepartments(companyId: string): Promise<DepartmentNodeRow[]> {
  return db
    .select({
      ...cols,
      memberCount: sql<number>`count(${departmentUsers.userId})::int`,
      hodCount: sql<number>`count(*) filter (where ${departmentUsers.rank} = 'hod')::int`,
    })
    .from(departments)
    .leftJoin(departmentUsers, eq(departmentUsers.departmentId, departments.id))
    .where(eq(departments.companyId, companyId))
    .groupBy(departments.id)
    .orderBy(departments.name);
}

/**
 * The bare tree of several companies at once — enough to resolve any of their
 * departments into a full path without one query per company.
 */
export async function departmentAncestry(companyIds: string[]): Promise<DepartmentAncestryRow[]> {
  if (companyIds.length === 0) return [];
  return db
    .select({
      id: departments.id,
      companyId: departments.companyId,
      parentId: departments.parentId,
      name: departments.name,
    })
    .from(departments)
    .where(inArray(departments.companyId, companyIds));
}

export async function getDepartment(id: string, companyId: string): Promise<DepartmentRow | null> {
  const [row] = await db
    .select(cols)
    .from(departments)
    .where(and(eq(departments.id, id), eq(departments.companyId, companyId)));
  return row ?? null;
}

export async function insertDepartment(
  companyId: string,
  name: string,
  parentId: string | null,
): Promise<DepartmentRow> {
  const [row] = await db.insert(departments).values({ companyId, name, parentId }).returning(cols);
  return row!;
}

export async function updateDepartmentFields(
  id: string,
  companyId: string,
  fields: Partial<Pick<DepartmentRow, "name" | "parentId" | "status">>,
): Promise<DepartmentRow | null> {
  const [row] = await db
    .update(departments)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(departments.id, id), eq(departments.companyId, companyId)))
    .returning(cols);
  return row ?? null;
}

/** The direct children of a department (used to guard a delete and re-parenting). */
export async function childrenOf(id: string, companyId: string): Promise<DepartmentRow[]> {
  return db
    .select(cols)
    .from(departments)
    .where(and(eq(departments.parentId, id), eq(departments.companyId, companyId)));
}

export async function memberCountOf(id: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(departmentUsers)
    .where(eq(departmentUsers.departmentId, id));
  return row?.count ?? 0;
}

export async function deleteDepartmentRow(id: string, companyId: string): Promise<void> {
  await db
    .delete(departments)
    .where(and(eq(departments.id, id), eq(departments.companyId, companyId)));
}

/** A resolved department import row: its path segments and the leaf's status. */
export interface ResolvedDepartmentImportRow {
  segments: string[];
  status: string;
}

const deptPathKey = (segments: string[]): string =>
  segments.map((s) => s.trim().toLowerCase()).join(" › ");

/**
 * Apply a department import in one transaction: for each row, walk its path creating any
 * missing ancestors (as active), then create the leaf or update its status if the path
 * already exists. `existingByPath` is the current tree keyed by lower-cased path.
 * All-or-nothing: a failure rolls the whole import back.
 */
export async function upsertDepartmentTree(
  companyId: string,
  existingByPath: Map<string, string>,
  rows: ResolvedDepartmentImportRow[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    const byPath = new Map(existingByPath);
    // Shortest paths first, so a parent's own row is applied before its children's.
    const ordered = [...rows].sort((a, b) => a.segments.length - b.segments.length);
    for (const row of ordered) {
      let parentId: string | null = null;
      for (let i = 0; i < row.segments.length; i += 1) {
        const isLeaf = i === row.segments.length - 1;
        const key = deptPathKey(row.segments.slice(0, i + 1));
        const found = byPath.get(key);
        let id: string;
        if (found) {
          id = found;
          if (isLeaf) {
            await tx
              .update(departments)
              .set({ status: row.status, updatedAt: new Date() })
              .where(and(eq(departments.id, id), eq(departments.companyId, companyId)));
            updated += 1;
          }
        } else {
          const [ins] = await tx
            .insert(departments)
            .values({
              companyId,
              name: row.segments[i]!,
              parentId,
              status: isLeaf ? row.status : "active",
            })
            .returning({ id: departments.id });
          id = ins!.id;
          byPath.set(key, id);
          if (isLeaf) created += 1;
        }
        parentId = id;
      }
    }
  });
  return { created, updated };
}

/** The manager, aliased so a membership can name a second row of `users`. */
const managers = alias(users, "managers");

/** The sites each membership covers, keyed by "departmentId:userId". */
async function locationsByMembership(departmentId: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      userId: departmentUserLocations.userId,
      locationId: departmentUserLocations.locationId,
    })
    .from(departmentUserLocations)
    .where(eq(departmentUserLocations.departmentId, departmentId));

  const byUser = new Map<string, string[]>();
  for (const row of rows) {
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.locationId]);
  }
  return byUser;
}

export async function getMembers(departmentId: string): Promise<DepartmentMemberRow[]> {
  const [rows, sites] = await Promise.all([
    db
      .select({
        userId: departmentUsers.userId,
        name: users.name,
        email: users.email,
        designation: designations.name,
        employeeId: users.employeeId,
        rank: departmentUsers.rank,
        isCentral: departmentUsers.isCentral,
        reportsToId: departmentUsers.reportsToId,
        reportsToName: managers.name,
      })
      .from(departmentUsers)
      .innerJoin(users, eq(users.id, departmentUsers.userId))
      .leftJoin(designations, eq(designations.id, users.designationId))
      .leftJoin(managers, eq(managers.id, departmentUsers.reportsToId))
      .where(eq(departmentUsers.departmentId, departmentId))
      .orderBy(users.name),
    locationsByMembership(departmentId),
  ]);

  return rows.map((row) => ({ ...row, locationIds: sites.get(row.userId) ?? [] }));
}

export interface MemberInput {
  userId: string;
  rank: string;
  isCentral: boolean;
  reportsToId: string | null;
  locationIds: string[];
}

/** Replaces the whole membership set of a department in one transaction. */
export async function setMembers(departmentId: string, members: MemberInput[]): Promise<void> {
  await db.transaction(async (tx) => {
    // The sites cascade from the membership rows, so they go with them.
    await tx.delete(departmentUsers).where(eq(departmentUsers.departmentId, departmentId));
    if (members.length === 0) return;

    await tx.insert(departmentUsers).values(
      members.map((m) => ({
        departmentId,
        userId: m.userId,
        rank: m.rank,
        isCentral: m.isCentral,
        reportsToId: m.reportsToId,
      })),
    );

    const sites = members.flatMap((m) =>
      m.locationIds.map((locationId) => ({ departmentId, userId: m.userId, locationId })),
    );
    if (sites.length > 0) await tx.insert(departmentUserLocations).values(sites);
  });
}

/** The user ids that exist (to reject an assignment naming an unknown user). */
export async function existingUserIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
  return new Set(rows.map((r) => r.id));
}

/** The ids of people who hold a membership in any department of this company. A
 * manager must be one of them — you cannot report to a stranger. */
export async function companyMemberIds(companyId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ userId: departmentUsers.userId })
    .from(departmentUsers)
    .innerJoin(departments, eq(departments.id, departmentUsers.departmentId))
    .where(eq(departments.companyId, companyId));
  return new Set(rows.map((r) => r.userId));
}

/** The location ids that belong to this company (a site must be one of its own). */
export async function companyLocationIds(companyId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.companyId, companyId));
  return new Set(rows.map((r) => r.id));
}

export interface OrgPersonRow {
  userId: string;
  name: string;
  email: string;
  designation: string | null;
  departmentNames: string[];
}

/** Everyone holding a membership anywhere in this company — the only people a
 * reporting edge may name. */
export async function orgPeople(companyId: string): Promise<OrgPersonRow[]> {
  const rows = await db
    .select({
      userId: departmentUsers.userId,
      name: users.name,
      email: users.email,
      designation: designations.name,
      departmentName: departments.name,
    })
    .from(departmentUsers)
    .innerJoin(departments, eq(departments.id, departmentUsers.departmentId))
    .innerJoin(users, eq(users.id, departmentUsers.userId))
    .leftJoin(designations, eq(designations.id, users.designationId))
    .where(eq(departments.companyId, companyId))
    .orderBy(users.name);

  const byUser = new Map<string, OrgPersonRow>();
  for (const row of rows) {
    const existing = byUser.get(row.userId);
    if (existing) existing.departmentNames.push(row.departmentName);
    else byUser.set(row.userId, { ...row, departmentNames: [row.departmentName] });
  }
  return [...byUser.values()];
}

export interface OrgChartRow {
  userId: string;
  name: string;
  email: string;
  designation: string | null;
  status: string;
  rank: string;
  departmentId: string;
  departmentName: string;
  reportsToId: string | null;
  locationIds: string[];
}

/** Every membership in the company, with its reporting edge — the whole chart in
 * one query, so the page draws it without a request per node. */
export async function orgChart(companyId: string): Promise<OrgChartRow[]> {
  const rows = await db
    .select({
      userId: departmentUsers.userId,
      name: users.name,
      email: users.email,
      designation: designations.name,
      status: users.status,
      rank: departmentUsers.rank,
      departmentId: departments.id,
      departmentName: departments.name,
      reportsToId: departmentUsers.reportsToId,
    })
    .from(departmentUsers)
    .innerJoin(departments, eq(departments.id, departmentUsers.departmentId))
    .innerJoin(users, eq(users.id, departmentUsers.userId))
    .leftJoin(designations, eq(designations.id, users.designationId))
    .where(eq(departments.companyId, companyId))
    .orderBy(users.name);

  const sites = await db
    .select({
      departmentId: departmentUserLocations.departmentId,
      userId: departmentUserLocations.userId,
      locationId: departmentUserLocations.locationId,
    })
    .from(departmentUserLocations)
    .innerJoin(departments, eq(departments.id, departmentUserLocations.departmentId))
    .where(eq(departments.companyId, companyId));

  return rows.map((row) => ({
    ...row,
    locationIds: sites
      .filter((s) => s.departmentId === row.departmentId && s.userId === row.userId)
      .map((s) => s.locationId),
  }));
}

/** The departments a user belongs to, across every company. */
export async function departmentsForUser(userId: string): Promise<UserDepartmentRow[]> {
  const rows = await db
    .select({
      departmentId: departments.id,
      companyId: departments.companyId,
      companyName: companies.name,
      name: departments.name,
      rank: departmentUsers.rank,
      isCentral: departmentUsers.isCentral,
      reportsToId: departmentUsers.reportsToId,
      reportsToName: managers.name,
    })
    .from(departmentUsers)
    .innerJoin(departments, eq(departments.id, departmentUsers.departmentId))
    .innerJoin(companies, eq(companies.id, departments.companyId))
    .leftJoin(managers, eq(managers.id, departmentUsers.reportsToId))
    .where(eq(departmentUsers.userId, userId))
    .orderBy(departments.name);

  const sites = await db
    .select({
      departmentId: departmentUserLocations.departmentId,
      locationId: departmentUserLocations.locationId,
    })
    .from(departmentUserLocations)
    .where(eq(departmentUserLocations.userId, userId));

  return rows.map((row) => ({
    ...row,
    locationIds: sites.filter((s) => s.departmentId === row.departmentId).map((s) => s.locationId),
  }));
}

/**
 * Everyone below `userId` in the reporting line, at any depth.
 *
 * This is the set report visibility will be built on, so it is computed by walking
 * the reporting edges themselves — never inferred from rank or from where somebody
 * sits in the department tree. A recursive CTE does the walk in one round trip;
 * `cycle` makes Postgres stop rather than spin should a loop ever reach the table
 * despite the service refusing to create one.
 */
export async function downlineOf(userId: string): Promise<DownlineRow[]> {
  const result = await db.execute<{
    user_id: string;
    name: string;
    email: string;
    designation: string | null;
    rank: string;
    department_id: string;
    department_name: string;
    reports_to_id: string | null;
    depth: number;
  }>(sql`
    WITH RECURSIVE downline AS (
      SELECT du.user_id, du.department_id, du.rank, du.reports_to_id, 1 AS depth
      FROM department_users du
      WHERE du.reports_to_id = ${userId}

      UNION ALL

      SELECT du.user_id, du.department_id, du.rank, du.reports_to_id, d.depth + 1
      FROM department_users du
      JOIN downline d ON du.reports_to_id = d.user_id
    ) CYCLE user_id SET is_cycle USING path
    SELECT DISTINCT ON (dl.user_id, dl.department_id)
           dl.user_id,
           u.name,
           u.email,
           dg.name AS designation,
           dl.rank,
           dl.department_id,
           dept.name AS department_name,
           dl.reports_to_id,
           dl.depth
    FROM downline dl
    JOIN users u ON u.id = dl.user_id
    LEFT JOIN designations dg ON dg.id = u.designation_id
    JOIN departments dept ON dept.id = dl.department_id
    WHERE NOT dl.is_cycle
    ORDER BY dl.user_id, dl.department_id, dl.depth
  `);

  return (
    result.rows
      .map((row) => ({
        userId: row.user_id,
        name: row.name,
        email: row.email,
        designation: row.designation,
        rank: row.rank,
        departmentId: row.department_id,
        departmentName: row.department_name,
        reportsToId: row.reports_to_id,
        depth: Number(row.depth),
      }))
      // Shallowest first, so the chain reads downward. The SELECT DISTINCT ON has
      // to order by the key it de-duplicates on, so it cannot do this itself — and
      // a list that puts a Head of Department *below* their own juniors, indented
      // under them, says the opposite of what is true.
      .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))
  );
}

/**
 * Everyone above `userId` in the reporting line — the mirror of `downlineOf`.
 *
 * Notifications need the direction nothing needed before: report visibility looks
 * down, but "somebody filed work that needs your review" looks up. It walks the
 * same edges in reverse rather than inferring anything from rank, because rank is
 * a label and the edge is the fact — the distinction the reporting line was built
 * on.
 *
 * Depth-capped. Uncapped, a filing at the bottom of a deep organisation notifies
 * every manager up to the director, which is how a notification feature becomes
 * the thing people mute. The cap is the caller's, so a future "escalate to the
 * top" has somewhere to say so.
 *
 * `CYCLE` stops Postgres rather than letting it spin, should a loop ever reach the
 * table despite the service refusing to create one.
 */
export interface UplineRow {
  userId: string;
  depth: number;
}

export async function uplineOf(userId: string, maxDepth = 3): Promise<UplineRow[]> {
  const result = await db.execute<{ user_id: string; depth: number }>(sql`
    WITH RECURSIVE upline AS (
      SELECT du.reports_to_id AS user_id, 1 AS depth
      FROM department_users du
      WHERE du.user_id = ${userId} AND du.reports_to_id IS NOT NULL

      UNION ALL

      SELECT du.reports_to_id AS user_id, up.depth + 1
      FROM upline up
      JOIN department_users du ON du.user_id = up.user_id
      WHERE du.reports_to_id IS NOT NULL AND up.depth < ${maxDepth}
    ) CYCLE user_id SET is_cycle USING path
    SELECT DISTINCT ON (up.user_id) up.user_id, up.depth
    FROM upline up
    WHERE NOT up.is_cycle
    ORDER BY up.user_id, up.depth
  `);

  return result.rows
    .map((row) => ({ userId: row.user_id, depth: Number(row.depth) }))
    .sort((a, b) => a.depth - b.depth);
}
