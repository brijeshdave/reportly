// Author: Brijesh Dave <https://github.com/brijeshdave>
// The work timeline of one journal entry: who did what, and when.
//
// The entry's own `work_summary`/`work_detail` are kept as a roll-up so the reports,
// exports and saved report-views carry on reading one field. That roll-up is written
// **here**, by the code that owns the timeline, and never typed into by hand — two
// places writing the same column is how it drifts.
import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { journalEntries, journalWorkLogs, users } from "@/core/db/schema.js";

export interface WorkLogRow {
  id: string;
  reportId: string;
  userId: string;
  userName: string;
  summary: string;
  detail: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

const cols = {
  id: journalWorkLogs.id,
  reportId: journalWorkLogs.reportId,
  userId: journalWorkLogs.userId,
  userName: users.name,
  summary: journalWorkLogs.summary,
  detail: journalWorkLogs.detail,
  startedAt: journalWorkLogs.startedAt,
  finishedAt: journalWorkLogs.finishedAt,
  createdAt: journalWorkLogs.createdAt,
};

/**
 * Oldest first — a timeline is read in the order things happened.
 *
 * Ordered by when the work was done, falling back to when it was written: an item
 * logged without times still has a place, at the point somebody recorded it.
 */
export async function workLogsFor(reportId: string): Promise<WorkLogRow[]> {
  return db
    .select(cols)
    .from(journalWorkLogs)
    .innerJoin(users, eq(users.id, journalWorkLogs.userId))
    .where(eq(journalWorkLogs.reportId, reportId))
    .orderBy(asc(journalWorkLogs.startedAt), asc(journalWorkLogs.createdAt));
}

export async function getWorkLog(id: string): Promise<WorkLogRow | null> {
  const [row] = await db
    .select(cols)
    .from(journalWorkLogs)
    .innerJoin(users, eq(users.id, journalWorkLogs.userId))
    .where(eq(journalWorkLogs.id, id))
    .limit(1);
  return row ?? null;
}

export async function insertWorkLog(input: {
  reportId: string;
  userId: string;
  summary: string;
  detail: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}): Promise<string> {
  const [row] = await db.insert(journalWorkLogs).values(input).returning({
    id: journalWorkLogs.id,
  });
  return row!.id;
}

export async function updateWorkLogRow(
  id: string,
  fields: {
    summary?: string;
    detail?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  },
): Promise<void> {
  await db
    .update(journalWorkLogs)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(journalWorkLogs.id, id));
}

export async function deleteWorkLogRow(id: string): Promise<void> {
  await db.delete(journalWorkLogs).where(eq(journalWorkLogs.id, id));
}

/**
 * Keep the entry's roll-up in step with its timeline.
 *
 * The **newest** item, because that is what somebody scanning a list of entries wants
 * to know — what was done last, not what was done first. When the timeline empties,
 * the roll-up empties with it rather than keeping the words of a deleted item.
 */
export async function refreshWorkRollup(reportId: string): Promise<void> {
  const [newest] = await db
    .select({ summary: journalWorkLogs.summary, detail: journalWorkLogs.detail })
    .from(journalWorkLogs)
    .where(eq(journalWorkLogs.reportId, reportId))
    .orderBy(desc(journalWorkLogs.startedAt), desc(journalWorkLogs.createdAt))
    .limit(1);

  // Nothing to roll up from, so nothing is written. It used to null the columns
  // here, which quietly destroyed data: entries filed through the create form
  // before it wrote a timeline item carry their work in these columns and in no
  // other place, and the first time anybody logged real work against one the text
  // somebody had typed was gone. A refresh with an empty timeline cannot tell
  // "this entry has no work" from "this entry's work never became an item", so it
  // declines to answer. Emptying the timeline says so for itself — see
  // `clearWorkRollup`.
  if (!newest) return;

  await db
    .update(journalEntries)
    .set({ workSummary: newest.summary, workDetail: newest.detail, updatedAt: new Date() })
    .where(eq(journalEntries.id, reportId));
}

/**
 * Clear the roll-up outright, for the one caller that knows it should be empty:
 * whoever just removed the last item from the timeline.
 *
 * Kept apart from `refreshWorkRollup` on purpose. That function is called from
 * every write and has no way of knowing whether an empty timeline is the truth or
 * a gap; this one is called from the single place where it is the truth.
 */
export async function clearWorkRollup(reportId: string): Promise<void> {
  await db
    .update(journalEntries)
    .set({ workSummary: null, workDetail: null, updatedAt: new Date() })
    .where(eq(journalEntries.id, reportId));
}
