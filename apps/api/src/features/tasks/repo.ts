// Author: Brijesh Dave <https://github.com/brijeshdave>
// Task repository — the only code touching the tasks table. Reads resolve the
// assigner and department names in one join, so a list never needs a second round
// trip; the people on a task come from `task_assignees` in one further query for
// the whole page rather than one per row.
import { type SQL, and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/core/db/index.js";
import {
  departments,
  journalEntries,
  taskAssignees,
  taskHandovers,
  tasks,
  users,
} from "@/core/db/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";
import { TASK_CLOSED_STATES, UNASSIGNED, type ResolvedListQuery } from "@reportly/shared";

export interface TaskRowRaw {
  id: string;
  companyId: string;
  title: string;
  detail: string | null;
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

const assigner = alias(users, "assigner");

const cols = {
  id: tasks.id,
  companyId: tasks.companyId,
  title: tasks.title,
  detail: tasks.detail,
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
  },
  defaultSort: tasks.createdAt,
};

export async function getTask(id: string): Promise<TaskRowRaw | null> {
  const [row] = await selectTasks().where(eq(tasks.id, id));
  return row ?? null;
}

/** True where somebody in `ids` is still on the task. A correlated EXISTS rather
 *  than a join: joining the assignee table multiplies a two-person task into two
 *  rows, which silently doubles both the page and the count. */
function heldByAny(ids: string[]): SQL {
  return sql`EXISTS (
    SELECT 1 FROM task_assignees ta
    WHERE ta.task_id = ${tasks.id} AND ta.released_at IS NULL
      AND ta.user_id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
  )`;
}

/** True where nobody is on the task — planned ahead, not yet handed out. */
const unassigned = sql`NOT EXISTS (
  SELECT 1 FROM task_assignees ta
  WHERE ta.task_id = ${tasks.id} AND ta.released_at IS NULL
)`;

/**
 * A page of tasks the caller may see: the ones assigned to them, the ones they
 * handed out, and anything on their downline's plate. `visibleUserIds` is null for a
 * caller who may see everybody (superadmin).
 *
 * A task with nobody on it is visible to whoever created it — otherwise planning
 * work in advance would make it disappear the moment it was saved.
 */
export async function listTasks(
  query: ResolvedListQuery,
  callerId: string,
  visibleUserIds: string[] | null,
  companyId: string | null,
): Promise<{ rows: TaskRowRaw[]; total: number }> {
  // The assignee filter is membership of another table, not a column on this one,
  // so it is lifted out before the generic list builder sees a field it cannot map.
  const assigneeFilters = query.filters.filter((f) => f.field === "assigneeId");
  const parts = buildListParts(listConfig, {
    ...query,
    filters: query.filters.filter((f) => f.field !== "assigneeId"),
  });

  const chosen = assigneeFilters.flatMap((f) =>
    (Array.isArray(f.value) ? f.value : [f.value]).map(String).filter(Boolean),
  );
  const wantsUnassigned = chosen.includes(UNASSIGNED);
  const wantedPeople = chosen.filter((id) => id !== UNASSIGNED);
  const assigneeWhere: SQL | undefined =
    chosen.length === 0
      ? undefined
      : wantsUnassigned && wantedPeople.length > 0
        ? sql`(${unassigned} OR ${heldByAny(wantedPeople)})`
        : wantsUnassigned
          ? unassigned
          : heldByAny(wantedPeople);

  const scope: SQL | undefined = visibleUserIds
    ? sql`(${tasks.assignerId} = ${callerId} OR ${heldByAny(visibleUserIds)})`
    : undefined;

  const companyScope = companyId ? eq(tasks.companyId, companyId) : undefined;
  const where = and(scope, companyScope, assigneeWhere, parts.where);

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
        heldByAny([userId]),
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

// --- who is on a task ---

export interface TaskPerson {
  taskId: string;
  userId: string;
  name: string;
  released: boolean;
}

/** Everybody who has been on these tasks, released or not, in one query for the
 *  whole page. Ordered so the people still holding it read first. */
export async function assigneesForMany(taskIds: string[]): Promise<Map<string, TaskPerson[]>> {
  const byTask = new Map<string, TaskPerson[]>();
  if (taskIds.length === 0) return byTask;
  const rows = await db
    .select({
      taskId: taskAssignees.taskId,
      userId: taskAssignees.userId,
      name: users.name,
      releasedAt: taskAssignees.releasedAt,
    })
    .from(taskAssignees)
    .innerJoin(users, eq(users.id, taskAssignees.userId))
    .where(inArray(taskAssignees.taskId, taskIds))
    .orderBy(sql`${taskAssignees.releasedAt} asc nulls first`, asc(taskAssignees.createdAt));
  for (const row of rows) {
    const list = byTask.get(row.taskId) ?? [];
    list.push({
      taskId: row.taskId,
      userId: row.userId,
      name: row.name,
      released: row.releasedAt !== null,
    });
    byTask.set(row.taskId, list);
  }
  return byTask;
}

export async function assigneesFor(taskId: string): Promise<TaskPerson[]> {
  return (await assigneesForMany([taskId])).get(taskId) ?? [];
}

/** Put exactly these people on the task and nobody else.
 *
 *  Somebody already released is *not* revived by being listed again — they worked
 *  on it, handed it over, and their claim on the points is a past fact. Re-adding
 *  them is a handover back, which goes through `handOver`. */
export async function setAssignees(taskId: string, userIds: string[]): Promise<void> {
  await db
    .delete(taskAssignees)
    .where(
      and(
        eq(taskAssignees.taskId, taskId),
        isNull(taskAssignees.releasedAt),
        userIds.length > 0 ? notInArray(taskAssignees.userId, userIds) : undefined,
      ),
    );
  if (userIds.length === 0) return;
  await db
    .insert(taskAssignees)
    .values(userIds.map((userId) => ({ taskId, userId })))
    .onConflictDoNothing();
}

/** Hand the task from one person to another, keeping the first on the record. */
export async function handOver(
  taskId: string,
  fromUserId: string,
  toUserId: string,
  byUserId: string,
  reason: string | null,
): Promise<void> {
  await db
    .update(taskAssignees)
    .set({ releasedAt: new Date() })
    .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, fromUserId)));
  await db
    .insert(taskAssignees)
    .values({ taskId, userId: toUserId })
    .onConflictDoUpdate({
      target: [taskAssignees.taskId, taskAssignees.userId],
      // Somebody handed a task back picks it up again rather than staying released.
      set: { releasedAt: null },
    });
  await db.insert(taskHandovers).values({ taskId, fromUserId, toUserId, byUserId, reason });
}

export interface TaskHandoverRow {
  id: string;
  fromUserId: string | null;
  fromUserName: string | null;
  toUserId: string | null;
  toUserName: string | null;
  byUserId: string | null;
  byUserName: string | null;
  reason: string | null;
  handedAt: Date;
}

const handedFrom = alias(users, "handed_from");
const handedTo = alias(users, "handed_to");
const handedBy = alias(users, "handed_by");

/** Every time a task changed hands, oldest first. */
export async function handoversFor(taskId: string): Promise<TaskHandoverRow[]> {
  return db
    .select({
      id: taskHandovers.id,
      fromUserId: taskHandovers.fromUserId,
      fromUserName: handedFrom.name,
      toUserId: taskHandovers.toUserId,
      toUserName: handedTo.name,
      byUserId: taskHandovers.byUserId,
      byUserName: handedBy.name,
      reason: taskHandovers.reason,
      handedAt: taskHandovers.handedAt,
    })
    .from(taskHandovers)
    .leftJoin(handedFrom, eq(handedFrom.id, taskHandovers.fromUserId))
    .leftJoin(handedTo, eq(handedTo.id, taskHandovers.toUserId))
    .leftJoin(handedBy, eq(handedBy.id, taskHandovers.byUserId))
    .where(eq(taskHandovers.taskId, taskId))
    .orderBy(asc(taskHandovers.handedAt));
}
