// Author: Brijesh Dave <https://github.com/brijeshdave>
// Data access for routine definitions and their assignees. Completions live in their
// own repo alongside this one (added with the completion flow).
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  companies,
  departmentUserLocations,
  departments,
  routineAssignees,
  routines,
  users,
} from "@/core/db/schema.js";
import type { AuthContext, ResolvedListQuery } from "@reportly/shared";

import { withPersonLocations } from "@/core/db/scoped.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";

export interface RoutineRow {
  id: string;
  companyId: string;
  departmentId: string | null;
  departmentName: string | null;
  title: string;
  description: string | null;
  cadence: string;
  anchorWeekday: number | null;
  anchorDay: number | null;
  anchorMonthOfQuarter: number | null;
  points: number;
  startDate: string;
  graceDays: number;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const cols = {
  id: routines.id,
  companyId: routines.companyId,
  departmentId: routines.departmentId,
  departmentName: departments.name,
  title: routines.title,
  description: routines.description,
  cadence: routines.cadence,
  anchorWeekday: routines.anchorWeekday,
  anchorDay: routines.anchorDay,
  anchorMonthOfQuarter: routines.anchorMonthOfQuarter,
  points: routines.points,
  startDate: routines.startDate,
  graceDays: routines.graceDays,
  status: routines.status,
  createdBy: routines.createdBy,
  createdAt: routines.createdAt,
  updatedAt: routines.updatedAt,
};

const base = () =>
  db.select(cols).from(routines).leftJoin(departments, eq(departments.id, routines.departmentId));

export async function getRoutine(id: string, companyId: string): Promise<RoutineRow | null> {
  const [row] = await base().where(and(eq(routines.id, id), eq(routines.companyId, companyId)));
  return row ?? null;
}

/** Routines the caller created — their team's routines to manage. */
export async function managedBy(companyId: string, userId: string): Promise<RoutineRow[]> {
  return base()
    .where(and(eq(routines.companyId, companyId), eq(routines.createdBy, userId)))
    .orderBy(desc(routines.createdAt));
}

/**
 * The managed list as a real list resource: filtered, sorted and paged by the
 * server like every other table in the app.
 *
 * Two of its filters are not columns. A routine has no assignee and no site — it
 * belongs to a *department*, and departments span plants. `assigneeId` and
 * `locationId` therefore narrow by **who does it**: the routine is kept when
 * somebody assigned to it is that person, or works at that site. That is the
 * question a manager is actually asking ("what does the Kim team do?"), and it
 * composes with the department filter rather than duplicating it.
 *
 * They are pulled out of `filters` here rather than being passed separately,
 * because `buildListParts` ignores a field it does not know: left in, they would
 * narrow nothing and say nothing.
 */
const listConfig: ListConfig = {
  columns: {
    title: routines.title,
    cadence: routines.cadence,
    points: routines.points,
    status: routines.status,
    startDate: routines.startDate,
    departmentId: routines.departmentId,
    createdAt: routines.createdAt,
  },
  defaultSort: routines.title,
};

/** The filter fields answered by a subquery over the assignees rather than a column. */
const VIRTUAL_FIELDS = new Set(["assigneeId", "locationId"]);

function assigneeSubquery(field: string, values: string[]): SQL {
  const routineIds =
    field === "assigneeId"
      ? db
          .select({ id: routineAssignees.routineId })
          .from(routineAssignees)
          .where(inArray(routineAssignees.userId, values))
      : db
          .select({ id: routineAssignees.routineId })
          .from(routineAssignees)
          .innerJoin(
            departmentUserLocations,
            eq(departmentUserLocations.userId, routineAssignees.userId),
          )
          .where(inArray(departmentUserLocations.locationId, values));
  return inArray(routines.id, routineIds);
}

export async function listManagedRoutines(
  query: ResolvedListQuery,
  companyId: string,
  /** Null for a superadmin, who manages everything in the company. */
  ownerId: string | null,
): Promise<{ rows: RoutineRow[]; total: number }> {
  const virtual = query.filters.filter((f) => VIRTUAL_FIELDS.has(f.field));
  const parts = buildListParts(listConfig, {
    ...query,
    filters: query.filters.filter((f) => !VIRTUAL_FIELDS.has(f.field)),
  });

  const byPeople = virtual.map((filter) => {
    const values = (Array.isArray(filter.value) ? filter.value : [filter.value]).map(String);
    return values.length > 0 ? assigneeSubquery(filter.field, values) : undefined;
  });

  const where = and(
    eq(routines.companyId, companyId),
    ownerId ? eq(routines.createdBy, ownerId) : undefined,
    ...byPeople,
    parts.where,
  );

  const [rows, [count]] = await Promise.all([
    base().where(where).orderBy(parts.orderBy).limit(parts.limit).offset(parts.offset),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(routines)
      .where(where),
  ]);
  return { rows, total: count?.n ?? 0 };
}

/** Every routine in the company — for a superadmin's managed view. */
export async function allRoutines(companyId: string): Promise<RoutineRow[]> {
  return base().where(eq(routines.companyId, companyId)).orderBy(desc(routines.createdAt));
}

/** Every company id — for the scheduled award that runs across all of them. */
export async function allCompanyIds(): Promise<string[]> {
  const rows = await db.select({ id: companies.id }).from(companies);
  return rows.map((r) => r.id);
}

/** Routines assigned to the caller — the ones they complete. */
export async function assignedTo(companyId: string, userId: string): Promise<RoutineRow[]> {
  return base()
    .innerJoin(routineAssignees, eq(routineAssignees.routineId, routines.id))
    .where(and(eq(routines.companyId, companyId), eq(routineAssignees.userId, userId)))
    .orderBy(desc(routines.createdAt));
}

export interface AssigneeRow {
  routineId: string;
  userId: string;
  name: string;
}

/** The assignees of a set of routines, with names — for serializing them together. */
export async function assigneesFor(
  routineIds: string[],
  /** Given, only the people working at the caller's sites are returned. */
  ctx?: AuthContext,
): Promise<AssigneeRow[]> {
  if (routineIds.length === 0) return [];
  return db
    .select({
      routineId: routineAssignees.routineId,
      userId: routineAssignees.userId,
      name: users.name,
    })
    .from(routineAssignees)
    .innerJoin(users, eq(users.id, routineAssignees.userId))
    .where(
      and(
        inArray(routineAssignees.routineId, routineIds),
        // The compliance report is one row per person; a reader restricted to a
        // site should not get a row for somebody who works at another one.
        ctx ? withPersonLocations(ctx, routineAssignees.userId) : undefined,
      ),
    )
    .orderBy(asc(users.name));
}

/** Just the assignee ids of one routine — for occurrence/completion scoping. */
export async function assigneeIdsOf(routineId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: routineAssignees.userId })
    .from(routineAssignees)
    .where(eq(routineAssignees.routineId, routineId));
  return rows.map((r) => r.userId);
}

export interface NewRoutine {
  companyId: string;
  departmentId: string | null;
  title: string;
  description: string | null;
  cadence: string;
  anchorWeekday: number | null;
  anchorDay: number | null;
  anchorMonthOfQuarter: number | null;
  points: number;
  startDate: string;
  graceDays: number;
  status: string;
  createdBy: string;
}

export async function insertRoutine(fields: NewRoutine, assigneeIds: string[]): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(routines).values(fields).returning({ id: routines.id });
    if (assigneeIds.length > 0) {
      await tx
        .insert(routineAssignees)
        .values(assigneeIds.map((userId) => ({ routineId: row!.id, userId })));
    }
    return row!.id;
  });
}

export async function updateRoutineRow(
  id: string,
  companyId: string,
  fields: Partial<Omit<NewRoutine, "companyId" | "createdBy">>,
  assigneeIds: string[] | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(routines)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(routines.id, id), eq(routines.companyId, companyId)))
      .returning({ id: routines.id });
    if (!row) return false;
    if (assigneeIds) {
      await tx.delete(routineAssignees).where(eq(routineAssignees.routineId, id));
      if (assigneeIds.length > 0) {
        await tx
          .insert(routineAssignees)
          .values(assigneeIds.map((userId) => ({ routineId: id, userId })));
      }
    }
    return true;
  });
}

export async function deleteRoutineRow(id: string, companyId: string): Promise<boolean> {
  const rows = await db
    .delete(routines)
    .where(and(eq(routines.id, id), eq(routines.companyId, companyId)))
    .returning({ id: routines.id });
  return rows.length > 0;
}
