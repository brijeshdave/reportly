// Author: Brijesh Dave <https://github.com/brijeshdave>
// The counts behind the department workload reports: what each person did in a
// window, and how many days they were on the rota to do it in.
//
// Every query here is "one row per person" (or per person per day), aggregated in
// Postgres rather than in the service. Counting in TypeScript would mean fetching
// every entry, task and placement for a month and adding them up in memory, which
// is a data dump wearing a report's clothes.
import { and, eq, gte, inArray, lt, lte, notInArray, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  journalEntries,
  partPlacements,
  pointAwards,
  routineAssignees,
  routineCompletions,
  routines,
  serviceEvents,
  scheduleEntries,
  taskAssignees,
  tasks,
} from "@/core/db/schema.js";
import { occurrenceDates, type RoutineRecurrence } from "@reportly/shared";

/** One person's tally for the window, or for one day of it. */
export interface WorkloadCounts {
  userId: string;
  /** Present only on the daily report; `YYYY-MM-DD` in the company's timezone. */
  day?: string;
  issues: number;
  plannedWork: number;
  tasks: number;
  /**
   * Parts work, told apart.
   *
   * These were one `cartridges` number — fits, removals and services added together
   * — so the report could not answer "how many did this person refill" separately
   * from "how many did they service", which is what it was being read for.
   */
  partsFitted: number;
  partsRemoved: number;
  partsServiced: number;
  routines: number;
  /**
   * Work that was due in the window and is **not** done.
   *
   * Asked for from use: "we should also have tasks and routines that were not
   * completed and due is done." A report of what somebody got through says nothing
   * about what they did not, and the two together are the actual picture — six jobs
   * finished reads very differently beside two missed and beside twenty.
   */
  tasksOverdue: number;
  routinesMissed: number;
  points: number;
}

/** An empty tally. Exported because the daily module builds the same shape. */
export const emptyCounts = (userId: string, day?: string): WorkloadCounts => ({
  userId,
  ...(day === undefined ? {} : { day }),
  issues: 0,
  plannedWork: 0,
  tasks: 0,
  partsFitted: 0,
  partsRemoved: 0,
  partsServiced: 0,
  routines: 0,
  tasksOverdue: 0,
  routinesMissed: 0,
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
  //
  // A work entry filed **against a task** is excluded from `plannedWork`, because
  // that is what the `tasks` column already counts. Completing a task opens a
  // pre-filled entry, so every completed task produced one of each and the two
  // columns added the same job twice — and `total`, which sums them, was inflated by
  // exactly the number of tasks somebody wrote up. Reported from use: "planned work
  // is the entry that are completed tasks so it should be shown for task only."
  //
  // What is left in `plannedWork` is a work entry standing on its own: routine daily
  // work somebody logged without a task behind it. That is a real thing and keeps its
  // column; it is simply no longer the same jobs counted again.
  const entries = await db
    .select({
      userId: journalEntries.authorId,
      kind: journalEntries.kind,
      fromTask: sql<boolean>`${journalEntries.taskId} is not null`,
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
    .groupBy(
      journalEntries.authorId,
      journalEntries.kind,
      sql`${journalEntries.taskId} is not null`,
    );
  for (const row of entries) {
    const bucket = at(row.userId);
    if (row.kind !== "work") bucket.issues += row.n;
    else if (!row.fromTask) bucket.plannedWork += row.n;
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

  // Tasks that came due in the window and are still not done. Cancelled ones are
  // excluded deliberately: calling work off is a decision somebody made, not a job
  // left undone, and counting it as a miss would punish the tidy thing to do.
  const overdue = await db
    .select({ userId: taskAssignees.userId, n: sql<number>`count(distinct ${tasks.id})::int` })
    .from(tasks)
    .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
    .where(
      and(
        inArray(taskAssignees.userId, userIds),
        eq(tasks.companyId, companyId),
        notInArray(tasks.state, ["done", "cancelled"]),
        gte(tasks.dueAt, from),
        lt(tasks.dueAt, to),
      ),
    )
    .groupBy(taskAssignees.userId);
  for (const row of overdue) at(row.userId).tasksOverdue += row.n;

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
  for (const row of installs) if (row.userId) at(row.userId).partsFitted += row.n;

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
  for (const row of returns) if (row.userId) at(row.userId).partsRemoved += row.n;

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
  for (const row of services) if (row.userId) at(row.userId).partsServiced += row.n;

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
  await countMissedRoutines(at, userIds, companyId, fromDay, toDay);

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

/**
 * Routine occurrences that came due in the window and were never completed.
 *
 * A miss has **no row** — `routine_completions` records what was done, so the
 * absence is the fact. The expected occurrences are generated from each routine's
 * own recurrence (the same `occurrenceDates` the routines screen uses, so the two
 * can never disagree about which days a duty fell on) and the completions are
 * subtracted.
 *
 * Only days that have **passed** count. An occurrence due today or later is pending,
 * not missed, and calling it a miss would mark somebody down for work the day has
 * not finished asking for yet.
 */
async function countMissedRoutines(
  at: (userId: string) => WorkloadCounts,
  userIds: string[],
  companyId: string,
  fromDay: string,
  toDay: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  // Nothing in the window has passed yet, so nothing in it can have been missed.
  if (fromDay > today) return;
  const lastDay = toDay < today ? toDay : today;

  const assigned = await db
    .select({
      routineId: routines.id,
      userId: routineAssignees.userId,
      cadence: routines.cadence,
      anchorWeekday: routines.anchorWeekday,
      anchorDay: routines.anchorDay,
      anchorMonthOfQuarter: routines.anchorMonthOfQuarter,
      startDate: routines.startDate,
    })
    .from(routines)
    .innerJoin(routineAssignees, eq(routineAssignees.routineId, routines.id))
    .where(
      and(
        inArray(routineAssignees.userId, userIds),
        eq(routines.companyId, companyId),
        // A paused routine stops being due. Counting its days as misses would
        // punish people for work somebody deliberately switched off.
        eq(routines.status, "active"),
      ),
    );
  if (assigned.length === 0) return;

  const completed = await db
    .select({
      routineId: routineCompletions.routineId,
      userId: routineCompletions.userId,
      day: routineCompletions.occurrenceDate,
    })
    .from(routineCompletions)
    .where(
      and(
        inArray(routineCompletions.userId, userIds),
        eq(routineCompletions.status, "completed"),
        gte(routineCompletions.occurrenceDate, fromDay),
        lte(routineCompletions.occurrenceDate, lastDay),
      ),
    );
  const done = new Set(completed.map((c) => `${c.routineId}|${c.userId}|${c.day}`));

  for (const row of assigned) {
    const dates = occurrenceDates(
      {
        cadence: row.cadence as RoutineRecurrence["cadence"],
        anchorWeekday: row.anchorWeekday,
        anchorDay: row.anchorDay,
        anchorMonthOfQuarter: row.anchorMonthOfQuarter,
        startDate: row.startDate,
      },
      fromDay,
      lastDay,
    );
    for (const date of dates) {
      // `occurrenceDates` is inclusive of its end; today is still pending.
      if (date >= today) continue;
      if (done.has(`${row.routineId}|${row.userId}|${date}`)) continue;
      at(row.userId).routinesMissed += 1;
    }
  }
}
