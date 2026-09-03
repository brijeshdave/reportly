// Author: Brijesh Dave <https://github.com/brijeshdave>
// The day-by-day half of the workload reports: one row per person per day.
//
// Its own module because the queries differ from the period totals in one way that
// touches every one of them — each has to bucket by the local day, and a day
// boundary read in UTC puts an evening's work on tomorrow for anybody east of
// Greenwich. Keeping the two side by side in one file made it easy to copy a query
// across and forget the offset.
import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  journalEntries,
  partPlacements,
  pointAwards,
  routineCompletions,
  scheduleEntries,
  serviceEvents,
  taskAssignees,
  tasks,
} from "@/core/db/schema.js";
import { type WorkloadCounts, emptyCounts } from "@/features/reports/workload-repo.js";

/**
 * What each person did, split by day.
 *
 * Days with nothing on them are absent here; the service fills the calendar, so a
 * quiet Tuesday reads as a row of zeros rather than vanishing from the report.
 */
export async function dailyCountsFor(
  userIds: string[],
  companyId: string,
  from: Date,
  to: Date,
  fromDay: string,
  toDay: string,
  tzOffsetMinutes: number,
): Promise<WorkloadCounts[]> {
  if (userIds.length === 0) return [];
  const byKey = new Map<string, WorkloadCounts>();
  const at = (userId: string, day: string) => {
    const key = `${userId} ${day}`;
    const existing = byKey.get(key);
    if (existing) return existing;
    const fresh = emptyCounts(userId, day);
    byKey.set(key, fresh);
    return fresh;
  };

  /**
   * A timestamp column as the local day it falls on.
   *
   * The offset is written into the SQL rather than bound as a parameter, because
   * the same expression has to appear in both the SELECT and the GROUP BY — and a
   * bound value renders as `$1` in one and `$5` in the other, which Postgres reads
   * as two different expressions and rejects with "must appear in the GROUP BY
   * clause". Clamped to a real timezone offset first, so nothing arbitrary reaches
   * the statement.
   */
  const offset = Math.max(-840, Math.min(840, Math.trunc(tzOffsetMinutes) || 0));
  const localDay = (column: unknown) =>
    sql<string>`to_char((${column} + ${sql.raw(`interval '${offset} minutes'`)})::date, 'YYYY-MM-DD')`;

  const entries = await db
    .select({
      userId: journalEntries.authorId,
      day: localDay(journalEntries.reportDate),
      kind: journalEntries.kind,
      n: sql<number>`count(*)::int`,
    })
    .from(journalEntries)
    .where(
      and(
        inArray(journalEntries.authorId, userIds),
        eq(journalEntries.companyId, companyId),
        gte(journalEntries.reportDate, from),
        lt(journalEntries.reportDate, to),
      ),
    )
    .groupBy(journalEntries.authorId, localDay(journalEntries.reportDate), journalEntries.kind);
  for (const row of entries) {
    const bucket = at(row.userId, row.day);
    if (row.kind === "work") bucket.plannedWork += row.n;
    else bucket.issues += row.n;
  }

  const taskRows = await db
    .select({
      userId: taskAssignees.userId,
      day: localDay(tasks.completedAt),
      n: sql<number>`count(distinct ${tasks.id})::int`,
    })
    .from(tasks)
    .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
    .where(
      and(
        inArray(taskAssignees.userId, userIds),
        eq(tasks.companyId, companyId),
        eq(tasks.state, "done"),
        gte(tasks.completedAt, from),
        lt(tasks.completedAt, to),
      ),
    )
    .groupBy(taskAssignees.userId, localDay(tasks.completedAt));
  for (const row of taskRows) at(row.userId, row.day).tasks += row.n;

  const installs = await db
    .select({
      userId: partPlacements.installedBy,
      day: localDay(partPlacements.installedAt),
      n: sql<number>`count(*)::int`,
    })
    .from(partPlacements)
    .where(
      and(
        inArray(partPlacements.installedBy, userIds),
        eq(partPlacements.companyId, companyId),
        gte(partPlacements.installedAt, from),
        lt(partPlacements.installedAt, to),
      ),
    )
    .groupBy(partPlacements.installedBy, localDay(partPlacements.installedAt));
  for (const row of installs) if (row.userId) at(row.userId, row.day).cartridges += row.n;

  const returns = await db
    .select({
      userId: partPlacements.removedBy,
      day: localDay(partPlacements.removedAt),
      n: sql<number>`count(*)::int`,
    })
    .from(partPlacements)
    .where(
      and(
        inArray(partPlacements.removedBy, userIds),
        eq(partPlacements.companyId, companyId),
        gte(partPlacements.removedAt, from),
        lt(partPlacements.removedAt, to),
      ),
    )
    .groupBy(partPlacements.removedBy, localDay(partPlacements.removedAt));
  for (const row of returns) if (row.userId) at(row.userId, row.day).cartridges += row.n;

  const services = await db
    .select({
      userId: serviceEvents.performedBy,
      day: localDay(serviceEvents.performedAt),
      n: sql<number>`count(*)::int`,
    })
    .from(serviceEvents)
    .where(
      and(
        inArray(serviceEvents.performedBy, userIds),
        eq(serviceEvents.companyId, companyId),
        gte(serviceEvents.performedAt, from),
        lt(serviceEvents.performedAt, to),
      ),
    )
    .groupBy(serviceEvents.performedBy, localDay(serviceEvents.performedAt));
  for (const row of services) if (row.userId) at(row.userId, row.day).cartridges += row.n;

  // `occurrence_date` and `earned_on` are already days, so they take no offset:
  // shifting a date that was never a moment would move it by a day for no reason.
  const routines = await db
    .select({
      userId: routineCompletions.userId,
      day: sql<string>`to_char(${routineCompletions.occurrenceDate}, 'YYYY-MM-DD')`,
      n: sql<number>`count(*)::int`,
    })
    .from(routineCompletions)
    .where(
      and(
        inArray(routineCompletions.userId, userIds),
        eq(routineCompletions.status, "completed"),
        gte(routineCompletions.occurrenceDate, fromDay),
        lte(routineCompletions.occurrenceDate, toDay),
      ),
    )
    .groupBy(routineCompletions.userId, routineCompletions.occurrenceDate);
  for (const row of routines) at(row.userId, row.day).routines += row.n;

  const points = await db
    .select({
      userId: pointAwards.beneficiaryUserId,
      day: sql<string>`to_char(${pointAwards.earnedOn}, 'YYYY-MM-DD')`,
      total: sql<string>`coalesce(sum(${pointAwards.points}), 0)`,
    })
    .from(pointAwards)
    .where(
      and(
        inArray(pointAwards.beneficiaryUserId, userIds),
        eq(pointAwards.companyId, companyId),
        eq(pointAwards.kind, "direct"),
        gte(pointAwards.earnedOn, fromDay),
        lte(pointAwards.earnedOn, toDay),
      ),
    )
    .groupBy(pointAwards.beneficiaryUserId, pointAwards.earnedOn);
  for (const row of points) at(row.userId, row.day).points += Number(row.total);

  return [...byKey.values()];
}

/**
 * Which days each person was rostered working, as `"<userId> <YYYY-MM-DD>"` keys.
 *
 * The daily report needs this to tell two blank rows apart: a day somebody was off
 * and a day they were in and did nothing are the same empty row otherwise, and only
 * one of them is worth asking about.
 */
export async function workingDayFlags(
  userIds: string[],
  fromDay: string,
  toDay: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({
      userId: scheduleEntries.userId,
      day: sql<string>`to_char(${scheduleEntries.date}, 'YYYY-MM-DD')`,
    })
    .from(scheduleEntries)
    .where(
      and(
        inArray(scheduleEntries.userId, userIds),
        eq(scheduleEntries.state, "working"),
        gte(scheduleEntries.date, fromDay),
        lte(scheduleEntries.date, toDay),
      ),
    );
  for (const row of rows) out.add(`${row.userId} ${row.day}`);
  return out;
}
