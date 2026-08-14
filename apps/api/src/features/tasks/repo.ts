// Author: Brijesh Dave <https://github.com/brijeshdave>
// Task repository — the only code touching the tasks table. Reads resolve the
// assignee, assigner and department names in one join, so a list never needs a
// second round trip.
import { type SQL, and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/core/db/index.js";
import { departments, journalEntries, tasks, users } from "@/core/db/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";
import { TASK_CLOSED_STATES, type ResolvedListQuery } from "@reportly/shared";

export interface TaskRowRaw {
  id: string;
  companyId: string;
  title: string;
  detail: string | null;
  assigneeId: string;
  assigneeName: string;
  assignerId: string | null;
  assignerName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  dueAt: Date | null;
  priority: string;
  state: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const assignee = alias(users, "assignee");
const assigner = alias(users, "assigner");

const cols = {
  id: tasks.id,
  companyId: tasks.companyId,
  title: tasks.title,
  detail: tasks.detail,
  assigneeId: tasks.assigneeId,
  assigneeName: assignee.name,
  assignerId: tasks.assignerId,
  assignerName: assigner.name,
  departmentId: tasks.departmentId,
  departmentName: departments.name,
  dueAt: tasks.dueAt,
  priority: tasks.priority,
  state: tasks.state,
  completedAt: tasks.completedAt,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
};

function selectTasks() {
  return db
    .select(cols)
    .from(tasks)
    .innerJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .leftJoin(assigner, eq(assigner.id, tasks.assignerId))
    .leftJoin(departments, eq(departments.id, tasks.departmentId));
}

const listConfig: ListConfig = {
  columns: {
    title: tasks.title,
    state: tasks.state,
    priority: tasks.priority,
    dueAt: tasks.dueAt,
    createdAt: tasks.createdAt,
    assigneeId: tasks.assigneeId,
  },
  defaultSort: tasks.createdAt,
};

export async function getTask(id: string): Promise<TaskRowRaw | null> {
  const [row] = await selectTasks().where(eq(tasks.id, id));
  return row ?? null;
}

/**
 * A page of tasks the caller may see: the ones assigned to them, the ones they
 * handed out, and anything on their downline's plate. `visibleUserIds` is null for a
 * caller who may see everybody (superadmin).
 */
export async function listTasks(
  query: ResolvedListQuery,
  callerId: string,
  visibleUserIds: string[] | null,
  companyId: string | null,
): Promise<{ rows: TaskRowRaw[]; total: number }> {
  const parts = buildListParts(listConfig, query);

  const scope: SQL | undefined = visibleUserIds
    ? sql`(${tasks.assignerId} = ${callerId} OR ${inArray(tasks.assigneeId, visibleUserIds)})`
    : undefined;

  const companyScope = companyId ? eq(tasks.companyId, companyId) : undefined;
  const where = and(scope, companyScope, parts.where);

  const rows = await selectTasks()
    .where(where)
    .orderBy(parts.orderBy)
    .limit(parts.limit)
    .offset(parts.offset);

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(where);

  return { rows, total: counted?.count ?? 0 };
}

/**
 * Unfinished work assigned to this person, soonest due first — the home screen's
 * task tile. Tasks with no due date sort last: an undated task is not urgent, it is
 * unscheduled, and letting NULL sort first would bury everything that is actually
 * due.
 *
 * "Unfinished" comes from the shared `TASK_CLOSED_STATES`, not from a local
 * `!== 'done'`: a fifth state added later must not silently start appearing on
 * everyone's home screen because this file listed the other four by hand.
 */
export async function openTasksFor(
  userId: string,
  companyId: string,
  limit: number,
): Promise<TaskRowRaw[]> {
  return selectTasks()
    .where(
      and(
        eq(tasks.companyId, companyId),
        eq(tasks.assigneeId, userId),
        notInArray(tasks.state, [...TASK_CLOSED_STATES]),
      ),
    )
    .orderBy(sql`${tasks.dueAt} asc nulls last`)
    .limit(limit);
}

/** Open tasks the caller *assigned* to others — their oversight list, so they can
 *  chase the work they handed out to completion. Soonest due first. */
export async function openTasksAssignedBy(
  userId: string,
  companyId: string,
): Promise<TaskRowRaw[]> {
  return selectTasks()
    .where(
      and(
        eq(tasks.companyId, companyId),
        eq(tasks.assignerId, userId),
        notInArray(tasks.state, [...TASK_CLOSED_STATES]),
      ),
    )
    .orderBy(sql`${tasks.dueAt} asc nulls last`);
}

export interface NewTask {
  companyId: string;
  title: string;
  detail: string | null;
  assigneeId: string;
  assignerId: string;
  departmentId: string | null;
  dueAt: Date | null;
  priority: string;
}

export async function insertTask(values: NewTask): Promise<string> {
  const [row] = await db.insert(tasks).values(values).returning({ id: tasks.id });
  return row!.id;
}

export type TaskPatch = Partial<{
  title: string;
  detail: string | null;
  assigneeId: string;
  departmentId: string | null;
  dueAt: Date | null;
  priority: string;
  state: string;
  completedAt: Date | null;
}>;

export async function updateTaskRow(id: string, fields: TaskPatch): Promise<void> {
  await db
    .update(tasks)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

export async function deleteTaskRow(id: string): Promise<void> {
  await db.delete(tasks).where(eq(tasks.id, id));
}

/** The work reports filed against a task — the record, linked back to the intent. */
export async function reportsForTask(
  taskId: string,
): Promise<{ id: string; title: string; state: string }[]> {
  return db
    .select({ id: journalEntries.id, title: journalEntries.title, state: journalEntries.state })
    .from(journalEntries)
    .where(eq(journalEntries.taskId, taskId))
    .orderBy(asc(journalEntries.createdAt));
}
