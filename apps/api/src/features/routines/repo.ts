// Author: Brijesh Dave <https://github.com/brijeshdave>
// Data access for routine definitions and their assignees. Completions live in their
// own repo alongside this one (added with the completion flow).
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { companies, departments, routineAssignees, routines, users } from "@/core/db/schema.js";

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
export async function assigneesFor(routineIds: string[]): Promise<AssigneeRow[]> {
  if (routineIds.length === 0) return [];
  return db
    .select({
      routineId: routineAssignees.routineId,
      userId: routineAssignees.userId,
      name: users.name,
    })
    .from(routineAssignees)
    .innerJoin(users, eq(users.id, routineAssignees.userId))
    .where(inArray(routineAssignees.routineId, routineIds))
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
