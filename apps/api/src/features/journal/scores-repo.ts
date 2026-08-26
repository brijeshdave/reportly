// Author: Brijesh Dave <https://github.com/brijeshdave>
// A report's scores and its frozen points ledger. The only code touching
// journal_scores and point_awards.
import { and, eq, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/core/db/index.js";
import { pointAwards, journalScores, users } from "@/core/db/schema.js";

export type ScoreTier = "self" | "review";

export interface ScoreRow {
  reportId: string;
  subjectUserId: string;
  subjectName: string;
  tier: ScoreTier;
  raterId: string;
  points: number;
  updatedAt: Date;
}

const subject = alias(users, "subject");

/** Every score row on a report, both tiers, oldest worker first. */
export async function scoresFor(reportId: string): Promise<ScoreRow[]> {
  const rows = await db
    .select({
      reportId: journalScores.reportId,
      subjectUserId: journalScores.subjectUserId,
      subjectName: subject.name,
      tier: journalScores.tier,
      raterId: journalScores.raterId,
      points: journalScores.points,
      updatedAt: journalScores.updatedAt,
    })
    .from(journalScores)
    .innerJoin(subject, eq(subject.id, journalScores.subjectUserId))
    .where(eq(journalScores.reportId, reportId));
  return rows.map((r) => ({ ...r, tier: r.tier as ScoreTier }));
}

/**
 * Replace one tier of a report's scores wholesale — the caller's whole column at
 * once. Only the named tier is touched; the other tier's rows are left alone.
 */
export async function replaceTier(
  reportId: string,
  tier: ScoreTier,
  raterId: string,
  scores: { userId: string; points: number }[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(journalScores)
      .where(and(eq(journalScores.reportId, reportId), eq(journalScores.tier, tier)));
    if (scores.length === 0) return;
    // Last entry wins on a duplicated user, matching how the participant list
    // dedupes, rather than the insert failing on the primary key.
    const byUser = new Map(scores.map((s) => [s.userId, s.points]));
    await tx.insert(journalScores).values(
      [...byUser].map(([userId, points]) => ({
        reportId,
        subjectUserId: userId,
        tier,
        raterId,
        points,
      })),
    );
  });
}

/** Wipe a report's scores — every tier. Used when a report is re-opened. */
export async function clearScores(reportId: string): Promise<void> {
  await db.delete(journalScores).where(eq(journalScores.reportId, reportId));
}

/** Drop score rows for anyone not in `keep` — used when the membership shrinks, so
 *  a dropped worker's score does not linger with nobody attached. */
export async function pruneScores(reportId: string, keep: string[]): Promise<void> {
  if (keep.length === 0) {
    await db.delete(journalScores).where(eq(journalScores.reportId, reportId));
    return;
  }
  await db
    .delete(journalScores)
    .where(
      and(eq(journalScores.reportId, reportId), notInArray(journalScores.subjectUserId, keep)),
    );
}

export interface AwardInput {
  beneficiaryUserId: string;
  reportId: string;
  kind: "direct" | "rollup";
  depth: number;
  points: number;
}

/** The journal-entry facts every award of a report shares — carried onto the ledger row. */
export interface AwardMeta {
  companyId: string;
  earnedOn: string; // YYYY-MM-DD, the entry's report date
  departmentId: string | null;
}

/**
 * Rewrite a report's ledger rows in one transaction — the freeze. Called only for
 * the report being (re)scored, so a change elsewhere never touches it. Stamps each
 * award with the entry's company/date/department and `source='journal'`, so the
 * leaderboard can read the ledger without re-joining the journal.
 */
export async function replaceAwards(
  reportId: string,
  meta: AwardMeta,
  awards: AwardInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(pointAwards).where(eq(pointAwards.reportId, reportId));
    if (awards.length > 0) {
      await tx.insert(pointAwards).values(
        awards.map((a) => ({
          ...a,
          source: "journal",
          companyId: meta.companyId,
          earnedOn: meta.earnedOn,
          departmentId: meta.departmentId,
        })),
      );
    }
  });
}

/** Drop a report's ledger rows without recomputing — for a re-open. */
export async function clearAwards(reportId: string): Promise<void> {
  await db.delete(pointAwards).where(eq(pointAwards.reportId, reportId));
}

/** A person's points: their own official scores vs. what rolled up from downline. */
export async function pointsFor(userId: string): Promise<{ own: number; rollup: number }> {
  const [own] = await db
    .select({ total: sql<number>`coalesce(sum(${pointAwards.points}), 0)::real` })
    .from(pointAwards)
    .where(and(eq(pointAwards.beneficiaryUserId, userId), eq(pointAwards.kind, "direct")));

  const [rollup] = await db
    .select({ total: sql<number>`coalesce(sum(${pointAwards.points}), 0)::real` })
    .from(pointAwards)
    .where(and(eq(pointAwards.beneficiaryUserId, userId), eq(pointAwards.kind, "rollup")));

  return { own: own?.total ?? 0, rollup: rollup?.total ?? 0 };
}

/** One of the caller's own entries, still waiting on somebody above them. */
export interface AwaitingRow {
  reportId: string;
  title: string;
  kind: string;
  severityName: string | null;
  submittedAt: string | null;
  /** Who it is waiting on; null when the author has no manager in the line. */
  reviewerName: string | null;
}

export interface PendingRow {
  reportId: string;
  title: string;
  kind: string;
  authorId: string;
  authorName: string;
  severityName: string | null;
  submittedAt: Date | null;
  depth: number;
}

/**
 * The reports awaiting the caller's review: resolved, authored by someone in their
 * downline, and not yet reviewed by them. One recursive walk, with the depth of
 * each author below the caller.
 */
/**
 * The caller's OWN entries still waiting on somebody above them.
 *
 * The mirror of `pendingFor`: that answers "what is on my desk", this answers
 * "what of mine is on somebody else's". Filed, finished, and nobody has scored
 * it yet — which until now was invisible to the person who filed it, so the only
 * way to find out was to ask.
 *
 * Waiting on the author's own manager by the reporting line, named so the answer
 * is a person rather than "somebody". Null when they have no manager set, which
 * is a real state and reads as "nobody is set to review this".
 */
export async function awaitingReviewFor(callerId: string): Promise<AwaitingRow[]> {
  // `submitted_at` typed as a string, not a Date: `db.execute` hands back what
  // the driver gives and a raw query is not mapped, so declaring it `Date` would
  // be an assertion that breaks on the first `.toISOString()`. The same trap the
  // cartridge failures report fell into.
  const result = await db.execute<{
    report_id: string;
    title: string;
    kind: string;
    severity_name: string | null;
    submitted_at: string | null;
    reviewer_name: string | null;
  }>(sql`
    SELECT r.id AS report_id, r.title, r.kind, sev.name AS severity_name, r.submitted_at,
           mgr.name AS reviewer_name
    FROM journal_entries r
    -- Resolved, not merely finished: a cancelled or duplicate entry is not work
    -- anybody should be scoring, and it used to fill this queue.
    JOIN journal_statuses st ON st.id = r.status_id AND st."group" = 'resolved'
    LEFT JOIN severities sev ON sev.id = r.severity_id
    LEFT JOIN LATERAL (
      SELECT u.name
      FROM department_users du
      JOIN users u ON u.id = du.reports_to_id
      WHERE du.user_id = ${callerId} AND du.reports_to_id IS NOT NULL
      LIMIT 1
    ) mgr ON true
    WHERE r.author_id = ${callerId}
      AND r.state = 'submitted'
      AND NOT EXISTS (
        SELECT 1 FROM journal_scores s WHERE s.report_id = r.id AND s.tier = 'review'
      )
    ORDER BY r.submitted_at DESC NULLS LAST
  `);

  return result.rows.map((row) => ({
    reportId: row.report_id,
    title: row.title,
    kind: row.kind,
    severityName: row.severity_name,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    reviewerName: row.reviewer_name,
  }));
}

export async function pendingFor(callerId: string): Promise<PendingRow[]> {
  const result = await db.execute<{
    report_id: string;
    title: string;
    kind: string;
    author_id: string;
    author_name: string;
    severity_name: string | null;
    submitted_at: Date | null;
    depth: number;
  }>(sql`
    WITH RECURSIVE downline AS (
      SELECT du.user_id, 1 AS depth
      FROM department_users du
      WHERE du.reports_to_id = ${callerId}

      UNION ALL

      SELECT du.user_id, d.depth + 1
      FROM department_users du
      JOIN downline d ON du.reports_to_id = d.user_id
    ) CYCLE user_id SET is_cycle USING path,
    below AS (
      SELECT user_id, MIN(depth) AS depth FROM downline WHERE NOT is_cycle GROUP BY user_id
    )
    SELECT r.id AS report_id, r.title, r.kind, r.author_id,
           u.name AS author_name, sev.name AS severity_name, r.submitted_at, b.depth
    FROM journal_entries r
    JOIN below b ON b.user_id = r.author_id
    JOIN users u ON u.id = r.author_id
    -- Resolved, not merely finished: cancelled and duplicate entries are not work
    -- anybody should be scoring, and they used to fill this queue.
    JOIN journal_statuses st ON st.id = r.status_id AND st."group" = 'resolved'
    LEFT JOIN severities sev ON sev.id = r.severity_id
    WHERE r.state = 'submitted'
      AND NOT EXISTS (
        SELECT 1 FROM journal_scores s
        WHERE s.report_id = r.id AND s.tier = 'review' AND s.rater_id = ${callerId}
      )
    ORDER BY r.submitted_at DESC NULLS LAST
  `);

  return result.rows.map((row) => ({
    reportId: row.report_id,
    title: row.title,
    kind: row.kind,
    authorId: row.author_id,
    authorName: row.author_name,
    severityName: row.severity_name,
    submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
    depth: Number(row.depth),
  }));
}
