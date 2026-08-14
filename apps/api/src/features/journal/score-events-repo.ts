// Author: Brijesh Dave <https://github.com/brijeshdave>
// The append-only history of points changes on a report — the only code touching
// journal_score_events. A row is written per (subject, tier) whenever their points are
// set, cleared, or the person is dropped, so the Points tab can show who / when / old→new.
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/core/db/index.js";
import { journalScoreEvents, users } from "@/core/db/schema.js";
import type { ScoreRow, ScoreTier } from "@/features/journal/scores-repo.js";

export type ScoreEventReason = "score" | "reopened" | "rejected" | "removed" | "status-change";

export interface ScoreEventRow {
  id: string;
  subjectUserId: string | null;
  subjectName: string | null;
  tier: string;
  raterId: string | null;
  raterName: string | null;
  oldPoints: number | null;
  newPoints: number | null;
  reason: string;
  createdAt: Date;
}

const subject = alias(users, "event_subject");
const rater = alias(users, "event_rater");

/** One report's points-change events, newest first, with subject and rater names. */
export async function scoreEventsFor(reportId: string): Promise<ScoreEventRow[]> {
  return db
    .select({
      id: journalScoreEvents.id,
      subjectUserId: journalScoreEvents.subjectUserId,
      subjectName: subject.name,
      tier: journalScoreEvents.tier,
      raterId: journalScoreEvents.raterId,
      raterName: rater.name,
      oldPoints: journalScoreEvents.oldPoints,
      newPoints: journalScoreEvents.newPoints,
      reason: journalScoreEvents.reason,
      createdAt: journalScoreEvents.createdAt,
    })
    .from(journalScoreEvents)
    .leftJoin(subject, eq(subject.id, journalScoreEvents.subjectUserId))
    .leftJoin(rater, eq(rater.id, journalScoreEvents.raterId))
    .where(eq(journalScoreEvents.reportId, reportId))
    .orderBy(desc(journalScoreEvents.createdAt));
}

/**
 * Record the diff between a tier's scores before and after a change — one event per
 * subject whose points actually moved (added, changed, or removed). `raterId` is who made
 * the change; `reason` says why. Never throws into the caller — history must not break the
 * mutation it observes.
 */
export async function recordScoreEvents(
  reportId: string,
  tier: ScoreTier,
  before: ScoreRow[],
  after: { userId: string; points: number }[],
  raterId: string,
  reason: ScoreEventReason,
): Promise<void> {
  try {
    const beforeByUser = new Map(before.map((s) => [s.subjectUserId, s.points]));
    const afterByUser = new Map(after.map((s) => [s.userId, s.points]));
    const subjects = new Set([...beforeByUser.keys(), ...afterByUser.keys()]);

    const rows = [...subjects]
      .map((userId) => ({
        oldPoints: beforeByUser.has(userId) ? beforeByUser.get(userId)! : null,
        newPoints: afterByUser.has(userId) ? afterByUser.get(userId)! : null,
        userId,
      }))
      .filter((r) => r.oldPoints !== r.newPoints)
      .map((r) => ({
        reportId,
        subjectUserId: r.userId,
        tier,
        raterId,
        oldPoints: r.oldPoints,
        newPoints: r.newPoints,
        reason,
      }));

    if (rows.length > 0) await db.insert(journalScoreEvents).values(rows);
  } catch {
    // Swallow: a missing history row must never fail the score change itself.
  }
}

/** Record a standalone marker with no per-subject numbers — e.g. "status changed, re-check". */
export async function recordMarkerEvent(
  reportId: string,
  raterId: string,
  reason: ScoreEventReason,
): Promise<void> {
  try {
    await db.insert(journalScoreEvents).values({
      reportId,
      subjectUserId: null,
      tier: "review",
      raterId,
      oldPoints: null,
      newPoints: null,
      reason,
    });
  } catch {
    // Swallow: history must not break the mutation it observes.
  }
}
