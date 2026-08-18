// Author: Brijesh Dave <https://github.com/brijeshdave>
// Department business logic: serialization, the unique-name-per-company invariant
// (surfaced as 409), the tree rules (a department cannot become its own ancestor;
// deleting one with children or members is guarded), and membership replacement
// with the HOD flag. The repository owns all DB access.
import {
  DEPARTMENT_RANKS,
  ERROR_CODES,
  type Department,
  type DepartmentMember,
  type DepartmentNode,
  type DepartmentRank,
  type DownlineMember,
  type EntityStatus,
  type OrgChartNode,
  type OrgPerson,
  type SetDepartmentMembers,
  type UserDepartment,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { avatarVersions } from "@/features/avatars/repo.js";
import { isUniqueViolation } from "@/lib/db-errors.js";
import {
  childrenOf,
  companyLocationIds,
  companyMemberIds,
  deleteDepartmentRow,
  departmentAncestry,
  departmentsForUser as departmentsForUserRows,
  downlineOf as downlineRows,
  existingUserIds,
  getDepartment as getDepartmentRow,
  getMembers as getMemberRows,
  insertDepartment,
  listDepartments as listRows,
  memberCountOf,
  orgChart as orgChartRows,
  orgPeople as orgPeopleRows,
  setMembers as setMemberRows,
  updateDepartmentFields,
  upsertDepartmentTree,
  type DepartmentAncestryRow,
  type DepartmentMemberRow,
  type DepartmentNodeRow,
  type DepartmentRow,
  type UserDepartmentRow,
} from "@/features/departments/repo.js";
import {
  DEPARTMENT_PATH_SEPARATOR,
  type DepartmentExportRow,
  type DepartmentParseResult,
} from "@/features/departments/import-parse.js";

/** The rank column is free text to Postgres; keep an unknown value from escaping
 * the boundary as a valid-looking one. */
function toRank(value: string): DepartmentRank {
  return (DEPARTMENT_RANKS as readonly string[]).includes(value)
    ? (value as DepartmentRank)
    : "member";
}

function serialize(row: DepartmentRow): Department {
  return {
    id: row.id,
    companyId: row.companyId,
    parentId: row.parentId,
    name: row.name,
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeNode(row: DepartmentNodeRow, path: string): DepartmentNode {
  return { ...serialize(row), memberCount: row.memberCount, hodCount: row.hodCount, path };
}

function serializeMember(row: DepartmentMemberRow): DepartmentMember {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    designation: row.designation,
    employeeId: row.employeeId,
    avatarVersion: null,
    rank: toRank(row.rank),
    reportsToId: row.reportsToId,
    reportsToName: row.reportsToName,
    locationIds: row.locationIds,
  };
}

function serializeUserDepartment(row: UserDepartmentRow, path: string): UserDepartment {
  return {
    departmentId: row.departmentId,
    companyId: row.companyId,
    companyName: row.companyName,
    name: row.name,
    path,
    rank: toRank(row.rank),
    reportsToId: row.reportsToId,
    reportsToName: row.reportsToName,
    locationIds: row.locationIds,
  };
}

const DUPLICATE = () =>
  new AppError(
    409,
    ERROR_CODES.CONFLICT,
    "A department with that name already exists in this company",
  );

async function requireDepartment(id: string, companyId: string): Promise<DepartmentRow> {
  const row = await getDepartmentRow(id, companyId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Department not found");
  return row;
}

/**
 * Every department's full path from the root — cycle-guarded, since parentId is
 * editable and set-null on delete, so a loop is reachable by mistake. A cycle stops
 * the walk and the department keeps whatever path was resolved: wrong but visible,
 * rather than hanging the request.
 */
function pathsByDepartment(
  rows: { id: string; parentId: string | null; name: string }[],
): Map<string, string[]> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string[]>();
  for (const row of rows) {
    const names: string[] = [];
    const seen = new Set<string>();
    let cur: { id: string; parentId: string | null; name: string } | undefined = row;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      names.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    out.set(row.id, names);
  }
  return out;
}

/** A resolved path, falling back to the bare name if the id is somehow unknown. */
function pathOf(paths: Map<string, string[]>, id: string, name: string): string {
  return (paths.get(id) ?? [name]).join(DEPARTMENT_PATH_SEPARATOR);
}

export async function listDepartments(companyId: string): Promise<DepartmentNode[]> {
  const rows = await listRows(companyId);
  const paths = pathsByDepartment(rows);
  return rows.map((row) => serializeNode(row, pathOf(paths, row.id, row.name)));
}

/* ------------------------------ Import / export ---------------------------- */

/** The flattened tree as export rows — one per department, sorted by path. */
export async function exportDepartments(companyId: string): Promise<DepartmentExportRow[]> {
  const rows = await listRows(companyId);
  const paths = pathsByDepartment(rows);
  return rows
    .map((r) => ({
      path: pathOf(paths, r.id, r.name),
      status: r.status === "inactive" ? "inactive" : "active",
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export interface DepartmentImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/**
 * Apply an uploaded department file. The whole tree is upserted by path; all-or-nothing,
 * so any bad row leaves the tree untouched and every problem comes back with its line.
 */
export async function importDepartments(
  companyId: string,
  parsed: DepartmentParseResult,
): Promise<DepartmentImportOutcome> {
  const problems = [...parsed.problems];
  if (parsed.rows.length === 0) return { created: 0, updated: 0, problems };
  if (problems.length > 0) return { created: 0, updated: 0, problems };

  const existing = await listRows(companyId);
  const paths = pathsByDepartment(existing);
  const existingByPath = new Map<string, string>();
  for (const dept of existing) {
    const key = (paths.get(dept.id) ?? [dept.name]).map((n) => n.trim().toLowerCase()).join(" › ");
    existingByPath.set(key, dept.id);
  }

  const { created, updated } = await upsertDepartmentTree(
    companyId,
    existingByPath,
    parsed.rows.map((r) => ({ segments: r.segments, status: r.status ?? "active" })),
  );
  return { created, updated, problems: [] };
}

export async function getDepartment(id: string, companyId: string): Promise<Department> {
  return serialize(await requireDepartment(id, companyId));
}

/** The parent must exist in the same company; a top-level department has none. */
async function requireValidParent(
  companyId: string,
  parentId: string | null | undefined,
): Promise<string | null> {
  if (parentId === null || parentId === undefined) return null;
  await requireDepartment(parentId, companyId);
  return parentId;
}

export async function createDepartment(
  companyId: string,
  name: string,
  parentId: string | null | undefined,
): Promise<Department> {
  const parent = await requireValidParent(companyId, parentId);
  try {
    return serialize(await insertDepartment(companyId, name, parent));
  } catch (err) {
    if (isUniqueViolation(err)) throw DUPLICATE();
    throw err;
  }
}

/**
 * Re-parenting must not create a cycle: the new parent cannot be the department
 * itself, nor any of its descendants (which would detach a subtree from the root).
 * Walks up from the proposed parent — cheap, and trees are shallow.
 */
async function assertNoCycle(id: string, companyId: string, newParentId: string): Promise<void> {
  if (newParentId === id) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "A department cannot be its own parent");
  }
  let cursor: string | null = newParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "A department cannot be moved under one of its own sub-departments",
      );
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const row: DepartmentRow = await requireDepartment(cursor, companyId);
    cursor = row.parentId;
  }
}

export async function updateDepartment(
  id: string,
  companyId: string,
  fields: { name?: string; parentId?: string | null },
): Promise<Department> {
  await requireDepartment(id, companyId);

  const patch: Partial<Pick<DepartmentRow, "name" | "parentId">> = {};
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.parentId !== undefined) {
    patch.parentId = await requireValidParent(companyId, fields.parentId);
    if (patch.parentId) await assertNoCycle(id, companyId, patch.parentId);
  }

  try {
    const row = await updateDepartmentFields(id, companyId, patch);
    return serialize(row!);
  } catch (err) {
    if (isUniqueViolation(err)) throw DUPLICATE();
    throw err;
  }
}

export async function setStatus(
  id: string,
  companyId: string,
  status: EntityStatus,
): Promise<Department> {
  await requireDepartment(id, companyId);
  const row = await updateDepartmentFields(id, companyId, { status });
  return serialize(row!);
}

/**
 * Deleting a department is refused while it has sub-departments or members, so a
 * whole subtree is never removed by surprise. The refusal names what blocks it;
 * the caller reassigns or deletes those first.
 */
export async function deleteDepartment(id: string, companyId: string): Promise<void> {
  await requireDepartment(id, companyId);
  const children = await childrenOf(id, companyId);
  if (children.length > 0) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This department has sub-departments. Move or delete them first.",
      { children: children.map((c) => ({ id: c.id, name: c.name })) },
    );
  }
  const members = await memberCountOf(id);
  if (members > 0) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This department has members. Remove them first, or deactivate it instead.",
      { members },
    );
  }
  await deleteDepartmentRow(id, companyId);
}

export async function getMembers(id: string, companyId: string): Promise<DepartmentMember[]> {
  await requireDepartment(id, companyId);
  const rows = await getMemberRows(id);
  const versions = await avatarVersions(rows.map((row) => row.userId));
  return rows.map((row) => ({
    ...serializeMember(row),
    avatarVersion: versions.get(row.userId) ?? null,
  }));
}

type MemberInput = SetDepartmentMembers["members"][number];

/**
 * Replaces the whole membership set, with each member's rank, manager and sites.
 *
 * The reporting edge is the thing report visibility will be computed from, so it is
 * validated rather than trusted:
 *
 *   - the manager must already be somebody in this company's org — you cannot report
 *     to a stranger, and a dangling edge would silently drop people out of a downline;
 *   - the edge may cross departments, deliberately: a Head of Engineering reports to
 *     Management, not to anybody inside Engineering;
 *   - it must not close a loop, or the downline walk becomes a set of people who all
 *     manage each other, and "who may see this report" has no answer.
 */
export async function setMembers(
  id: string,
  companyId: string,
  members: MemberInput[],
): Promise<void> {
  await requireDepartment(id, companyId);

  // A user listed twice cannot be both a lead and a member, or report to two people.
  const byUser = new Map<string, MemberInput>();
  for (const member of members) byUser.set(member.userId, member);
  const unique = [...byUser.values()];

  const found = await existingUserIds(unique.map((m) => m.userId));
  const missing = unique.filter((m) => !found.has(m.userId));
  if (missing.length > 0) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "One or more users do not exist", {
      userIds: missing.map((m) => m.userId),
    });
  }

  // Nobody may report to themselves — the shortest possible loop.
  const selfManaged = unique.filter((m) => m.reportsToId === m.userId);
  if (selfManaged.length > 0) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "A person cannot report to themselves", {
      userIds: selfManaged.map((m) => m.userId),
    });
  }

  await assertManagersAreInTheCompany(companyId, unique);
  await assertSitesBelongToTheCompany(companyId, unique);
  await assertNoReportingCycle(unique);

  await setMemberRows(
    id,
    unique.map((m) => ({
      userId: m.userId,
      rank: m.rank,
      reportsToId: m.reportsToId,
      locationIds: [...new Set(m.locationIds)],
    })),
  );
}

/**
 * A manager must already hold a membership somewhere in this company — including,
 * quite legitimately, in a different department from the person reporting to them.
 * A member being added in this same request counts: a whole team can be created in
 * one save.
 */
async function assertManagersAreInTheCompany(
  companyId: string,
  members: MemberInput[],
): Promise<void> {
  const named = members
    .map((m) => m.reportsToId)
    .filter((value): value is string => value !== null);
  if (named.length === 0) return;

  const inCompany = await companyMemberIds(companyId);
  const beingAdded = new Set(members.map((m) => m.userId));
  const strangers = [...new Set(named)].filter(
    (userId) => !inCompany.has(userId) && !beingAdded.has(userId),
  );

  if (strangers.length > 0) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "A manager must belong to a department in this company",
      { userIds: strangers },
    );
  }
}

/** A site must be one of the company's own locations. */
async function assertSitesBelongToTheCompany(
  companyId: string,
  members: MemberInput[],
): Promise<void> {
  const named = [...new Set(members.flatMap((m) => m.locationIds))];
  if (named.length === 0) return;

  const owned = await companyLocationIds(companyId);
  const foreign = named.filter((locationId) => !owned.has(locationId));
  if (foreign.length > 0) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "A site must be a location of this company",
      { locationIds: foreign },
    );
  }
}

/**
 * Refuse an edge that would close a loop. Walks upward from each person's proposed
 * manager, through the edges this save is about to write *and* the ones already
 * stored, and stops if it arrives back where it started.
 *
 * Postgres would survive a cycle — the downline query cuts them off — but "who is
 * above whom" would have no answer, and that question is about to decide who can
 * read whose reports.
 */
async function assertNoReportingCycle(members: MemberInput[]): Promise<void> {
  const proposed = new Map(members.map((m) => [m.userId, m.reportsToId]));

  for (const member of members) {
    if (!member.reportsToId) continue;

    const seen = new Set<string>([member.userId]);
    let cursor: string | null = member.reportsToId;

    while (cursor) {
      if (seen.has(cursor)) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_ERROR,
          "That reporting line loops back on itself",
          { userId: member.userId },
        );
      }
      seen.add(cursor);

      // This save's edges win over what is stored: they are what is about to be true.
      cursor = proposed.has(cursor)
        ? (proposed.get(cursor) ?? null)
        : await storedManagerOf(cursor);
    }
  }
}

/** Who a person reports to today, in any department. Their first edge is enough:
 * one is all it takes to close a loop. */
async function storedManagerOf(userId: string): Promise<string | null> {
  const rows = await departmentsForUserRows(userId);
  return rows.find((row) => row.reportsToId !== null)?.reportsToId ?? null;
}

/**
 * The whole organisation chart for a company: every membership, with its reporting
 * edge and the person's picture version. The client draws the forest from these.
 */
export async function orgChart(companyId: string): Promise<OrgChartNode[]> {
  const rows = await orgChartRows(companyId);
  const versions = await avatarVersions([...new Set(rows.map((row) => row.userId))]);

  return rows.map((row) => ({
    // A person in two departments occupies two places in the organisation, so the
    // node key is the membership, not the person.
    id: `${row.departmentId}:${row.userId}`,
    userId: row.userId,
    name: row.name,
    email: row.email,
    designation: row.designation,
    avatarVersion: versions.get(row.userId) ?? null,
    status: row.status,
    rank: toRank(row.rank),
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    reportsToId: row.reportsToId,
    locationIds: row.locationIds,
  }));
}

/** Everyone holding a membership in this company — the candidates for a manager. */
export async function orgPeople(companyId: string): Promise<OrgPerson[]> {
  return orgPeopleRows(companyId);
}

/**
 * Everyone below this person in the reporting line, at any depth — the set that
 * report visibility will be built on.
 */
export async function downline(userId: string): Promise<DownlineMember[]> {
  return (await downlineRows(userId)).map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    designation: row.designation,
    rank: toRank(row.rank),
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    reportsToId: row.reportsToId,
    depth: row.depth,
  }));
}

/**
 * The departments a user belongs to, across every company — each with the company
 * it is in and its path within that company's tree. Somebody in a "Maintenance" at
 * two companies gets two entries that look identical without those, and a caller
 * cannot tell them apart to save its life.
 */
export async function departmentsForUser(userId: string): Promise<UserDepartment[]> {
  const rows = await departmentsForUserRows(userId);
  const companyIds = [...new Set(rows.map((row) => row.companyId))];
  const ancestry: DepartmentAncestryRow[] = await departmentAncestry(companyIds);
  const paths = pathsByDepartment(ancestry);
  return rows.map((row) => serializeUserDepartment(row, pathOf(paths, row.departmentId, row.name)));
}
