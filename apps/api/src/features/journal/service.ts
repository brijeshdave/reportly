// Author: Brijesh Dave <https://github.com/brijeshdave>
// JournalEntry business logic: visibility down the reporting line, the blind-upward
// scoring, and the frozen points ledger.
//
// The rules that matter, in one place:
//   - You see your own reports (any state) and submitted reports by anyone in your
//     downline. A draft is nobody's business but its author's.
//   - A resolved report is scored at two tiers: the author's own split among the
//     workers (self), and one management review by a manager above. A worker sees
//     only the self split — the review, and the official figure it sets, are for
//     the manager and above.
//   - A worker's official points (the review if any, else their self number) are
//     frozen into a ledger, rounded to 0.5; managers earn a decaying share of their
//     downline's official points. Re-opening a report clears its scores and ledger.
import {
  APPRAISAL_SETTINGS,
  MAX_ENTRY_POINTS,
  POINTS_LOCK_SETTINGS,
  REPORT_ENTRY_SETTINGS,
  SCORE_EVENT_REASONS,
  type ScoreEvent,
  type AuthContext,
  ERROR_CODES,
  PERMISSIONS,
  type AwaitingReview,
  type PendingAppraisal,
  type PointsSummary,
  type RecurrenceLink,
  type JournalEntry,
  type JournalHandover,
  type CreateWorkLog,
  type JournalParticipant,
  type UpdateWorkLog,
  type WorkLog,
  type JournalEntryRow,
  type JournalScore,
  type JournalTarget,
  type JournalTargetInput,
  type JournalTimeline,
  can,
} from "@reportly/shared";

import { mayUseLocation, withLocationsNullable } from "@/core/db/scoped.js";
import { journalEntries as reportsTable } from "@/core/db/schema.js";
import { AppError } from "@/core/errors.js";
import { notify } from "@/core/queue/notifications.js";
import { getSystemSetting } from "@/core/settings/service.js";
import { removeAttachmentsFor } from "@/features/attachments/cleanup.js";
import { recordChanges } from "@/core/history.js";
import { logger } from "@/core/logger.js";
import { getTask as getTaskRow, updateTaskRow } from "@/features/tasks/repo.js";
import {
  clearAwards,
  clearScores,
  awaitingReviewFor,
  pendingFor,
  pointsFor,
  pruneScores,
  replaceAwards,
  replaceTier,
  scoresFor,
  type AwardInput,
  type ScoreRow,
  type ScoreTier,
} from "@/features/journal/scores-repo.js";
import {
  recordMarkerEvent,
  recordScoreEvents,
  scoreEventsFor,
  type ScoreEventReason,
} from "@/features/journal/score-events-repo.js";
import { colleaguesOf } from "@/features/departments/repo.js";
import {
  deleteWorkLogRow,
  getWorkLog,
  insertWorkLog,
  refreshWorkRollup,
  updateWorkLogRow,
  workLogsFor,
  type WorkLogRow,
} from "@/features/journal/work-log-repo.js";
import { ancestorsOf, downlineUserIds } from "@/features/journal/hierarchy.js";
import {
  addAuthorAsParticipant,
  handoversFor,
  insertHandover,
  participantsFor,
  setParticipants,
  type ParticipantRowRaw,
} from "@/features/journal/collaboration-repo.js";
import { firstStatusInGroup, getStatus as getStatusRow } from "@/features/journal-config/repo.js";
import { insertStatusEvent, statusEventsFor } from "@/features/journal/status-events-repo.js";
import { deleteCommentsFor } from "@/features/comments/repo.js";
import { clearTags, tagsFor, tagsForMany } from "@/features/vocabulary/repo.js";
import { applyTags } from "@/features/vocabulary/service.js";
import { computeTiming } from "@/features/journal/timing.js";
import {
  deleteReportRow,
  getReport as getReportRow,
  insertReport,
  listReports as listReportRows,
  recurrenceChain,
  updateReportRow,
  type NewJournalEntry,
  type JournalEntryPatch,
  type JournalEntryRowRaw,
} from "@/features/journal/repo.js";
import {
  existingTargets,
  reportIdsForTargets,
  scopeUnderAsset,
  setTargets,
  targetsFor,
} from "@/features/journal/targets-repo.js";
import type { ResolvedListQuery } from "@reportly/shared";

/* ------------------------------ serialization ------------------------------ */

function minutesBetween(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Scope defaults to empty: a list row drops it, and a report may legitimately be
 * about nothing at all. Only a detail read pays for resolving the labels. */
function serialize(
  row: JournalEntryRowRaw,
  targets: JournalTarget[] = [],
  tags: { id: string; name: string; color: string }[] = [],
): JournalEntry {
  return {
    targets,
    tags,
    id: row.id,
    companyId: row.companyId,
    authorId: row.authorId,
    authorName: row.authorName,
    kind: row.kind === "issue" ? "issue" : "work",
    state: row.state === "submitted" ? "submitted" : "draft",
    title: row.title,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    locationId: row.locationId,
    locationName: row.locationName,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    severityId: row.severityId,
    severityName: row.severityName,
    statusId: row.statusId,
    statusName: row.statusName,
    statusGroup: row.statusGroup,
    statusIsTerminal: row.statusIsTerminal ?? false,
    reportDate: row.reportDate.toISOString(),
    occurredAt: iso(row.occurredAt),
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
    durationMinutes: minutesBetween(row.startedAt, row.endedAt),
    issueSummary: row.issueSummary,
    issueDetail: row.issueDetail,
    rootCause: row.rootCause,
    preventiveMeasures: row.preventiveMeasures,
    workSummary: row.workSummary,
    workDetail: row.workDetail,
    recurrenceOfId: row.recurrenceOfId,
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    lockedAt: iso(row.lockedAt),
    submittedAt: iso(row.submittedAt),
    rejectedAt: iso(row.rejectedAt),
    rejectedById: row.rejectedById,
    rejectedByName: row.rejectedByName,
    rejectionReason: row.rejectionReason,
    pointsReviewNeeded: row.pointsReviewNeeded,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Strip the long-text fields and the scope for a list row. */
function toRow(report: JournalEntry): JournalEntryRow {
  const { issueDetail, workDetail, rootCause, preventiveMeasures, targets, ...rest } = report;
  void issueDetail;
  void workDetail;
  void rootCause;
  void preventiveMeasures;
  void targets;
  return rest;
}

/** Round to the nearest half-point — every score and award lands on the 0.5 grid. */
function toHalfStep(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * Build a report's scoring grid for one viewer.
 *
 * One row per participant, in the order they were added. `self` is the author's
 * split; `review` is the management review and `official` the figure that counts
 * (review if present, else self). The review is **blind upward**: only a viewer
 * who may see it — someone strictly above the author, or a superadmin — gets the
 * `review` and `official` columns; everyone else, the workers included, sees the
 * self split alone.
 */
function buildScoreGrid(
  participants: ParticipantRowRaw[],
  scores: ScoreRow[],
  canSeeReview: boolean,
): JournalScore[] {
  const selfOf = new Map<string, number>();
  const reviewOf = new Map<string, number>();
  for (const s of scores) {
    (s.tier === "self" ? selfOf : reviewOf).set(s.subjectUserId, s.points);
  }
  return participants.map((p) => {
    const self = selfOf.get(p.userId) ?? null;
    const review = reviewOf.get(p.userId) ?? null;
    const official = review ?? self;
    return {
      userId: p.userId,
      userName: p.userName,
      self,
      review: canSeeReview ? review : null,
      official: canSeeReview ? official : null,
    };
  });
}

/* --------------------------------- reports --------------------------------- */

/**
 * The entry, and only if it belongs to the caller's company.
 *
 * The company check lives **here**, at the fetch, rather than only in
 * `isVisible`. Fifteen of this function's call sites never reach a visibility
 * check at all — `setScores`, `updateReport`, `reopenReport`, `rejectReport`,
 * `deleteReport` and friends authorise on the reporting line instead, and the
 * line is precisely what crosses companies. Guarding the read is the only place
 * that covers every path, including the ones that mutate.
 *
 * A null company on the context is a superadmin across all of them.
 */
async function requireReport(id: string, ctx: AuthContext): Promise<JournalEntryRowRaw> {
  const row = await getReportRow(id);
  if (!row || (ctx.companyId !== null && row.companyId !== ctx.companyId)) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "JournalEntry not found");
  }
  return row;
}

/** May this caller see this report at all? Own (any state), or a submitted report
 * by someone in their downline; superadmin sees every submitted one. */
async function assertVisible(row: JournalEntryRowRaw, ctx: AuthContext): Promise<void> {
  if (!(await isVisible(row, ctx))) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "JournalEntry not found");
  }
}

/**
 * The visibility rule itself: may this caller see this report at all?
 *
 * `assertVisible` is the throwing face of this, and callers that need a verdict
 * rather than an exception (the recurrence chain, which filters a list) use this
 * one. Two faces, one rule — a second copy of "who may see a report" is the last
 * thing this codebase needs.
 *
 * `below` is optional so a caller filtering many rows resolves the downline once
 * instead of walking the reporting line per row.
 */
/**
 * Whether the caller is named on "who worked on it".
 *
 * `id` is part of the type rather than read off an untyped cast: a projection without
 * it would have made this quietly answer "no" for everybody, which is the shape of
 * bug that looks identical to a working guard.
 */
async function isWorker(row: { id: string }, ctx: AuthContext): Promise<boolean> {
  const workers = await participantsFor(row.id);
  return workers.some((worker) => worker.userId === ctx.userId);
}

async function isVisible(
  row: Pick<
    JournalEntryRowRaw,
    "id" | "authorId" | "state" | "locationId" | "assigneeId" | "companyId"
  >,
  ctx: AuthContext,
  below?: Set<string>,
): Promise<boolean> {
  // The company comes first, before ownership and before the reporting line.
  //
  // Everything below this narrows within a tenant; none of it establishes one.
  // The reporting line looked like it did — an edge is refused across companies —
  // but the downline is *walked* with no company filter, so one person holding a
  // department in each is a bridge the recursion crosses. A manager in company A
  // could then open, and score, an entry belonging to company B.
  //
  // `companyId` null on the context is a superadmin viewing all companies, which
  // is the only legitimate way to be reading across them.
  if (ctx.companyId !== null && row.companyId !== ctx.companyId) return false;
  // Your own report is always yours, wherever it was filed — you wrote it, and a
  // scope change afterwards must not take your own work away from you.
  if (row.authorId === ctx.userId) return true;
  // And a report handed to you is yours to see. Without this, handing work to a
  // colleague outside your reporting line gave them something they could not open
  // — the assignment silently did nothing.
  if (row.assigneeId && row.assigneeId === ctx.userId) return true;
  // A draft is private, even from a superadmin — it is unfinished, not hidden.
  if (row.state !== "submitted") return false;
  // Somebody on "who worked on it" can open it. They are named on the entry as
  // having done the work and are scored on it, so an entry they cannot read was a
  // record of their own work kept from them — and it made logging that work
  // impossible for anybody outside the reporting line.
  if (await isWorker(row, ctx)) return true;
  // Location narrows; it never widens. Both the reporting line AND the site must
  // admit you, so managing the author is not enough to read a report from a plant
  // you cannot see.
  if (!mayUseLocation(ctx, row.locationId)) return false;
  if (ctx.isSuperadmin) return true;
  const downline = below ?? (await downlineUserIds(ctx.userId));
  return downline.has(row.authorId);
}

/**
 * Filing into a location you cannot reach is refused rather than filtered — a
 * report placed at a site you can never open again is a record lost on purpose.
 * A null location is allowed: it means "not stated", which the editor will stop
 * offering once the picker lands.
 */
function assertMayFileAt(locationId: string | null, ctx: AuthContext): void {
  if (!mayUseLocation(ctx, locationId)) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You cannot file a report at that location");
  }
}

/** Whole days between two dates, ignoring the time of day (UTC calendar days). */
function daysBetween(earlier: Date, later: Date): number {
  const a = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  const b = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * An entry may not be dated further back than the configured grace period — otherwise
 * unlimited backdating lets someone log ancient work or issues after the fact. What the
 * grace measures depends on the kind: an **issue** by when it *occurred*, a **work log**
 * by its report date (when the work was done, which is when its points count). The grace
 * is a whole-day count; a superadmin is exempt. `subject` names the date in the error.
 */
async function assertWithinGrace(date: Date, ctx: AuthContext, subject: string): Promise<void> {
  if (ctx.isSuperadmin) return;
  const { graceDays } = await getSystemSetting(REPORT_ENTRY_SETTINGS);
  if (daysBetween(date, new Date()) > graceDays) {
    const days = `${graceDays} ${graceDays === 1 ? "day" : "days"}`;
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `${subject} more than ${days} ago — entries must be filed within ${days}.`,
    );
  }
}

/**
 * The date the grace period judges, or null when there is nothing to limit. An issue is
 * bound by when it occurred (an issue with no occurred date is treated as happening now,
 * so a plain "file it now" is never blocked); a work log by its report date.
 */
function graceDate(
  isWorkLog: boolean,
  reportDate: Date,
  occurredAt: Date | null,
): { date: Date; subject: string } | null {
  if (isWorkLog) return { date: reportDate, subject: "This work is dated" };
  return occurredAt ? { date: occurredAt, subject: "This issue occurred" } : null;
}

/**
 * Whether an entry's points are in a locked (closed) period — its points-date is on or
 * before the admin's cutoff. A blank cutoff means no lock. The caller decides the
 * superadmin/re-evaluation exemptions.
 */
async function isPeriodLocked(reportDate: Date): Promise<boolean> {
  const { lockedThrough } = await getSystemSetting(POINTS_LOCK_SETTINGS);
  if (!lockedThrough) return false;
  return reportDate.toISOString().slice(0, 10) <= lockedThrough;
}

/** Refuse a points change on a locked entry, unless a status change re-opened it or it is superadmin. */
async function assertPointsUnlocked(row: JournalEntryRowRaw, ctx: AuthContext): Promise<void> {
  if (ctx.isSuperadmin || row.pointsReviewNeeded) return;
  if (await isPeriodLocked(row.reportDate)) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Points for this period are locked. A status change re-opens them for re-evaluation.",
    );
  }
}

/** Record that every current score was cleared (reopen/reject) — one event per subject/tier. */
async function recordScoresCleared(
  reportId: string,
  raterId: string,
  reason: ScoreEventReason,
): Promise<void> {
  const before = await scoresFor(reportId);
  for (const tier of ["self", "review"] as const) {
    const tierRows = before.filter((s) => s.tier === tier);
    if (tierRows.length > 0) await recordScoreEvents(reportId, tier, tierRows, [], raterId, reason);
  }
}

function toDate(value: string | undefined | null): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}

/**
 * Every scope link must name something inside this company. There is no foreign key
 * to catch this — scope spans four tables — so it is checked here, or a report could
 * quietly point at another company's line and expose its name on the detail screen.
 */
async function assertTargets(companyId: string, targets: JournalTargetInput[]): Promise<void> {
  if (targets.length === 0) return;
  const found = await existingTargets(companyId, targets);
  const missing = targets.filter((t) => !found.has(`${t.kind}:${t.id}`));
  if (missing.length > 0) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `Scope names ${missing.length} thing(s) that are not in this company`,
      { missing },
    );
  }
}

/**
 * A report may only be logged against a task the author actually holds.
 *
 * Without this, `taskId` is a client-supplied id on a create: anyone could hang
 * their work off somebody else's task, and it would show on that task's page as
 * though they had done it.
 */
async function assertTaskIsMine(
  taskId: string,
  companyId: string,
  ctx: AuthContext,
): Promise<void> {
  const task = await getTaskRow(taskId);
  if (!task || task.companyId !== companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Task not found in this company");
  }
  if (task.assigneeId !== ctx.userId && !ctx.isSuperadmin) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "You can only log work against a task assigned to you",
    );
  }
}

export async function listReports(
  query: ResolvedListQuery,
  ctx: AuthContext,
): Promise<{ rows: JournalEntryRow[]; total: number }> {
  // Superadmin may see every author; everyone else, themselves plus their downline.
  const visibleAuthorIds = ctx.isSuperadmin
    ? null
    : [ctx.userId, ...(await downlineUserIds(ctx.userId))];

  const { rows, total } = await listReportRows(
    query,
    ctx.userId,
    visibleAuthorIds,
    ctx.companyId,
    null,
    withLocationsNullable(ctx, reportsTable.locationId),
  );
  // One query for every row's tags, rather than one per row.
  const tagsByReport = await tagsForMany(
    "report",
    rows.map((r) => r.id),
  );
  return {
    rows: rows.map((row) => toRow(serialize(row, [], tagsByReport.get(row.id) ?? []))),
    total,
  };
}

/**
 * The reports under one asset — the roll-up read.
 *
 * "The issues on Line 3" means the line, its stations, *and* the machines standing
 * at them. The devices are found through the asset they live at, so a flat registry
 * of thousands still rolls up without any of it being arranged into a tree by hand.
 * Visibility is applied on top as usual: this narrows the list, it never widens it.
 */
export async function listReportsUnderAsset(
  assetId: string,
  companyId: string,
  query: ResolvedListQuery,
  ctx: AuthContext,
): Promise<{ rows: JournalEntryRow[]; total: number }> {
  const { assetIds, deviceIds } = await scopeUnderAsset(assetId, companyId);
  if (assetIds.length === 0) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Asset not found");

  const reportIds = await reportIdsForTargets([
    { kind: "asset", ids: assetIds },
    { kind: "device", ids: deviceIds },
  ]);
  if (reportIds.length === 0) return { rows: [], total: 0 };

  const visibleAuthorIds = ctx.isSuperadmin
    ? null
    : [ctx.userId, ...(await downlineUserIds(ctx.userId))];
  const { rows, total } = await listReportRows(
    query,
    ctx.userId,
    visibleAuthorIds,
    companyId,
    reportIds,
    withLocationsNullable(ctx, reportsTable.locationId),
  );
  const tagsByReport = await tagsForMany(
    "report",
    rows.map((r) => r.id),
  );
  return {
    rows: rows.map((row) => toRow(serialize(row, [], tagsByReport.get(row.id) ?? []))),
    total,
  };
}

/** A report with its appraisals already filtered for this viewer (blind upward). */
export async function getReport(
  id: string,
  ctx: AuthContext,
): Promise<
  JournalEntry & {
    scores: JournalScore[];
    canChangeStatus: boolean;
    canEdit: boolean;
    canReopen: boolean;
    canSeePointsHistory: boolean;
    myScoreTier: ScoreTier | null;
  }
> {
  const row = await requireReport(id, ctx);
  await assertVisible(row, ctx);

  const [participants, scores, targets, tags, isAbove] = await Promise.all([
    participantsFor(id),
    scoresFor(id),
    targetsFor(id),
    tagsFor("report", id),
    isAboveAuthor(ctx.userId, row.authorId),
  ]);
  const hasReview = scores.some((s) => s.tier === "review");
  const canSeeReview = ctx.isSuperadmin || isAbove;
  const myScoreTier = await writableTier(row, ctx, hasReview);

  return {
    ...serialize(row, targets, tags),
    scores: buildScoreGrid(participants, scores, canSeeReview),
    // Computed here rather than inferred in the browser from ids. The rule admits
    // anyone above the author or assignee in the reporting line, which the browser
    // cannot evaluate without another call — and a screen that guesses will
    // eventually disagree with the API that decides.
    canChangeStatus: await mayDriveStatus(row, ctx),
    // Resolved here, never inferred in the browser: the rule is about who holds the
    // entry, and a screen that guessed would offer an Edit button that then 403s.
    canEdit: mayEdit(row, ctx),
    // Whether this caller may re-open it — the author, or a manager above them who
    // holds reports:update. Mirrors `reopenReport`, so a manager can free a reviewed
    // report (a work log especially, which has no status dropdown) to be scored again.
    canReopen:
      row.authorId === ctx.userId ||
      ctx.isSuperadmin ||
      (can(ctx, PERMISSIONS.JOURNAL_UPDATE) && isAbove),
    // The points-change history exposes the review tier, so it follows the same
    // blind-upward rule the score grid does — only someone above the author sees it.
    canSeePointsHistory: canSeeReview,
    // Which scoring column this caller may fill, if any — the author's self split,
    // a manager's review, or nothing. Server-computed for the same reason.
    myScoreTier,
  };
}

/**
 * A report's status history, and what it adds up to.
 *
 * `assertVisible` is the same gate `getReport` uses — the timeline says who
 * touched a report and when, which is exactly as sensitive as the report. It is
 * called here rather than re-derived: one visibility rule, one implementation.
 */
export async function getTimeline(id: string, ctx: AuthContext): Promise<JournalTimeline> {
  const row = await requireReport(id, ctx);
  await assertVisible(row, ctx);

  const events = await statusEventsFor(id);
  return {
    timing: computeTiming(
      events.map((e) => ({ changedAt: e.changedAt, toIsTerminal: e.toIsTerminal ?? false })),
    ),
    events: events.map((e) => ({
      id: e.id,
      reportId: e.reportId,
      fromStatusId: e.fromStatusId,
      fromStatusName: e.fromStatusName,
      toStatusId: e.toStatusId,
      toStatusName: e.toStatusName,
      changedById: e.changedById,
      changedByName: e.changedByName,
      changedAt: e.changedAt.toISOString(),
    })),
  };
}

/**
 * The explicit recurrence chain a report belongs to — every report linked through
 * `recurrenceOfId`, in date order, so a detail page can say "this has happened 5
 * times before".
 *
 * Each link is filtered through the caller's own visibility. A chain is not a
 * back door: if somebody cannot see a report, learning that it exists because it
 * is an ancestor of one they can see is still learning it. So the count on screen
 * is the count *they* may see, and it can legitimately be lower than the truth.
 */
export async function getRecurrences(id: string, ctx: AuthContext): Promise<RecurrenceLink[]> {
  const row = await requireReport(id, ctx);
  await assertVisible(row, ctx);

  const chain = await recurrenceChain(id, row.companyId);
  // Resolved once for the whole chain, not per link — the walk up the reporting
  // line is a recursive query, and a 20-link chain should not cost 20 of them.
  const below = ctx.isSuperadmin ? new Set<string>() : await downlineUserIds(ctx.userId);

  const links: RecurrenceLink[] = [];
  for (const link of chain) {
    if (link.id === id) continue;
    if (!(await isVisible(link, ctx, below))) continue;
    links.push({
      reportId: link.id,
      title: link.title,
      reportDate: link.reportDate.toISOString(),
      statusName: link.statusName,
      severityName: link.severityName,
    });
  }
  return links;
}

/**
 * Move a report to another status.
 *
 * Its own operation rather than a field on the edit form, for three reasons that
 * each matter on their own:
 *
 *  1. **It is the thing people do most.** Making somebody open an edit form, change
 *     one dropdown and save, to say "I've started on this", is enough friction that
 *     statuses stop being kept up to date — and then every figure derived from them
 *     is wrong.
 *  2. **It survives the content lock.** Editing a report freezes once it has been
 *     appraised, so a mark is never for work that changed underneath it. A status is
 *     not the work: a report can be marked while in progress and resolved a day
 *     later, and forcing a re-open to say so would be absurd. Same reasoning that
 *     keeps downtime closable and comments open.
 *  3. **It is not the author's alone.** Whoever is holding the report is usually the
 *     person who knows it has moved on.
 *
 * The legal moves come from the `group`/`isTerminal` flags each status already
 * carries rather than a hard-coded map of names, because the catalogue is
 * configurable — a map would be wrong the moment an admin adds a status:
 *
 *   open → open        yes, work does not proceed in a straight line
 *   open → finished    yes, from any working state
 *   finished → open    yes, and that is a re-open: deliberate, and recorded
 *   finished → finished NO — Resolved straight to Duplicate loses the fact that it
 *                       was ever resolved. Re-open first, then reject it.
 */
export async function changeStatus(
  id: string,
  statusId: string | null,
  ctx: AuthContext,
): Promise<JournalEntry> {
  const row = await requireReport(id, ctx);
  await assertVisible(row, ctx);
  await assertMayDriveStatus(row, ctx);

  if (row.statusId === statusId) {
    return serialize(row, await targetsFor(id), await tagsFor("report", id));
  }

  const next = statusId ? await getStatusRow(statusId) : null;
  if (statusId && !next) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That status does not exist");
  }
  if (next && next.status === "inactive") {
    // A retired status stays readable on the reports already carrying it, but
    // nothing new may move into it.
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, `"${next.name}" is no longer offered`);
  }
  const current = row.statusId ? await getStatusRow(row.statusId) : null;
  if (current && next) {
    if (current.isTerminal && next.isTerminal) {
      throw new AppError(
        409,
        ERROR_CODES.CONFLICT,
        `This report is already ${current.name}. Re-open it before marking it ${next.name}, so the record shows both.`,
      );
    }
  }

  // Moving a finished report back to a working state is a **re-open**, whichever way
  // it is done — the status dropdown or the Re-open button. Points are for finished
  // work, so its scores and ledger rows are cleared and its content unlocked. This is
  // how a manager lets a report be worked and scored again after they have reviewed
  // it: change the status, and the split is honestly open once more.
  const reopening = Boolean(current?.isTerminal && next && !next.isTerminal);

  // If the points period is closed, a status change re-opens the points for
  // re-evaluation: flag it so it may be re-scored despite the lock, and leave a marker in
  // the points history that a re-check is due.
  const locked = await isPeriodLocked(row.reportDate);

  await updateReportRow(id, {
    statusId,
    ...(reopening ? { lockedAt: null } : {}),
    ...(locked ? { pointsReviewNeeded: true } : {}),
  });
  if (reopening) {
    await recordScoresCleared(id, ctx.userId, "reopened");
    await clearScores(id);
    await clearAwards(id);
  }
  if (locked) await recordMarkerEvent(id, ctx.userId, "status-change");
  await insertStatusEvent({
    reportId: id,
    fromStatusId: row.statusId,
    toStatusId: statusId,
    changedBy: ctx.userId,
  });

  await notify({
    type: "journal.status-changed",
    companyId: row.companyId,
    actorUserId: ctx.userId,
    subjectUserId: row.authorId,
    title: `Your entry is now ${next?.name ?? "unset"}: ${row.title}`,
    body: "",
    link: `/journal/${id}`,
    entityKind: "journal",
    entityId: id,
  });

  // Finished work is what a manager appraises, so the reporting line is told when
  // an entry *reaches* a terminal status — not when it is filed. Telling them at
  // filing would put every entry in front of them twice, once before there was
  // anything to judge.
  if (next?.isTerminal && !current?.isTerminal) {
    await notify({
      type: "journal.awaiting-review",
      companyId: row.companyId,
      actorUserId: ctx.userId,
      subjectUserId: row.authorId,
      title: `An entry is ready for your review: ${row.title}`,
      body: `Marked ${next.name}.`,
      link: `/journal/${id}`,
      entityKind: "journal",
      entityId: id,
    });
  }

  return serialize(await requireReport(id, ctx), await targetsFor(id), await tagsFor("report", id));
}

/**
 * Who may move a report along: the person who raised it, whoever is holding it, and
 * anyone above them in the line. The same walk downtime uses, plus the assignee —
 * the point being that the people doing the work are the ones who know it moved.
 */
async function mayDriveStatus(row: JournalEntryRowRaw, ctx: AuthContext): Promise<boolean> {
  if (ctx.isSuperadmin) return true;
  if (row.authorId === ctx.userId || row.assigneeId === ctx.userId) return true;
  const below = await downlineUserIds(ctx.userId);
  return below.has(row.authorId) || Boolean(row.assigneeId && below.has(row.assigneeId));
}

/** The throwing face of `mayDriveStatus`, for the write path. */
async function assertMayDriveStatus(row: JournalEntryRowRaw, ctx: AuthContext): Promise<void> {
  if (await mayDriveStatus(row, ctx)) return;
  throw new AppError(
    403,
    ERROR_CODES.FORBIDDEN,
    "Only the people working this report, or someone above them, can change its status",
  );
}

/* ------------------------- assignment & participants ----------------------- */

/**
 * Hand a report to somebody, or put it down.
 *
 * Who may be given it uses the **same walk tasks use** — `downlineUserIds` plus
 * self — so "who works for me" has one answer in this codebase rather than two
 * that can disagree. Null is a real destination: work can be put down before
 * anyone else picks it up, and forcing a successor would make people assign it
 * to someone arbitrary.
 *
 * Every change appends to `journal_handovers`. The current holder lives on the
 * report for cheap reads; the trail is the record of how it got there.
 */
export async function assignReport(
  id: string,
  input: { assigneeId: string | null; reason?: string },
  ctx: AuthContext,
): Promise<JournalEntry> {
  const row = await requireReport(id, ctx);
  await assertVisible(row, ctx);

  if (input.assigneeId !== null && !ctx.isSuperadmin) {
    // Yourself, your downline, **or a colleague** — somebody who shares a department
    // with you.
    //
    // The downline alone was wrong, and wrong in a way that fell hardest on the
    // people who hand work over most: a handover goes to whoever picks the job up
    // next, which is usually the peer on the next shift, not a subordinate. An
    // engineer with nobody reporting to them could hand a report to exactly one
    // person — themselves — which is not a handover at all.
    const allowed = await downlineUserIds(ctx.userId);
    allowed.add(ctx.userId);
    if (!allowed.has(input.assigneeId)) {
      const colleagues = await colleaguesOf(ctx.userId, row.companyId);
      if (!colleagues.some((colleague) => colleague.userId === input.assigneeId)) {
        throw new AppError(
          403,
          ERROR_CODES.FORBIDDEN,
          "You can hand a report to yourself, a colleague in your department, or someone below you in the reporting line",
        );
      }
    }
  }

  // Re-assigning to whoever already holds it is a no-op, not a handover: logging
  // it would fill the trail with entries that record nothing happening.
  if (row.assigneeId === input.assigneeId) {
    return serialize(row, await targetsFor(id), await tagsFor("report", id));
  }

  await updateReportRow(id, { assigneeId: input.assigneeId });
  await insertHandover({
    reportId: id,
    fromUserId: row.assigneeId,
    toUserId: input.assigneeId,
    byUserId: ctx.userId,
    reason: input.reason?.trim() || null,
  });

  // Only on a handover TO somebody. Clearing an assignee tells nobody anything.
  if (input.assigneeId) {
    await notify({
      type: "journal.assigned",
      companyId: row.companyId,
      actorUserId: ctx.userId,
      subjectUserId: input.assigneeId,
      title: `An entry was assigned to you: ${row.title}`,
      body: input.reason?.trim() || "",
      link: `/journal/${id}`,
      entityKind: "journal",
      entityId: id,
    });
  }

  return serialize(await requireReport(id, ctx), await targetsFor(id), await tagsFor("report", id));
}

/** The trail of a report changing hands — same visibility as the report itself. */
export async function listHandovers(id: string, ctx: AuthContext): Promise<JournalHandover[]> {
  const row = await requireReport(id, ctx);
  await assertVisible(row, ctx);
  return (await handoversFor(id)).map((h) => ({
    id: h.id,
    reportId: h.reportId,
    fromUserId: h.fromUserId,
    fromUserName: h.fromUserName,
    toUserId: h.toUserId,
    toUserName: h.toUserName,
    byUserId: h.byUserId,
    byUserName: h.byUserName,
    reason: h.reason,
    handedAt: h.handedAt.toISOString(),
  }));
}

export async function listParticipants(
  id: string,
  ctx: AuthContext,
): Promise<JournalParticipant[]> {
  const row = await requireReport(id, ctx);
  await assertVisible(row, ctx);
  const rows = await participantsFor(id);
  return rows.map((p) => ({
    userId: p.userId,
    userName: p.userName,
    addedById: p.addedById,
    addedByName: p.addedByName,
    addedAt: p.addedAt.toISOString(),
  }));
}

/**
 * Record who worked this report — the membership, not the points.
 *
 * This is only *who* took part; how many points each earns is scored separately
 * (see `setScores`). Membership is editable any time — somebody joins on Tuesday
 * and the record should say so on Tuesday — and dropping a worker after they have
 * been scored also drops their score, since a score with nobody attached is
 * meaningless. The subsequent scoring re-freeze keeps the ledger honest.
 *
 * The author and the assignee are not implicit members: naming them explicitly is
 * how "everyone who worked it" stays a statement somebody made rather than a set
 * the system inferred.
 */
export async function setReportParticipants(
  id: string,
  participants: { userId: string }[],
  ctx: AuthContext,
): Promise<JournalParticipant[]> {
  const row = await requireReport(id, ctx);
  await assertVisible(row, ctx);

  // The author decides who worked it — plus their line, so a wrong list can still
  // be corrected when the author is on leave or has left.
  if (!ctx.isSuperadmin && row.authorId !== ctx.userId) {
    const below = await downlineUserIds(ctx.userId);
    if (!below.has(row.authorId)) {
      throw new AppError(403, ERROR_CODES.FORBIDDEN, "You cannot change who worked on this report");
    }
  }

  // The author is always on the list, even if the caller left them off. They are
  // the one person guaranteed to have a hand in the report, and without a row they
  // could never score themselves — the split has to include its own author. If they
  // truly did nothing, that is what a score of zero is for.
  const withAuthor = participants.some((p) => p.userId === row.authorId)
    ? participants
    : [{ userId: row.authorId }, ...participants];

  await setParticipants(id, withAuthor, ctx.userId);
  // Scores hang off participants; if a worker was dropped, their scores must go
  // too, and the ledger is refrozen off whoever remains.
  await pruneScoresToParticipants(id, ctx.userId);
  await refreezeScores(await requireReport(id, ctx));
  return listParticipants(id, ctx);
}

export async function createReport(
  ctx: AuthContext,
  companyId: string,
  input: {
    kind: string;
    title: string;
    state: string;
    categoryId?: string;
    departmentId?: string;
    locationId?: string;
    tagIds?: string[];
    severityId?: string;
    statusId?: string;
    reportDate?: string;
    occurredAt?: string;
    startedAt?: string;
    endedAt?: string;
    issueSummary?: string;
    issueDetail?: string;
    rootCause?: string;
    preventiveMeasures?: string;
    workSummary?: string;
    workDetail?: string;
    recurrenceOfId?: string;
    taskId?: string;
    /** Who is on it. Defaults to the author — see the insert below. */
    assigneeId?: string;
    targets?: JournalTargetInput[];
  },
): Promise<JournalEntry> {
  const targets = input.targets ?? [];
  assertMayFileAt(input.locationId ?? null, ctx);

  // Every report has a status. A report with none was a fourth kind of "not
  // started" alongside Open, Acknowledged and In progress, and nobody could say
  // what it meant. A **work log** is a record of work already done — it starts at
  // the resolved end and has no triage workflow; only an **issue** opens for triage.
  // (Task reports are work logs, so this covers them too.)
  const isWorkLog = input.kind === "work" || Boolean(input.taskId);

  // An issue may be reported after it happened, so the grace judges its occurred date;
  // a work log is judged by its report date. Filing an issue "now" is never blocked.
  const grace = graceDate(
    isWorkLog,
    input.reportDate ? new Date(input.reportDate) : new Date(),
    input.occurredAt ? new Date(input.occurredAt) : null,
  );
  if (grace) await assertWithinGrace(grace.date, ctx, grace.subject);

  const defaultStatus =
    input.statusId ?? (await firstStatusInGroup(isWorkLog ? "resolved" : "open"))?.id ?? null;
  await assertTargets(companyId, targets);
  if (input.taskId) await assertTaskIsMine(input.taskId, companyId, ctx);

  const fields: NewJournalEntry = {
    companyId,
    authorId: ctx.userId,
    kind: input.kind,
    state: input.state,
    title: input.title,
    categoryId: input.categoryId ?? null,
    departmentId: input.departmentId ?? null,
    locationId: input.locationId ?? null,
    severityId: input.severityId ?? null,
    statusId: defaultStatus,
    reportDate: input.reportDate ? new Date(input.reportDate) : new Date(),
    occurredAt: toDate(input.occurredAt) ?? null,
    startedAt: toDate(input.startedAt) ?? null,
    endedAt: toDate(input.endedAt) ?? null,
    issueSummary: input.issueSummary ?? null,
    issueDetail: input.issueDetail ?? null,
    rootCause: input.rootCause ?? null,
    preventiveMeasures: input.preventiveMeasures ?? null,
    workSummary: input.workSummary ?? null,
    workDetail: input.workDetail ?? null,
    recurrenceOfId: input.recurrenceOfId ?? null,
    taskId: input.taskId ?? null,
    // Whoever files it is on it, unless they said otherwise. The alternative — an
    // entry that belongs to nobody until its author opens a panel and picks their own
    // name — made every new entry ask a question whose answer was already known.
    assigneeId: input.assigneeId ?? ctx.userId,
    submittedAt: input.state === "submitted" ? new Date() : null,
  };
  const id = await insertReport(fields);
  if (targets.length > 0) await setTargets(id, targets);
  // The creation event — what starts the report's clock. Written for every report,
  // including one filed with no status at all: "entered no status at 09:14" is
  // still where the timeline begins, and without a first event the report reads as
  // never having existed rather than as never having moved.
  await insertStatusEvent({
    reportId: id,
    fromStatusId: null,
    toStatusId: fields.statusId ?? null,
    changedBy: ctx.userId,
  });
  if (input.tagIds?.length) await applyTags("report", id, fields.departmentId, input.tagIds);
  // The author is the first worker, so the points maths needs no special case for
  // them — they are simply a participant with an equal share until somebody says
  // otherwise.
  await addAuthorAsParticipant(id, ctx.userId);
  // Filing the entry is what completes the task — not the button that opened this
  // form. The two used to be separate steps, and anybody who walked away from the
  // half-filled form left a task marked done with no record of the work and no way
  // to add one. Now the task closes when there is something to close it with.
  if (fields.taskId) await completeLoggedTask(fields.taskId, id, ctx);
  return serialize(await requireReport(id, ctx), await targetsFor(id), await tagsFor("report", id));
}

/**
 * Close the task this entry logs, if it is still open. Idempotent by nature: a task
 * already done (or cancelled) is left exactly as it is, so a second entry against
 * the same task does not move a completion date somebody may be relying on.
 */
async function completeLoggedTask(
  taskId: string,
  reportId: string,
  ctx: AuthContext,
): Promise<void> {
  const task = await getTaskRow(taskId);
  if (!task || task.state === "done" || task.state === "cancelled") return;
  await updateTaskRow(taskId, { state: "done", completedAt: new Date() });
  await recordChanges(
    "tasks",
    taskId,
    { state: task.state },
    { state: "done", completedBy: reportId },
    ctx.userId,
    (err) => logger.warn({ err, taskId }, "Failed to record the task completion in its history"),
  );
}

/**
 * Only the author edits a report. Content is frozen once it has been appraised
 * (lockedAt) — the mark must not end up describing work that changed under it — so
 * an edit then is refused, and `reopen` is the deliberate, audited way back.
 */
/**
 * Who may edit an entry: **whoever holds it**.
 *
 * The author alone was wrong in both directions. After handing over, the person who
 * let go of the work could still rewrite it, and the person actually doing it could
 * not — so a handover moved the job without moving the ability to record it.
 *
 * With nobody holding it, the author may: an entry put down is still theirs to
 * correct, and the alternative is a record nobody can touch.
 *
 * Their work items, their score and their place on "who worked on it" are untouched by
 * this — letting go of an entry does not erase what you did on it.
 */
export function mayEdit(
  row: Pick<JournalEntryRowRaw, "authorId" | "assigneeId">,
  ctx: AuthContext,
): boolean {
  if (ctx.isSuperadmin) return true;
  return row.assigneeId ? row.assigneeId === ctx.userId : row.authorId === ctx.userId;
}

/** Whether a status ends the ticket — the `isTerminal` flag the workflow already has. */
async function isClosed(statusId: string | null): Promise<boolean> {
  if (!statusId) return false;
  const status = await getStatusRow(statusId);
  return Boolean(status?.isTerminal);
}

export async function updateReport(
  id: string,
  ctx: AuthContext,
  input: Record<string, unknown>,
): Promise<JournalEntry> {
  const row = await requireReport(id, ctx);
  if (!mayEdit(row, ctx)) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      row.assigneeId
        ? "This entry is held by somebody else. It can only be edited by whoever it is assigned to."
        : "Only the author can edit this entry",
    );
  }
  if (row.lockedAt) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This report has been appraised and is locked. Re-open it to make changes.",
    );
  }

  // Work cannot be logged against a closed ticket.
  //
  // The lock above is about *appraisal*; this is about the ticket being finished.
  // They are different moments — an entry is closed long before anyone scores it —
  // and a closed ticket that still accepts "what was done" is one whose record can be
  // rewritten after everybody has stopped looking. Re-open it if there is more to
  // say; that move is logged, which is the point.
  const touchesWork = input.workSummary !== undefined || input.workDetail !== undefined;
  if (touchesWork && (await isClosed(row.statusId))) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This entry is closed. Re-open it before logging any more work against it.",
    );
  }

  const patch: JournalEntryPatch = {};
  const assign = <K extends keyof JournalEntryPatch>(key: K, value: JournalEntryPatch[K]) => {
    if (value !== undefined) patch[key] = value;
  };
  assign("kind", input.kind as string | undefined);
  assign("title", input.title as string | undefined);
  assign("categoryId", input.categoryId as string | null | undefined);
  assign("departmentId", input.departmentId as string | null | undefined);
  if (input.locationId !== undefined) {
    assertMayFileAt(input.locationId as string | null, ctx);
    assign("locationId", input.locationId as string | null | undefined);
  }
  assign("severityId", input.severityId as string | null | undefined);
  assign("statusId", input.statusId as string | null | undefined);
  assign("issueSummary", input.issueSummary as string | null | undefined);
  assign("issueDetail", input.issueDetail as string | null | undefined);
  assign("rootCause", input.rootCause as string | null | undefined);
  assign("preventiveMeasures", input.preventiveMeasures as string | null | undefined);
  assign("workSummary", input.workSummary as string | null | undefined);
  assign("workDetail", input.workDetail as string | null | undefined);
  assign("recurrenceOfId", input.recurrenceOfId as string | null | undefined);
  if (input.reportDate !== undefined) patch.reportDate = new Date(input.reportDate as string);
  if (input.occurredAt !== undefined) patch.occurredAt = toDate(input.occurredAt as string | null);

  // Re-check the grace when the date it judges changes: an issue's occurred date, or a
  // work log's report date. The kind can change in the same edit, so read it from the patch.
  const nextKind = (input.kind as string | undefined) ?? row.kind;
  const isWorkLog = nextKind === "work" || Boolean(row.taskId);
  if (isWorkLog) {
    if (patch.reportDate) await assertWithinGrace(patch.reportDate, ctx, "This work is dated");
  } else if (input.occurredAt) {
    await assertWithinGrace(new Date(input.occurredAt as string), ctx, "This issue occurred");
  }
  if (input.startedAt !== undefined) patch.startedAt = toDate(input.startedAt as string | null);
  if (input.endedAt !== undefined) patch.endedAt = toDate(input.endedAt as string | null);

  // Submitting a draft stamps submittedAt once.
  if (input.state === "submitted" && row.state !== "submitted") {
    patch.state = "submitted";
    patch.submittedAt = new Date();
  } else if (input.state === "draft") {
    patch.state = "draft";
  }

  // Scope is replaced wholesale when present, and left alone when the key is absent —
  // so an edit that never mentions scope cannot silently clear it.
  if (input.targets !== undefined) {
    const targets = input.targets as JournalTargetInput[];
    await assertTargets(row.companyId, targets);
    await setTargets(id, targets);
  }

  // Tags are replaced wholesale when the key is present and left alone when it is
  // absent — the same rule as scope targets, so an edit that never mentions tags
  // cannot silently strip them.
  if (input.tagIds !== undefined) {
    await applyTags("report", id, patch.departmentId ?? row.departmentId, input.tagIds as string[]);
  }

  await updateReportRow(id, patch);
  // A status move is a transition worth recording. `in` the patch — not merely
  // different from undefined — because an edit that never mentions status must not
  // log one, and an edit that sets it to what it already was is not a transition.
  if ("statusId" in patch && patch.statusId !== row.statusId) {
    await insertStatusEvent({
      reportId: id,
      fromStatusId: row.statusId,
      toStatusId: patch.statusId ?? null,
      changedBy: ctx.userId,
    });
  }
  return serialize(await requireReport(id, ctx), await targetsFor(id), await tagsFor("report", id));
}

/** Re-open a locked report for editing. The author, or a manager above them. */
export async function reopenReport(id: string, ctx: AuthContext): Promise<JournalEntry> {
  const row = await requireReport(id, ctx);
  const isAuthor = row.authorId === ctx.userId;
  const isManager =
    can(ctx, PERMISSIONS.JOURNAL_UPDATE) && (await isAboveAuthor(ctx.userId, row.authorId));
  if (!isAuthor && !isManager && !ctx.isSuperadmin) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You cannot re-open this report");
  }
  // Re-opening a closed-period report re-opens its points for re-evaluation: flag it so it
  // may be re-scored despite the lock, and the badge shows a re-check is due.
  const locked = await isPeriodLocked(row.reportDate);
  await updateReportRow(id, { lockedAt: null, ...(locked ? { pointsReviewNeeded: true } : {}) });
  // Points are for finished work. A report back in progress has none until it is
  // resolved and scored again, so its scores and ledger rows are cleared now rather
  // than left to describe a state the report has left.
  await recordScoresCleared(id, ctx.userId, "reopened");
  await clearScores(id);
  await clearAwards(id);
  await notify({
    type: "journal.reopened",
    companyId: row.companyId,
    actorUserId: ctx.userId,
    subjectUserId: row.authorId,
    title: `Your entry was reopened: ${row.title}`,
    body: "Its points were cleared until it is finished and scored again.",
    link: `/journal/${id}`,
    entityKind: "journal",
    entityId: id,
  });
  return serialize(await requireReport(id, ctx), await targetsFor(id));
}

/** Whether the caller may reject a report — a superior of its author holding the grant. */
async function assertMayReject(
  row: JournalEntryRowRaw,
  ctx: AuthContext,
  verb: string,
): Promise<void> {
  const may =
    ctx.isSuperadmin ||
    (can(ctx, PERMISSIONS.JOURNAL_REJECT) && (await isAboveAuthor(ctx.userId, row.authorId)));
  if (!may) throw new AppError(403, ERROR_CODES.FORBIDDEN, `You cannot ${verb} this report`);
}

/**
 * Reject a report — a head-of-department striking an entry filed by their downline. It
 * clears any scores and ledger awards so the entry counts for no points, and records who
 * rejected it and why. Idempotent-ish: rejecting an already-rejected report just refreshes
 * the reason. Un-reject with `unrejectReport` to let it be scored again.
 */
export async function rejectReport(
  id: string,
  ctx: AuthContext,
  reason: string | null,
): Promise<JournalEntry> {
  const row = await requireReport(id, ctx);
  await assertMayReject(row, ctx, "reject");
  await assertPointsUnlocked(row, ctx);
  await updateReportRow(id, {
    rejectedAt: new Date(),
    rejectedById: ctx.userId,
    rejectionReason: reason,
  });
  await recordScoresCleared(id, ctx.userId, "rejected");
  await clearScores(id);
  await clearAwards(id);
  await notify({
    type: "journal.rejected",
    companyId: row.companyId,
    actorUserId: ctx.userId,
    subjectUserId: row.authorId,
    title: `Your entry was rejected: ${row.title}`,
    body: reason ?? "",
    link: `/journal/${id}`,
    entityKind: "journal",
    entityId: id,
  });
  return serialize(await requireReport(id, ctx), await targetsFor(id));
}

/** Lift a rejection, so the report may be scored again (points return only when re-scored). */
export async function unrejectReport(id: string, ctx: AuthContext): Promise<JournalEntry> {
  const row = await requireReport(id, ctx);
  await assertMayReject(row, ctx, "un-reject");
  await updateReportRow(id, { rejectedAt: null, rejectedById: null, rejectionReason: null });
  return serialize(await requireReport(id, ctx), await targetsFor(id));
}

export async function deleteReport(id: string, ctx: AuthContext): Promise<void> {
  // `requireReport` already 404s an entry the caller cannot see, so holding
  // journal:delete never widens *which* entries are reachable — only what may be
  // done to the ones that already are.
  const row = await requireReport(id, ctx);
  // Your own entry is always yours. Beyond that it takes journal:delete, which is
  // what the roles matrix has been promising all along: the permission was seeded
  // onto Journal admin and read by nothing, so an administrator who granted it got
  // no more than they started with, and an entry filed in error — or holding
  // something that should never have been typed — could only be removed by its
  // author or a superadmin.
  const own = row.authorId === ctx.userId;
  if (!own && !ctx.isSuperadmin && !can(ctx, PERMISSIONS.JOURNAL_DELETE)) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "Only the author, or someone who may delete journal entries, can delete this",
    );
  }
  // Scores, points, scope and downtime all cascade on the foreign key. Files do
  // not: the owner link is polymorphic, so there is no key to cascade, and the bytes
  // live outside the database entirely. Take them out by hand, or every deleted
  // report leaves its photos paid for and unreachable.
  await removeAttachmentsFor("report", id);
  // taggables has no FK to the owner (it is polymorphic), so the links must be
  // cleared explicitly or they outlive the record they described.
  await clearTags("report", id);
  // Comments are polymorphic and carry no FK to the report, so they must be
  // removed explicitly or they outlive the record they were about.
  await deleteCommentsFor("report", id);
  await deleteReportRow(id);
}

async function isAboveAuthor(viewerId: string, authorId: string): Promise<boolean> {
  const above = await ancestorsOf(authorId);
  return above.some((a) => a.userId === viewerId);
}

/* --------------------------------- scoring --------------------------------- */

/** The rater's level: 0 if they are the author, else how far above; null when they
 * are not in the author's chain at all (so may not score). */
async function levelOf(authorId: string, raterId: string): Promise<number | null> {
  if (raterId === authorId) return 0;
  const above = await ancestorsOf(authorId);
  return above.find((a) => a.userId === raterId)?.depth ?? null;
}

/** A report's scoring grid, as this viewer may see it (self for all; the review and
 *  official figure only for someone above the author). */
export async function getScores(id: string, ctx: AuthContext): Promise<JournalScore[]> {
  const row = await requireReport(id, ctx);
  await assertVisible(row, ctx);
  const [participants, scores] = await Promise.all([participantsFor(id), scoresFor(id)]);
  const canSeeReview = ctx.isSuperadmin || (await isAboveAuthor(ctx.userId, row.authorId));
  return buildScoreGrid(participants, scores, canSeeReview);
}

/**
 * The points-change history for a report. Exposes the review tier, so it follows the same
 * blind-upward rule as the grid: only someone above the author (or a superadmin) may read
 * it — everyone else is refused rather than shown a filtered list.
 */
export async function getScoreEvents(id: string, ctx: AuthContext): Promise<ScoreEvent[]> {
  const row = await requireReport(id, ctx);
  await assertVisible(row, ctx);
  if (!ctx.isSuperadmin && !(await isAboveAuthor(ctx.userId, row.authorId))) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You cannot see this report's points history");
  }
  const events = await scoreEventsFor(id);
  return events.map((e) => ({
    id: e.id,
    subjectName: e.subjectName,
    tier: e.tier === "review" ? "review" : "self",
    raterName: e.raterName,
    oldPoints: e.oldPoints,
    newPoints: e.newPoints,
    reason: SCORE_EVENT_REASONS.includes(e.reason as ScoreEvent["reason"])
      ? (e.reason as ScoreEvent["reason"])
      : "score",
    createdAt: e.createdAt.toISOString(),
  }));
}

/** The tier the caller may write, or null if none — the non-throwing form of
 *  `tierFor`, for telling the browser whether to offer a scoring column. Once a
 *  review exists the author's self split is locked, so they get null too. */
async function writableTier(
  row: JournalEntryRowRaw,
  ctx: AuthContext,
  hasReview: boolean,
): Promise<ScoreTier | null> {
  const level = await levelOf(row.authorId, ctx.userId);
  if (level === 0) return hasReview ? null : "self";
  if (level !== null && level > 0) return can(ctx, PERMISSIONS.JOURNAL_APPRAISE) ? "review" : null;
  if (ctx.isSuperadmin) return "review";
  return null;
}

/** Which tier the caller writes, from who they are — or a 403 if they cannot score
 *  this report at all. The author writes `self`; a manager above writes `review`. */
async function tierFor(row: JournalEntryRowRaw, ctx: AuthContext): Promise<ScoreTier> {
  const level = await levelOf(row.authorId, ctx.userId);
  if (level === null && !ctx.isSuperadmin) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You are not above this report's author");
  }
  // The author (level 0) sets the self split; anyone above sets the review, which
  // needs the grant. A superadmin standing outside the line reviews.
  if (level === 0) return "self";
  if (!can(ctx, PERMISSIONS.JOURNAL_APPRAISE)) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You may not review other people's reports");
  }
  return "review";
}

/**
 * Score a resolved report.
 *
 * The tier is not in the request — it follows from who the caller is (`tierFor`):
 * the author writes the self split, a manager above writes the review. Everyone
 * scored must already be on the report. Scoring re-freezes the ledger and, on the
 * first score, locks the content so a figure cannot end up describing work that
 * then changed.
 */
export async function setScores(
  id: string,
  ctx: AuthContext,
  input: { scores: { userId: string; points: number }[] },
): Promise<JournalScore[]> {
  const row = await requireReport(id, ctx);
  if (row.state !== "submitted") {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "A draft cannot be scored");
  }
  if (row.rejectedAt) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "This report was rejected and cannot be scored",
    );
  }
  await assertPointsUnlocked(row, ctx);

  // Points are for finished work: a report still in progress has not finished being
  // done. The terminal group covers every way a report concludes, not only
  // "Resolved" — checking something that turned out to be nothing was still work.
  const status = row.statusId ? await getStatusRow(row.statusId) : null;
  if (!status?.isTerminal) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "This report is not finished yet. Mark it resolved (or closed another way) before scoring it.",
    );
  }

  const tier = await tierFor(row, ctx);

  // One report is worth at most MAX_ENTRY_POINTS, shared out — the whole tier may
  // total no more than that. Adding a name divides the ten; it never mints more.
  const total = input.scores.reduce((sum, s) => sum + s.points, 0);
  if (total > MAX_ENTRY_POINTS) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `One report is worth at most ${MAX_ENTRY_POINTS} points across everyone who worked it. This adds up to ${total}.`,
    );
  }

  const existing = await scoresFor(id);

  // Only people on the report can be scored — the grid is built from its members.
  const members = new Set((await participantsFor(id)).map((p) => p.userId));
  const stranger = input.scores.find((s) => !members.has(s.userId));
  if (stranger) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Only people who worked on the report can be scored — add them first.",
    );
  }

  // Once a manager has reviewed, the author's self split is fixed — changing it after
  // the fact, when the review already stands on it, would be a way to move the numbers
  // out from under the person who signed off. Re-opening the report is the manager's
  // to do, and it clears the review so the split is honestly open again.
  if (tier === "self" && existing.some((s) => s.tier === "review")) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This report has been reviewed, so the split is locked. Ask your manager to re-open it to change the points.",
    );
  }

  await replaceTier(id, tier, ctx.userId, input.scores);
  await recordScoreEvents(
    id,
    tier,
    existing.filter((s) => s.tier === tier),
    input.scores,
    ctx.userId,
    "score",
  );
  // First score locks the content. A review is the re-evaluation, so writing one settles a
  // pending re-check (the self split alone does not — the manager still has to sign off).
  const settlesReview = tier === "review" && row.pointsReviewNeeded;
  if (!row.lockedAt || settlesReview) {
    await updateReportRow(id, {
      ...(row.lockedAt ? {} : { lockedAt: new Date() }),
      ...(settlesReview ? { pointsReviewNeeded: false } : {}),
    });
  }
  await refreezeScores(await requireReport(id, ctx));

  // Only a review. The self split is the author's own arithmetic — telling them
  // what they just typed is noise, and it is the manager signing off that changes
  // what anybody's points are worth.
  if (tier === "review") {
    await notify({
      type: "journal.scored",
      companyId: row.companyId,
      actorUserId: ctx.userId,
      subjectUserId: row.authorId,
      title: `Your entry was appraised: ${row.title}`,
      body: "A reviewer scored it, so its points are settled.",
      link: `/journal/${id}`,
      entityKind: "journal",
      entityId: id,
    });
  }

  return getScores(id, ctx);
}

/** Drop score rows for anyone no longer on the participant list, recording each removal. */
async function pruneScoresToParticipants(id: string, raterId: string): Promise<void> {
  const members = (await participantsFor(id)).map((p) => p.userId);
  const before = await scoresFor(id);
  await pruneScores(id, members);
  const keep = new Set(members);
  for (const tier of ["self", "review"] as const) {
    const dropped = before.filter((s) => s.tier === tier && !keep.has(s.subjectUserId));
    if (dropped.length > 0) await recordScoreEvents(id, tier, dropped, [], raterId, "removed");
  }
}

/**
 * Recompute and freeze a report's points from its scores.
 *
 * Each worker's **official** points are the review if a manager entered one, else
 * their self number. That figure is credited to them (direct); every manager above
 * them earns a decaying share of it up the whole reporting line (rollup,
 * `rollupFactor ^ depth`) — so a manager earns from their downline team, and their
 * own manager earns a smaller slice above that.
 *
 * Every stored figure is rounded to the nearest 0.5. A manager's rollup is summed
 * across their whole downline **before** rounding, so their credit lands on the
 * half-point grid once rather than each fragment being rounded and drifting.
 *
 * Frozen with the weightage as it is now; a later change never rewrites it, and
 * re-opening the report clears these rows outright.
 */
async function refreezeScores(row: JournalEntryRowRaw): Promise<void> {
  const meta = {
    companyId: row.companyId,
    earnedOn: row.reportDate.toISOString().slice(0, 10),
    departmentId: row.departmentId,
  };
  const scores = await scoresFor(row.id);
  if (scores.length === 0) {
    await replaceAwards(row.id, meta, []);
    return;
  }
  const settings = await getSystemSetting(APPRAISAL_SETTINGS);

  const selfOf = new Map<string, number>();
  const reviewOf = new Map<string, number>();
  for (const s of scores) {
    (s.tier === "self" ? selfOf : reviewOf).set(s.subjectUserId, s.points);
  }

  // Official per worker: the review if there is one, else the self number.
  const official = new Map<string, number>();
  for (const userId of new Set([...selfOf.keys(), ...reviewOf.keys()])) {
    official.set(userId, reviewOf.get(userId) ?? selfOf.get(userId) ?? 0);
  }

  const awards: AwardInput[] = [];
  // Rollup is accumulated per manager and rounded once at the end.
  const rollup = new Map<string, { depth: number; points: number }>();
  for (const [userId, points] of official) {
    if (points <= 0) continue;
    awards.push({
      beneficiaryUserId: userId,
      reportId: row.id,
      kind: "direct",
      depth: 0,
      points: toHalfStep(points),
    });
    for (const ancestor of await ancestorsOf(userId)) {
      const add = points * settings.rollupFactor ** ancestor.depth;
      const seen = rollup.get(ancestor.userId);
      rollup.set(ancestor.userId, {
        // Keep the closest depth for display when a manager sits above by two paths.
        depth: seen ? Math.min(seen.depth, ancestor.depth) : ancestor.depth,
        points: (seen?.points ?? 0) + add,
      });
    }
  }
  for (const [userId, { depth, points }] of rollup) {
    const rounded = toHalfStep(points);
    if (rounded > 0) {
      awards.push({
        beneficiaryUserId: userId,
        reportId: row.id,
        kind: "rollup",
        depth,
        points: rounded,
      });
    }
  }
  await replaceAwards(row.id, meta, awards);
}

/** The caller's own entries still waiting on somebody above them. */
export async function awaitingReview(ctx: AuthContext): Promise<AwaitingReview[]> {
  return awaitingReviewFor(ctx.userId);
}

export async function pendingAppraisals(ctx: AuthContext): Promise<PendingAppraisal[]> {
  const rows = await pendingFor(ctx.userId);
  return rows.map((row) => ({
    reportId: row.reportId,
    title: row.title,
    kind: row.kind,
    authorId: row.authorId,
    authorName: row.authorName,
    severityName: row.severityName,
    submittedAt: iso(row.submittedAt),
    depth: row.depth,
  }));
}

export async function myPoints(ctx: AuthContext): Promise<PointsSummary> {
  const { own, rollup } = await pointsFor(ctx.userId);
  const round = (n: number) => Math.round(n * 100) / 100;
  return { own: round(own), rollup: round(rollup), total: round(own + rollup) };
}

// --- the work timeline -------------------------------------------------------

/**
 * Who may add work to an entry: the people who worked it.
 *
 * Participants rather than the holder alone, because "I log the work along with my
 * colleagues" is the ordinary case — two people on one job, each recording what they
 * did. The holder is always among them (the author is added on filing, and a handover
 * does not remove anybody), so this widens the list without letting a stranger write
 * on somebody else's entry.
 */
async function assertMayLogWork(row: JournalEntryRowRaw, ctx: AuthContext): Promise<void> {
  if (ctx.isSuperadmin) return;
  const workers = await participantsFor(row.id);
  const isWorker = workers.some((w) => w.userId === ctx.userId);
  if (!isWorker && row.assigneeId !== ctx.userId && row.authorId !== ctx.userId) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "Only somebody who worked this entry can log work against it",
    );
  }
}

/** Closed entries take no more work — the same rule the editor enforces. */
async function assertOpenForWork(row: JournalEntryRowRaw): Promise<void> {
  if (row.lockedAt) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This entry has been appraised and is locked. Re-open it to change anything.",
    );
  }
  if (await isClosed(row.statusId)) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This entry is closed. Re-open it before logging any more work against it.",
    );
  }
}

function serializeWorkLog(row: WorkLogRow, ctx: AuthContext): WorkLog {
  return {
    id: row.id,
    reportId: row.reportId,
    userId: row.userId,
    userName: row.userName,
    summary: row.summary,
    detail: row.detail,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    // Your own account of what you did is yours to correct; somebody else's is not
    // yours to rewrite.
    canEdit: ctx.isSuperadmin || row.userId === ctx.userId,
  };
}

export async function listWorkLogs(id: string, ctx: AuthContext): Promise<WorkLog[]> {
  const row = await requireReport(id, ctx);
  await assertVisible(row, ctx);
  return (await workLogsFor(id)).map((log) => serializeWorkLog(log, ctx));
}

export async function addWorkLog(
  id: string,
  input: CreateWorkLog,
  ctx: AuthContext,
): Promise<WorkLog> {
  const row = await requireReport(id, ctx);
  await assertVisible(row, ctx);
  await assertMayLogWork(row, ctx);
  await assertOpenForWork(row);

  const logId = await insertWorkLog({
    reportId: id,
    userId: ctx.userId,
    summary: input.summary.trim(),
    detail: input.detail?.trim() || null,
    startedAt: input.startedAt ? new Date(input.startedAt) : null,
    finishedAt: input.finishedAt ? new Date(input.finishedAt) : null,
  });
  await refreshWorkRollup(id);

  // Logging work is being on the job, so it puts you on the list of who worked it —
  // otherwise a colleague's item would exist while the points split says they were
  // never there.
  await addAuthorAsParticipant(id, ctx.userId);

  const created = await getWorkLog(logId);
  return serializeWorkLog(created!, ctx);
}

export async function updateWorkLog(
  logId: string,
  input: UpdateWorkLog,
  ctx: AuthContext,
): Promise<WorkLog> {
  const log = await getWorkLog(logId);
  if (!log) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Work log not found");

  const row = await requireReport(log.reportId, ctx);
  await assertVisible(row, ctx);
  await assertOpenForWork(row);
  if (!ctx.isSuperadmin && log.userId !== ctx.userId) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You can only edit your own work");
  }

  await updateWorkLogRow(logId, {
    summary: input.summary.trim(),
    detail: input.detail?.trim() || null,
    startedAt: input.startedAt ? new Date(input.startedAt) : null,
    finishedAt: input.finishedAt ? new Date(input.finishedAt) : null,
  });
  await refreshWorkRollup(log.reportId);
  return serializeWorkLog((await getWorkLog(logId))!, ctx);
}

export async function removeWorkLog(logId: string, ctx: AuthContext): Promise<void> {
  const log = await getWorkLog(logId);
  if (!log) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Work log not found");

  const row = await requireReport(log.reportId, ctx);
  await assertVisible(row, ctx);
  await assertOpenForWork(row);
  if (!ctx.isSuperadmin && log.userId !== ctx.userId) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You can only remove your own work");
  }

  await deleteWorkLogRow(logId);
  await refreshWorkRollup(log.reportId);
}
