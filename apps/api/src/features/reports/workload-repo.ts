// Author: Brijesh Dave <https://github.com/brijeshdave>
// The counts behind the department workload reports: what each person did in a
// window, and how many days they were on the rota to do it in.
//
// Every query here is "one row per person" (or per person per day), aggregated in
// Postgres rather than in the service. Counting in TypeScript would mean fetching
// every entry, task and placement for a month and adding them up in memory, which
// is a data dump wearing a report's clothes.
import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  journalEntries,
  partPlacements,
  pointAwards,
  routineCompletions,
  serviceEvents,
  scheduleEntries,
  taskAssignees,
  tasks,
} from "@/core/db/schema.js";

/** One person's tally for the window, or for one day of it. */
export interface WorkloadCounts {
  userId: string;
  /** Present only on the daily report; `YYYY-MM-DD` in the company's timezone. */
  day?: string;
  issues: number;
  plannedWork: number;
  tasks: number;
  cartridges: number;
  routines: number;
  points: number;
}

/** An empty tally. Exported because the daily module builds the same shape. */
export const emptyCounts = (userId: string, day?: string): WorkloadCounts => ({
  userId,
  ...(day === undefined ? {} : { day }),
  issues: 0,
  plannedWork: 0,
  tasks: 0,
  cartridges: 0,
  routines: 0,
  points: 0,
});

/**
 * Days each person was rostered **working** in the window.
 *
 * `state = 'working'` is the whole point: a day off, a leave day and a public
 * holiday are all on the rota and none of them is a working day — "so that W/O or
 * Leave do not counts". Days with no rota row at all are not working days either,
 * which is why this counts rows rather than dates.
 *
 * `schedule_entries.date` is a `date` column, so the window is compared as dates
 * and no timezone arithmetic is needed or wanted here.
 */
export async function workingDaysFor(
  userIds: string[],
  fromDay: string,
  toDay: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({
      userId: scheduleEntries.userId,
      days: sql<number>`count(distinct ${scheduleEntries.date})::int`,
    })
    .from(scheduleEntries)
    .where(
      and(
        inArray(scheduleEntries.userId, userIds),
        eq(scheduleEntries.state, "working"),
        gte(scheduleEntries.date, fromDay),
        lte(scheduleEntries.date, toDay),
      ),
    )
    .groupBy(scheduleEntries.userId);
  for (const row of rows) out.set(row.userId, row.days);
  return out;
}

/**
 * What each person did in the window, one row per person.
 *
 * Six separate aggregates rather than one joined query on purpose: joining six
 * one-to-many tables multiplies the rows by each other, and the totals come out
 * wrong in a way that looks plausible — the classic fan-out. Each is counted
 * alone and merged by user id.
 */
export async function countsFor(
  userIds: string[],
  companyId: string,
  from: Date,
  to: Date,
  // The same window as dates, for the tables that store a day rather than a moment
  // (the points ledger's `earned_on`, a routine's `occurrence_date`). Passed in
  // rather than derived here, so every report in the set cuts the days identically.
  fromDay: string,
  toDay: string,
): Promise<Map<string, WorkloadCounts>> {
  const out = new Map<string, WorkloadCounts>();
  if (userIds.length === 0) return out;
  const at = (userId: string) => {
    const existing = out.get(userId);
    if (existing) return existing;
    const fresh = emptyCounts(userId);
    out.set(userId, fresh);
    return fresh;
  };

  // Journal entries, split by kind. Authored, not participated: participation is
  // how the points are divided, not who filed the entry.
  const entries = await db
    .select({
      userId: journalEntries.authorId,
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
    .groupBy(journalEntries.authorId, journalEntries.kind);
  for (const row of entries) {
    const bucket = at(row.userId);
    if (row.kind === "work") bucket.plannedWork += row.n;
    else bucket.issues += row.n;
  }

  // Tasks completed in the window, counted for everybody who was on them —
  // including anybody released by a handover, which is the same rule the points
  // follow. A task two people worked counts once for each of them.
  const taskRows = await db
    .select({ userId: taskAssignees.userId, n: sql<number>`count(distinct ${tasks.id})::int` })
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
    .groupBy(taskAssignees.userId);
  for (const row of taskRows) at(row.userId).tasks += row.n;

  // Cartridge work: installs, returns and services are each a job somebody did.
  const installs = await db
    .select({ userId: partPlacements.installedBy, n: sql<number>`count(*)::int` })
    .from(partPlacements)
    .where(
      and(
        inArray(partPlacements.installedBy, userIds),
        eq(partPlacements.companyId, companyId),
        gte(partPlacements.installedAt, from),
        lt(partPlacements.installedAt, to),
      ),
    )
    .groupBy(partPlacements.installedBy);
  for (const row of installs) if (row.userId) at(row.userId).cartridges += row.n;

  const returns = await db
    .select({ userId: partPlacements.removedBy, n: sql<number>`count(*)::int` })
    .from(partPlacements)
    .where(
      and(
        inArray(partPlacements.removedBy, userIds),
        eq(partPlacements.companyId, companyId),
        gte(partPlacements.removedAt, from),
        lt(partPlacements.removedAt, to),
      ),
    )
    .groupBy(partPlacements.removedBy);
  for (const row of returns) if (row.userId) at(row.userId).cartridges += row.n;

  const services = await db
    .select({ userId: serviceEvents.performedBy, n: sql<number>`count(*)::int` })
    .from(serviceEvents)
    .where(
      and(
        inArray(serviceEvents.performedBy, userIds),
        eq(serviceEvents.companyId, companyId),
        gte(serviceEvents.performedAt, from),
        lt(serviceEvents.performedAt, to),
      ),
    )
    .groupBy(serviceEvents.performedBy);
  for (const row of services) if (row.userId) at(row.userId).cartridges += row.n;

  // Counted on the day the occurrence was *for*, not the moment somebody ticked it
  // off: a routine logged late still belongs to the day it was due, which is the
  // day the rest of the report is counting.
  const routines = await db
    .select({ userId: routineCompletions.userId, n: sql<number>`count(*)::int` })
    .from(routineCompletions)
    .where(
      and(
        inArray(routineCompletions.userId, userIds),
        eq(routineCompletions.status, "completed"),
        gte(routineCompletions.occurrenceDate, fromDay),
        lte(routineCompletions.occurrenceDate, toDay),
      ),
    )
    .groupBy(routineCompletions.userId);
  for (const row of routines) at(row.userId).routines += row.n;

  // Points come from the ledger, which only a review writes to — the same number
  // the leaderboard reads, so two screens cannot disagree about what somebody
  // earned.
  const points = await db
    .select({
      userId: pointAwards.beneficiaryUserId,
      total: sql<string>`coalesce(sum(${pointAwards.points}), 0)`,
    })
    .from(pointAwards)
    .where(
      and(
        inArray(pointAwards.beneficiaryUserId, userIds),
        eq(pointAwards.companyId, companyId),
        // Their own work only. A `rollup` row is a manager's share of what their
        // team earned, and counting it here would put their team's points in the
        // column beside their own activity counts and read as theirs.
        eq(pointAwards.kind, "direct"),
        gte(pointAwards.earnedOn, fromDay),
        lte(pointAwards.earnedOn, toDay),
      ),
    )
    .groupBy(pointAwards.beneficiaryUserId);
  for (const row of points) at(row.userId).points += Number(row.total);

  return out;
}
