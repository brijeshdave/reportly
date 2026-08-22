// Author: Brijesh Dave <https://github.com/brijeshdave>
// The work timeline of one journal entry: who did what, and when.
//
// The entry's own `work_summary`/`work_detail` are kept as a roll-up so the reports,
// exports and saved report-views carry on reading one field. That roll-up is written
// **here**, by the code that owns the timeline, and never typed into by hand — two
// places writing the same column is how it drifts.
import { and, asc, desc, eq } from "drizzle-orm";

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

  await db
    .update(journalEntries)
    .set({
      workSummary: newest?.summary ?? null,
      workDetail: newest?.detail ?? null,
      updatedAt: new Date(),
    })
    .where(eq(journalEntries.id, reportId));
}

/** Whether this person already has an item on this entry — used by the tests and the UI. */
export async function hasWorkLog(reportId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: journalWorkLogs.id })
    .from(journalWorkLogs)
    .where(and(eq(journalWorkLogs.reportId, reportId), eq(journalWorkLogs.userId, userId)))
    .limit(1);
  return row !== undefined;
}
