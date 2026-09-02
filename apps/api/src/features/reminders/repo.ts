// Author: Brijesh Dave <https://github.com/brijeshdave>
// The reads and writes behind the daily reminder sweep.
//
// Two jobs: find the work that is about to come due or has slipped, and remember
// what has already been said about it.
import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, ne } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  notificationReminders,
  routineAssignees,
  routines,
  taskAssignees,
  tasks,
} from "@/core/db/schema.js";

export interface DueTask {
  id: string;
  companyId: string;
  assigneeId: string;
  title: string;
  dueAt: Date;
}

/**
 * Tasks falling due inside the window, still open.
 *
 * `state != done` rather than a list of open states: a workflow that grows another
 * in-progress state should keep reminding people about it, and would silently stop
 * if this named the states it wanted.
 */
export async function tasksDueBetween(from: Date, to: Date): Promise<DueTask[]> {
  // One row per person on the task, so a job split across two people reminds both
  // of them. A task nobody has picked up yet produces no rows: there is nobody to
  // remind, and the inner join says so rather than a filter somewhere downstream.
  const rows = await db
    .select({
      id: tasks.id,
      companyId: tasks.companyId,
      assigneeId: taskAssignees.userId,
      title: tasks.title,
      dueAt: tasks.dueAt,
    })
    .from(tasks)
    .innerJoin(
      taskAssignees,
      and(eq(taskAssignees.taskId, tasks.id), isNull(taskAssignees.releasedAt)),
    )
    .where(
      and(
        ne(tasks.state, "done"),
        isNotNull(tasks.dueAt),
        gt(tasks.dueAt, from),
        lte(tasks.dueAt, to),
      ),
    );

  // `dueAt` is nullable in the schema and filtered above; narrow it for callers
  // rather than making every one of them re-check.
  return rows.flatMap((row) => (row.dueAt ? [{ ...row, dueAt: row.dueAt }] : []));
}

/** Every company that has at least one active routine — the sweep's outer loop. */
export async function companiesWithRoutines(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ companyId: routines.companyId })
    .from(routines)
    .where(eq(routines.status, "active"));
  return rows.map((row) => row.companyId);
}

/** Who is assigned to any active routine in a company. */
export async function routineAssigneesIn(companyId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: routineAssignees.userId })
    .from(routineAssignees)
    .innerJoin(routines, eq(routines.id, routineAssignees.routineId))
    .where(and(eq(routines.companyId, companyId), eq(routines.status, "active")));
  return rows.map((row) => row.userId);
}

/* ------------------------------ the sent mark ------------------------------ */

export interface ReminderKey {
  userId: string;
  type: string;
  entityId: string;
  occurrenceKey: string;
}

/**
 * Which of these reminders have already gone out.
 *
 * Asked in one query for the whole sweep rather than one per candidate: a
 * thousand routines across a hundred people is a thousand round trips otherwise,
 * on a job that runs while nobody is watching and would simply get slower every
 * month until it overlapped itself.
 */
export async function alreadySent(keys: ReminderKey[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();

  const rows = await db
    .select({
      userId: notificationReminders.userId,
      type: notificationReminders.type,
      entityId: notificationReminders.entityId,
      occurrenceKey: notificationReminders.occurrenceKey,
    })
    .from(notificationReminders)
    .where(inArray(notificationReminders.userId, [...new Set(keys.map((k) => k.userId))]));

  return new Set(rows.map((r) => `${r.userId}|${r.type}|${r.entityId}|${r.occurrenceKey}`));
}

/**
 * Record that these went out.
 *
 * `onConflictDoNothing` because two sweeps overlapping — a slow run and the next
 * tick — must not fail the second one. The unique constraint is what actually
 * guarantees a reminder is sent once; this is just the write that trips it.
 */
export async function markSent(entries: (ReminderKey & { entityKind: string })[]): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(notificationReminders).values(entries).onConflictDoNothing();
}

/**
 * Forget marks older than the cutoff.
 *
 * Without this the table grows for ever, one row per person per occurrence. A
 * reminder nobody sent in the last year is not one this job is about to
 * re-suppress, so the mark has done its work.
 */
export async function pruneMarks(before: Date): Promise<number> {
  const result = await db
    .delete(notificationReminders)
    .where(lt(notificationReminders.sentAt, before));
  return result.rowCount ?? 0;
}
