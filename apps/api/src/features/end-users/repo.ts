// Author: Brijesh Dave <https://github.com/brijeshdave>
// The only code touching `end_users`. Reads resolve the department and the linked
// account in one join, and the entry count comes from a correlated subquery rather
// than a join — joining `journal_targets` would multiply a person into one row per
// entry and silently inflate both the page and its count.
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { departments, endUsers, users } from "@/core/db/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";
import type { ResolvedListQuery } from "@reportly/shared";

export interface EndUserRow {
  id: string;
  companyId: string;
  departmentId: string | null;
  departmentName: string | null;
  fullName: string;
  employeeNumber: string;
  description: string | null;
  status: string;
  linkedUserId: string | null;
  linkedUserName: string | null;
  entryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** How many journal entries name this person. The reason the record exists. */
const entryCount = sql<number>`(
  SELECT count(*)::int FROM journal_targets t
  WHERE t.target_kind = 'endUser' AND t.target_id = ${endUsers.id}::text
)`;

const cols = {
  id: endUsers.id,
  companyId: endUsers.companyId,
  departmentId: endUsers.departmentId,
  departmentName: departments.name,
  fullName: endUsers.fullName,
  employeeNumber: endUsers.employeeNumber,
  description: endUsers.description,
  status: endUsers.status,
  linkedUserId: endUsers.linkedUserId,
  linkedUserName: users.name,
  entryCount,
  createdAt: endUsers.createdAt,
  updatedAt: endUsers.updatedAt,
};

const base = () =>
  db
    .select(cols)
    .from(endUsers)
    .leftJoin(departments, eq(departments.id, endUsers.departmentId))
    .leftJoin(users, eq(users.id, endUsers.linkedUserId));

/**
 * What the table may be sorted and filtered by.
 *
 * Ids rather than joined names for the department, for the reason the journal's
 * severity filter taught: a filter on a joined column is invisible to the count
 * query, which then disagrees with the page it is counting.
 */
const listConfig: ListConfig = {
  columns: {
    fullName: endUsers.fullName,
    employeeNumber: endUsers.employeeNumber,
    status: endUsers.status,
    departmentId: endUsers.departmentId,
    createdAt: endUsers.createdAt,
    updatedAt: endUsers.updatedAt,
  },
  defaultSort: endUsers.fullName,
};

/**
 * One box, two columns — "search" is not a column, so it cannot ride the generic
 * filter builder.
 *
 * Name *or* employee number, because those are the two things anybody knows about
 * an end user, and which one they have depends on whether they are reading a screen
 * or a sticker on a laptop. Filters are ANDed, so a filter per column would demand
 * both.
 */
function searchCondition(query: ResolvedListQuery): SQL | undefined {
  const filter = query.filters.find((entry) => entry.field === "search");
  const term = typeof filter?.value === "string" ? filter.value.trim() : "";
  if (term === "") return undefined;
  const like = `%${term}%`;
  return or(ilike(endUsers.fullName, like), ilike(endUsers.employeeNumber, like));
}

export async function listEndUsers(
  query: ResolvedListQuery,
  companyId: string,
): Promise<{ rows: EndUserRow[]; total: number }> {
  const parts = buildListParts(listConfig, query);
  const where = and(eq(endUsers.companyId, companyId), parts.where, searchCondition(query));

  const rows = await base()
    .where(where)
    .orderBy(parts.orderBy)
    .limit(parts.limit)
    .offset(parts.offset);
  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(endUsers)
    .where(where);
  return { rows, total: counted?.count ?? 0 };
}

/**
 * The people the journal's picker offers: active only, narrowed to the departments
 * chosen on the entry.
 *
 * With no department chosen the whole active list is offered — somebody filing about
 * a contractor or a visitor has no department to narrow by, and an empty picker
 * would read as "nobody to choose".
 */
export async function pickableEndUsers(
  companyId: string,
  departmentIds: string[],
): Promise<
  { id: string; fullName: string; employeeNumber: string; departmentName: string | null }[]
> {
  const scope: SQL | undefined =
    departmentIds.length > 0 ? inArray(endUsers.departmentId, departmentIds) : undefined;
  return db
    .select({
      id: endUsers.id,
      fullName: endUsers.fullName,
      employeeNumber: endUsers.employeeNumber,
      departmentName: departments.name,
    })
    .from(endUsers)
    .leftJoin(departments, eq(departments.id, endUsers.departmentId))
    .where(and(eq(endUsers.companyId, companyId), eq(endUsers.status, "active"), scope))
    .orderBy(asc(endUsers.fullName));
}

export async function getEndUser(id: string, companyId: string): Promise<EndUserRow | null> {
  const [row] = await base().where(and(eq(endUsers.id, id), eq(endUsers.companyId, companyId)));
  return row ?? null;
}

export interface NewEndUser {
  companyId: string;
  departmentId: string | null;
  fullName: string;
  employeeNumber: string;
  description: string | null;
  status: string;
  linkedUserId: string | null;
}

export async function insertEndUser(values: NewEndUser): Promise<string> {
  const [row] = await db.insert(endUsers).values(values).returning({ id: endUsers.id });
  return row!.id;
}

export type EndUserPatch = Partial<Omit<NewEndUser, "companyId">>;

export async function updateEndUserRow(
  id: string,
  companyId: string,
  fields: EndUserPatch,
): Promise<boolean> {
  const [row] = await db
    .update(endUsers)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(endUsers.id, id), eq(endUsers.companyId, companyId)))
    .returning({ id: endUsers.id });
  return row !== undefined;
}

export async function deleteEndUserRow(id: string, companyId: string): Promise<boolean> {
  const [row] = await db
    .delete(endUsers)
    .where(and(eq(endUsers.id, id), eq(endUsers.companyId, companyId)))
    .returning({ id: endUsers.id });
  return row !== undefined;
}

/** Every end user in the company, for the import to match against and the export. */
export async function allEndUsers(companyId: string): Promise<EndUserRow[]> {
  return base().where(eq(endUsers.companyId, companyId)).orderBy(asc(endUsers.fullName));
}

/** Departments by lower-cased name, so an import can resolve the name somebody typed. */
export async function departmentsByName(companyId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.companyId, companyId));
  return new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));
}

/** Insert or correct in one pass, matched on the employee number. */
export async function upsertEndUsers(
  companyId: string,
  rows: {
    employeeNumber: string;
    fullName: string;
    departmentId: string | null;
    description: string | null;
    status: string;
  }[],
): Promise<{ created: number; updated: number }> {
  if (rows.length === 0) return { created: 0, updated: 0 };

  const existing = await db
    .select({ id: endUsers.id, employeeNumber: endUsers.employeeNumber })
    .from(endUsers)
    .where(eq(endUsers.companyId, companyId));
  const byNumber = new Map(existing.map((r) => [r.employeeNumber.trim().toLowerCase(), r.id]));

  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const id = byNumber.get(row.employeeNumber.trim().toLowerCase());
      if (id) {
        await tx
          .update(endUsers)
          .set({
            fullName: row.fullName,
            departmentId: row.departmentId,
            description: row.description,
            status: row.status,
            updatedAt: new Date(),
          })
          .where(eq(endUsers.id, id));
        updated += 1;
      } else {
        await tx.insert(endUsers).values({ companyId, ...row });
        created += 1;
      }
    }
  });
  return { created, updated };
}
