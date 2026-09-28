// Author: Brijesh Dave <https://github.com/brijeshdave>
// When each person last did anything of each kind — the query behind the silence
// report.
//
// Asked for from use: "also need a report that can show if any user is not logging
// anything since last N number of days based on filters applied. i.e. like no
// journal, no tasks, no refill or service or no routines. need for each of these."
//
// Deliberately *not* the irregularity report. That one asks "did less than N in a
// window", which is a question about volume; this asks "has done nothing at all
// since when", which is a question about silence. Somebody who filed forty entries
// on the 1st and nothing since is invisible to the first and the whole point of the
// second.
//
// One MAX per source rather than a row per event: the answer is a single date per
// person per kind, and fetching a year of history to take its maximum in TypeScript
// would be a data dump wearing a report's clothes.
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  journalEntries,
  partPlacements,
  routineCompletions,
  serviceEvents,
  taskAssignees,
  tasks,
} from "@/core/db/schema.js";

/** The kinds of activity the report watches, and the order its columns read in. */
export const SILENCE_KINDS = ["journal", "tasks", "routines", "parts"] as const;
export type SilenceKind = (typeof SILENCE_KINDS)[number];

/** The last time each person did each kind of thing. Missing = never. */
export type LastActivity = Map<string, Partial<Record<SilenceKind, Date>>>;

/**
 * Record a person's latest activity of one kind.
 *
 * `at` is typed loosely on purpose: `max()` over a `date` column comes back as a
 * string and over a `timestamptz` as a Date, depending on the column and the
 * driver. Asserting `Date` in the query and trusting it is what produced a 500 —
 * the value arrived as "2026-09-28" and `getTime` is not a function on a string.
 */
function put(out: LastActivity, userId: string, kind: SilenceKind, at: Date | string | null): void {
  if (!at) return;
  const when = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(when.getTime())) return;
  const row = out.get(userId) ?? {};
  const current = row[kind];
  if (!current || when > current) row[kind] = when;
  out.set(userId, row);
}

export async function lastActivityFor(userIds: string[], companyId: string): Promise<LastActivity> {
  const out: LastActivity = new Map();
  if (userIds.length === 0) return out;

  // A submitted entry they filed. Drafts are private and unfinished — somebody
  // whose only activity is an unsubmitted draft has not told anybody anything.
  const entries = await db
    .select({
      userId: journalEntries.authorId,
      at: sql<Date | string>`max(${journalEntries.reportDate})`,
    })
    .from(journalEntries)
    .where(
      and(
        inArray(journalEntries.authorId, userIds),
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.state, "submitted"),
      ),
    )
    .groupBy(journalEntries.authorId);
  for (const row of entries) put(out, row.userId, "journal", row.at);

  // A task they were on that was completed. Counted for everybody named on it, the
  // same rule the workload report follows: a job handed over mid-shift was worked
  // by both of them.
  const done = await db
    .select({ userId: taskAssignees.userId, at: sql<Date | string>`max(${tasks.completedAt})` })
    .from(taskAssignees)
    .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
    .where(
      and(
        inArray(taskAssignees.userId, userIds),
        eq(tasks.companyId, companyId),
        isNotNull(tasks.completedAt),
      ),
    )
    .groupBy(taskAssignees.userId);
  for (const row of done) put(out, row.userId, "tasks", row.at);

  // Counted on the day the occurrence was *for*, not when it was ticked off — the
  // same rule the workload report uses, so the two never disagree about a late log.
  const routines = await db
    .select({
      userId: routineCompletions.userId,
      at: sql<Date | string>`max(${routineCompletions.occurrenceDate})`,
    })
    .from(routineCompletions)
    .where(
      and(inArray(routineCompletions.userId, userIds), eq(routineCompletions.status, "completed")),
    )
    .groupBy(routineCompletions.userId);
  for (const row of routines) put(out, row.userId, "routines", row.at);

  // Parts work is one kind here rather than three. The question is whether this
  // person has touched a cartridge at all; which end of the job it was belongs to
  // the workload report, which now says.
  const fitted = await db
    .select({
      userId: partPlacements.installedBy,
      at: sql<Date | string>`max(${partPlacements.installedAt})`,
    })
    .from(partPlacements)
    .where(
      and(inArray(partPlacements.installedBy, userIds), eq(partPlacements.companyId, companyId)),
    )
    .groupBy(partPlacements.installedBy);
  for (const row of fitted) if (row.userId) put(out, row.userId, "parts", row.at);

  const removed = await db
    .select({
      userId: partPlacements.removedBy,
      at: sql<Date | string>`max(${partPlacements.removedAt})`,
    })
    .from(partPlacements)
    .where(and(inArray(partPlacements.removedBy, userIds), eq(partPlacements.companyId, companyId)))
    .groupBy(partPlacements.removedBy);
  for (const row of removed) if (row.userId) put(out, row.userId, "parts", row.at);

  const serviced = await db
    .select({
      userId: serviceEvents.performedBy,
      at: sql<Date | string>`max(${serviceEvents.performedAt})`,
    })
    .from(serviceEvents)
    .where(and(inArray(serviceEvents.performedBy, userIds), eq(serviceEvents.companyId, companyId)))
    .groupBy(serviceEvents.performedBy);
  for (const row of serviced) if (row.userId) put(out, row.userId, "parts", row.at);

  return out;
}
