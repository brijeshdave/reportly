// Author: Brijesh Dave <https://github.com/brijeshdave>
// The report — the record of a piece of work, or an issue/breakdown. Everyone
// files these; the people above them in the reporting line score them.
//
// Two kinds, so "not everything is an issue" is handled: an **issue** carries a
// severity, root cause, preventive measures and the status workflow; a **work**
// log is routine daily work with none of that. A report is a **draft** (only its
// author sees it) until **submitted**, when it enters the downline and can be
// appraised. Once appraised its content **locks**, so a mark is never left standing
// against work that changed underneath it.
import { z } from "zod";

import { nameSchema, timestampsSchema, uuidSchema } from "@/entities/common.js";
import { reportTargetInputSchema, journalTargetSchema } from "@/entities/report-scope.js";

export const REPORT_KINDS = ["issue", "work"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const reportKindSchema = z.enum(REPORT_KINDS);

export const REPORT_STATES = ["draft", "submitted"] as const;

/**
 * Whose entries a listing is asking about, by the reporting line.
 *
 * A manager's default question is "what did my team file?", and the journal could
 * only answer "everyone I may see" — which for a head of department is the whole
 * nested organisation, and for anybody else is themselves. The levels are the
 * reporting depth, because "my team" means the people who report to me and
 * sometimes the people who report to them.
 *
 * `all` is not "everybody in the company": it is the caller's existing visibility,
 * unnarrowed. Nothing here can widen what somebody may see.
 */
export const JOURNAL_TEAM_SCOPES = ["me", "direct", "two-levels", "downline", "all"] as const;
export type JournalTeamScope = (typeof JOURNAL_TEAM_SCOPES)[number];

/** How deep each scope reaches, or null for "no narrowing". */
export const TEAM_SCOPE_DEPTH: Record<JournalTeamScope, number | null> = {
  me: 0,
  direct: 1,
  "two-levels": 2,
  downline: Number.POSITIVE_INFINITY,
  all: null,
};
export type ReportState = (typeof REPORT_STATES)[number];
export const reportStateSchema = z.enum(REPORT_STATES);

/** A short free-text note; the long fields are unbounded-ish but sane. */
const shortText = z.string().trim().max(2000);
const longText = z.string().trim().max(20000);

export const journalEntrySchema = z
  .object({
    id: uuidSchema,
    companyId: uuidSchema,
    authorId: z.string(),
    authorName: nameSchema,
    kind: reportKindSchema,
    state: reportStateSchema,
    title: nameSchema,

    categoryId: uuidSchema.nullable(),
    categoryName: z.string().nullable(),
    departmentId: uuidSchema.nullable(),
    departmentName: z.string().nullable(),
    /** Where the work happened. Nullable because reports filed before locations
     *  existed have none; the editor requires it for new ones. */
    locationId: uuidSchema.nullable(),
    locationName: z.string().nullable(),
    /** Who holds it now. Null = nobody has picked it up. Distinct from the author,
     *  who filed it and never changes. */
    assigneeId: z.string().nullable(),
    assigneeName: nameSchema.nullable(),

    /** Free labels for finding this later. Multi-select and department-scoped —
     *  unlike `categoryId`, which is the single "what kind of problem is it". */
    tags: z.array(z.object({ id: uuidSchema, name: nameSchema, color: z.string() })).default([]),

    // Issue-only, and optional even here.
    severityId: uuidSchema.nullable(),
    severityName: z.string().nullable(),
    statusId: uuidSchema.nullable(),
    statusName: z.string().nullable(),
    statusGroup: z.string().nullable(),
    /**
     * Whether the status ends the ticket. Sent as well as the group because a
     * workflow may have several terminal statuses in different groups, and "closed"
     * is the flag the workflow itself keeps rather than a name to match on.
     */
    statusIsTerminal: z.boolean(),

    reportDate: z.string(),
    /** When an issue actually happened (may predate the report). */
    occurredAt: z.string().datetime().nullable(),

    // Work time — how long the *person* spent. Downtime (the *asset* being down) is
    // a separate thing, arriving in a later step.
    startedAt: z.string().datetime().nullable(),
    endedAt: z.string().datetime().nullable(),
    /** endedAt − startedAt, in minutes; null until both are set. */
    durationMinutes: z.number().nullable(),

    issueSummary: z.string().nullable(),
    issueDetail: z.string().nullable(),
    rootCause: z.string().nullable(),
    preventiveMeasures: z.string().nullable(),
    workSummary: z.string().nullable(),
    workDetail: z.string().nullable(),

    /** "Same problem as report X" — feeds repeated-issue analysis. */
    recurrenceOfId: uuidSchema.nullable(),

    /** The task this work was logged against, when it came from one. */
    taskId: uuidSchema.nullable(),
    taskTitle: z.string().nullable(),

    /** What this report is about — any mix of assets, devices, users, departments. */
    targets: z.array(journalTargetSchema),

    /** Set when first appraised; content edits are refused while it stands. */
    lockedAt: z.string().datetime().nullable(),
    submittedAt: z.string().datetime().nullable(),

    /** Struck from scoring by a head-of-department: when, by whom, and why. While set,
     *  the entry has no points and cannot be scored. Null when not rejected. */
    rejectedAt: z.string().datetime().nullable(),
    rejectedById: z.string().nullable(),
    rejectedByName: z.string().nullable(),
    rejectionReason: z.string().nullable(),

    /** The status changed while points were locked — they need re-evaluating, and may be
     *  re-scored despite the lock until they are. */
    pointsReviewNeeded: z.boolean(),
  })
  .merge(timestampsSchema);

export type JournalEntry = z.infer<typeof journalEntrySchema>;

/** The reason a head-of-department gives when rejecting an entry (optional). */
export const rejectReportSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});
export type RejectReport = z.infer<typeof rejectReportSchema>;

/** Why a points change happened, in the points-history tab. */
export const SCORE_EVENT_REASONS = [
  "score",
  "reopened",
  "rejected",
  "removed",
  "status-change",
] as const;
export type ScoreEventReason = (typeof SCORE_EVENT_REASONS)[number];

/** One recorded points change: who moved whose points, in which tier, from what to what. */
export const scoreEventSchema = z.object({
  id: z.string(),
  subjectName: z.string().nullable(),
  tier: z.enum(["self", "review"]),
  raterName: z.string().nullable(),
  /** Null when there was no prior value (first score) or the row was cleared to nothing. */
  oldPoints: z.number().nullable(),
  newPoints: z.number().nullable(),
  reason: z.enum(SCORE_EVENT_REASONS),
  createdAt: z.string().datetime(),
});
export type ScoreEvent = z.infer<typeof scoreEventSchema>;

/** A report as listed — the heavy long-text fields and scope dropped for the table. */
export const journalEntryRowSchema = journalEntrySchema.omit({
  issueDetail: true,
  workDetail: true,
  rootCause: true,
  preventiveMeasures: true,
  targets: true,
});
export type JournalEntryRow = z.infer<typeof journalEntryRowSchema>;

export const createJournalEntrySchema = z
  .object({
    kind: reportKindSchema,
    title: nameSchema,
    /** Draft keeps it private; submitted enters the appraisal loop. */
    state: reportStateSchema.default("draft"),

    categoryId: uuidSchema.optional(),
    departmentId: uuidSchema.optional(),
    locationId: uuidSchema.optional(),
    tagIds: z.array(uuidSchema).optional(),
    severityId: uuidSchema.optional(),
    statusId: uuidSchema.optional(),

    reportDate: z.string().optional(),
    occurredAt: z.string().datetime().optional(),
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),

    issueSummary: shortText.optional(),
    issueDetail: longText.optional(),
    rootCause: longText.optional(),
    preventiveMeasures: longText.optional(),
    workSummary: shortText.optional(),
    workDetail: longText.optional(),

    recurrenceOfId: uuidSchema.optional(),

    /** Set when the report is logged against a task; the server checks it is yours. */
    taskId: uuidSchema.optional(),

    /** What the report is about; omit or leave empty for work tied to nothing. */
    targets: z.array(reportTargetInputSchema).optional(),
  })
  .refine((value) => !(value.startedAt && value.endedAt) || value.endedAt >= value.startedAt, {
    message: "The end time cannot be before the start time",
    path: ["endedAt"],
  });

export type CreateJournalEntry = z.infer<typeof createJournalEntrySchema>;

// Everything a create takes may be edited, plus the state (to submit a draft).
// The server refuses edits to a locked report beyond re-opening it.
export const updateJournalEntrySchema = z.object({
  title: nameSchema.optional(),
  state: reportStateSchema.optional(),
  categoryId: uuidSchema.nullable().optional(),
  departmentId: uuidSchema.nullable().optional(),
  locationId: uuidSchema.nullable().optional(),
  /** Omit to leave tags untouched; send [] to clear them. Same rule as scope
   *  targets — an edit that never mentions tags must not silently drop them. */
  tagIds: z.array(uuidSchema).optional(),
  severityId: uuidSchema.nullable().optional(),
  statusId: uuidSchema.nullable().optional(),
  reportDate: z.string().optional(),
  occurredAt: z.string().datetime().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  endedAt: z.string().datetime().nullable().optional(),
  issueSummary: shortText.nullable().optional(),
  issueDetail: longText.nullable().optional(),
  rootCause: longText.nullable().optional(),
  preventiveMeasures: longText.nullable().optional(),
  workSummary: shortText.nullable().optional(),
  workDetail: longText.nullable().optional(),
  recurrenceOfId: uuidSchema.nullable().optional(),
  /** Replaces the whole scope set when present; omit to leave scope untouched. */
  targets: z.array(reportTargetInputSchema).optional(),
});
export type UpdateJournalEntry = z.infer<typeof updateJournalEntrySchema>;

/**
 * Moving a report along its workflow — its own operation, not a field on the edit
 * form. Keeping a status current is the thing people do most often, and routing it
 * through an edit form is enough friction that statuses stop being kept up to date.
 *
 * `null` clears the status, for a report that should not be in the workflow at all.
 */
export const changeStatusSchema = z.object({ statusId: uuidSchema.nullable() });
export type ChangeStatus = z.infer<typeof changeStatusSchema>;
