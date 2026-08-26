// Author: Brijesh Dave <https://github.com/brijeshdave>
// Scoring a report, and the points it produces.
//
// A resolved report is scored at two tiers: the worker's own split of the credit
// among everyone who worked it (`self`), and a single management review by their
// reporting manager (`review`). Both are real points in 0.5 steps. When a review
// exists it is the worker's **official** figure; otherwise the self number stands.
//
// The scoring is **blind upward**: a worker sees only the self split. The review
// and the official figure it produces are visible to the reporting manager and
// above — never to the person being reviewed.
//
// A worker's official points are frozen into the ledger, and every manager above
// them earns a decaying share of it (see the appraisal settings). Points are for
// finished work: re-opening a report clears its scores and its ledger rows.
import { z } from "zod";

import { nameSchema, uuidSchema } from "@/entities/common.js";

/** The most points one report is worth, shared out among everyone who worked it.
 *  A whole tier (a self split, or a review) may total at most this — adding a name
 *  divides the ten, it never mints more. */
export const MAX_ENTRY_POINTS = 10;

/** Points, entered and awarded in half-point steps (0, 0.5, 1, …). */
export const pointStepSchema = z
  .number()
  .nonnegative()
  .refine((value) => Number.isInteger(value * 2), {
    message: "Use half-point steps (0, 0.5, 1, …)",
  });

/**
 * One worker's row in a report's scoring grid.
 *
 * `self` is the split the author gave; `review` is the management review. Both are
 * null until set, and `review`/`official` are also null when the viewer is not
 * allowed to see the review — a worker looking at their own report sees only `self`.
 * `official` is what counts: the review if there is one, else the self number.
 */
export const journalScoreSchema = z.object({
  userId: z.string(),
  userName: nameSchema,
  self: z.number().nullable(),
  review: z.number().nullable(),
  official: z.number().nullable(),
});
export type JournalScore = z.infer<typeof journalScoreSchema>;

/**
 * Set the caller's tier of scores for a report's workers.
 *
 * The tier is not in the body — the server derives it from who the caller is: the
 * author sets `self`, a manager above them sets `review`. Every listed user must be
 * a participant on the report.
 */
export const setScoresSchema = z.object({
  scores: z.array(z.object({ userId: z.string(), points: pointStepSchema })),
});
export type SetScores = z.infer<typeof setScoresSchema>;

/**
 * One of your own entries that nobody above you has scored yet.
 *
 * The mirror of a pending appraisal: that is what somebody owes you, this is
 * what you are owed. Before it existed, the person who filed the work had no way
 * to see it sitting there, short of asking.
 */
export const awaitingReviewSchema = z.object({
  reportId: uuidSchema,
  title: z.string(),
  kind: z.string(),
  severityName: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  /** Null when no manager is set on your line — a real state, not an error. */
  reviewerName: z.string().nullable(),
  /**
   * True when *you* have not split the points yet.
   *
   * The self split comes first: a manager reviews a number the worker has already
   * put forward, so until it exists there is nothing to review. Without this the
   * entry sat in "waiting on somebody else" while in fact it was waiting on the
   * person reading the screen.
   */
  needsSelfScore: z.boolean(),
});
export type AwaitingReview = z.infer<typeof awaitingReviewSchema>;

/**
 * A report awaiting the caller's review: it is resolved, authored by someone in
 * their downline, and they have not reviewed it yet. The manager's to-do list.
 */
export const pendingAppraisalSchema = z.object({
  reportId: uuidSchema,
  title: nameSchema,
  kind: z.string(),
  authorId: z.string(),
  authorName: nameSchema,
  severityName: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  /** How far below the caller the author sits — 1 is a direct report. */
  depth: z.number().int().positive(),
});
export type PendingAppraisal = z.infer<typeof pendingAppraisalSchema>;

/** A person's points, summed from the frozen ledger. */
export const pointsSummarySchema = z.object({
  /** Points from the caller's own official scores. */
  own: z.number(),
  /** Points rolled up from everyone in the caller's downline. */
  rollup: z.number(),
  total: z.number(),
});
export type PointsSummary = z.infer<typeof pointsSummarySchema>;
