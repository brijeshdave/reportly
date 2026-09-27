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
export const JOURNAL_TEAM_SCOPES = [
  "me",
  "direct",
  "two-levels",
  "downline",
  "others",
  "all",
] as const;
export type JournalTeamScope = (typeof JOURNAL_TEAM_SCOPES)[number];

/**
 * How deep each scope reaches, or null for "no narrowing".
 *
 * `others` is absent on purpose: it is everyone the reader may see **except**
 * themselves and their direct team, which is a complement rather than a depth.
 * Giving it a number here would be a lie the resolver then has to work around, so
 * it has a branch of its own instead — see `EXCLUDING_SCOPES`.
 */
export const TEAM_SCOPE_DEPTH: Record<JournalTeamScope, number | null> = {
  me: 0,
  direct: 1,
  "two-levels": 2,
  downline: Number.POSITIVE_INFINITY,
  others: null,
  all: null,
};

/**
 * Scopes that subtract a depth instead of keeping one.
 *
 * Asked for from use: "in journal filter i need one more filter option under
 * whose, for seeing all other except my direct team" — a head of department
 * reading everything that is *not* their own immediate team. Like every other
 * scope it can only ever narrow: it starts from what the reader may already see.
 */
export const EXCLUDING_SCOPES: Partial<Record<JournalTeamScope, number>> = {
  others: 1,
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
    /**
     * Whether a manager has reviewed it.
     *
     * Not the review's number — scoring stays blind upward — only whether it has
     * happened, which is a fact the author is entitled to and previously had to
     * open every entry to learn.
     */
    reviewed: z.boolean().default(false),

    /**
     * Where the entry stands with its reviewer, in three states rather than two.
     *
     * Reported from use: "in journal table it shows Waiting for all entries which
     * are not reviewd but it should only show waiting for those are ready for it.
     * Currently any open or rejected are also showing waiting and it is misleading
     * for managers."
     *
     * `waiting` is exactly what a reviewer can act on today — the same three
     * conditions `setScores` refuses without: submitted, not rejected, and in the
     * resolved group. Everything else is `not_ready`: still being worked, or
     * finished in a way that earns nothing (cancelled, duplicate, not an issue), or
     * struck out. Calling those "waiting" put work in a manager's queue that the
     * server would have refused to score.
     */
    reviewState: z.enum(["reviewed", "waiting", "not_ready"]).default("not_ready"),

    /**
     * What the entry has been scored, as totals across everybody on it.
     *
     * `selfPoints` is the author's split and is shown to anybody who may read the
     * entry. `reviewPoints` is the management review and is **blind upward** — it
     * arrives null unless the reader is strictly above the author, or a
     * superadmin, which is the same rule the scoring grid enforces on the detail
     * page. The list must not be the hole in it, so the server withholds the
     * number rather than the table hiding a number it was sent.
     *
     * Null means "not scored", not "scored nothing" — a nought is a real answer
     * and has to be distinguishable from an absent one.
     */
    selfPoints: z.number().nullable().default(null),
    reviewPoints: z.number().nullable().default(null),

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

/**
 * What a **submitted issue** must say.
 *
 * Reported from use: entries were arriving with a title and nothing else — no
 * severity to score them against, no description of what happened, and no date for
 * when it did. A report nobody can read is not a record, and one with no severity is
 * scored against whatever fallback happens to be configured.
 *
 * Three deliberate exemptions:
 *
 *   - a **draft** is for something unfinished, and nagging somebody halfway through
 *     writing is how people learn to file everything in one go at the end;
 *   - a **work log** is a different shape — "nothing broke here, this is what I did"
 *     — and has no severity, no occurrence and no issue description to give;
 *   - **`statusId`** is not demanded, though the form marks it required. The server
 *     defaults an issue to the first status in the *open* group, so an absent status
 *     cannot break the rule that matters (`assertOpenStatusOnCreate`), and demanding
 *     one would refuse callers over a value the API itself supplies.
 *
 * Shared because the browser checks it before the network and the route checks it
 * after: the same function, so neither can drift into accepting what the other
 * refuses.
 */
function issueMustBeComplete(
  value: {
    kind: string;
    state?: string;
    severityId?: string;
    issueSummary?: string;
    issueDetail?: string;
    occurredAt?: string;
    locationId?: string;
    workSummary?: string;
    workDetail?: string;
    startedAt?: string;
    endedAt?: string;
  },
  ctx: z.RefinementCtx,
): void {
  // Where it happened, whatever kind it is.
  //
  // Asked for as "in journal create site is also mendatory", and then widened to
  // every kind of entry. A site is what the reports, the rota and the whole access
  // model hang off — an entry with none belongs to nobody's plant and drops out of
  // every per-site figure. A draft is exempt, like everything else here.
  if (value.state === "submitted" && !(value.locationId ?? "").trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["locationId"],
      message: "Choose the site this belongs to.",
    });
  }

  if (value.kind !== "issue" || value.state !== "submitted") return;
  workDoneMustBeComplete(value, ctx);

  const required: [keyof typeof value, string][] = [
    ["severityId", "Choose a severity — it decides what the entry is worth."],
    ["issueSummary", "Say what happened, in a line."],
    ["issueDetail", "Describe what happened — the detail is what makes this readable later."],
    ["occurredAt", "Say when it happened."],
  ];
  for (const [key, message] of required) {
    const given = value[key];
    if (typeof given === "string" && given.trim() !== "") continue;
    ctx.addIssue({ code: "custom", path: [key], message });
  }

  // An issue that has not happened yet cannot be reported as having happened. Worth
  // checking because `datetime-local` makes next year as easy to type as today, and a
  // future occurrence silently breaks every report that buckets by date.
  if (value.occurredAt && new Date(value.occurredAt).getTime() > Date.now() + 60_000) {
    ctx.addIssue({
      code: "custom",
      path: ["occurredAt"],
      message: "That is in the future — say when it actually happened.",
    });
  }
}

/**
 * Work described on the filing form is a work log, so it is held to a work log's rules.
 *
 * The server turns these fields into the first item of the entry's timeline, and an
 * item with no detail and no hours is exactly what the timeline replaced. Filing the
 * work and logging it afterwards must not produce records of different quality — the
 * reports cannot tell which door an item came through.
 */
function workDoneMustBeComplete(
  value: { workSummary?: string; workDetail?: string; startedAt?: string; endedAt?: string },
  ctx: z.RefinementCtx,
): void {
  // Nothing claimed, nothing to check: work is still allowed to be logged later.
  if (!value.workSummary || value.workSummary.trim() === "") return;

  const required: [keyof typeof value, string][] = [
    ["workDetail", "Describe what you did — this is the record somebody reads later."],
    ["startedAt", "Say when you started."],
    ["endedAt", "Say when you finished."],
  ];
  for (const [key, message] of required) {
    const given = value[key];
    if (typeof given === "string" && given.trim() !== "") continue;
    ctx.addIssue({ code: "custom", path: [key], message });
  }
}

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
    // `rootCause` / `preventiveMeasures` are deliberately absent. They belong to
    // closing an issue, not to raising one: filled in before anybody has looked at
    // the machine they are a guess, and a guess written into the record reads later
    // as a finding. They are asked for at the point of resolving — see
    // `resolveJournalEntrySchema`.
    /**
     * Work already done at the moment of filing. **Not** the entry's roll-up
     * columns, despite the names: the server turns these into the first item of the
     * entry's work timeline (`journal_work_logs`), attributed to whoever filed it
     * and timed from `startedAt`/`endedAt`. Everything afterwards is logged against
     * the entry itself, because one job worked over two shifts is several items and
     * a filing form cannot hold that.
     */
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
  })
  .superRefine(issueMustBeComplete);

export type CreateJournalEntry = z.infer<typeof createJournalEntrySchema>;

/**
 * The message an installation that demands work on an issue refuses with.
 *
 * One string, because the browser raises it before the request and the server raises
 * it after: two wordings for one rule reads as two different rules.
 */
export const WORK_ON_ISSUE_REQUIRED =
  "Say what was done about it before submitting — work done is required on this installation.";

/**
 * The create schema this installation is actually running.
 *
 * `requireWorkOnIssue` is a stored setting, so it cannot live in a static schema —
 * but a form that cannot see the rule it is about to break can only discover it on
 * save, which is what happened: the refusal arrived as a sentence above a Work done
 * section with no mark on it at all. The editor already fetches the rules for its own
 * layout; this turns them into the schema it validates with.
 */
export function createJournalEntrySchemaFor(rules: { requireWorkOnIssue?: boolean }) {
  if (!rules.requireWorkOnIssue) return createJournalEntrySchema;
  return createJournalEntrySchema.superRefine((value, ctx) => {
    if (value.kind !== "issue" || value.state !== "submitted") return;
    if ((value.workSummary ?? "").trim() !== "") return;
    ctx.addIssue({ code: "custom", path: ["workSummary"], message: WORK_ON_ISSUE_REQUIRED });
  });
}

// Everything a create takes may be edited, plus the state (to submit a draft).
// The server refuses edits to a locked report beyond re-opening it.
export const updateJournalEntrySchema = z.object({
  title: nameSchema.optional(),
  state: reportStateSchema.optional(),
  categoryId: uuidSchema.nullable().optional(),
  departmentId: uuidSchema.nullable().optional(),
  /** Changed, but not cleared — an entry belongs to a site, like every other kind. */
  locationId: uuidSchema.optional(),
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
  // `workSummary` / `workDetail` are deliberately absent. They are a roll-up of the
  // entry's work timeline, owned by the code that writes it, and an edit form that
  // could set them was a second writer to a derived column — the newest work log
  // would overwrite the correction on its next write, so the edit only appeared to
  // stick. Correcting what was done is done on the item that recorded it:
  // PATCH /journal/work/:id.
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
export const changeStatusSchema = z.object({
  statusId: uuidSchema.nullable(),
  /**
   * The findings, where this move is the one that finishes the issue.
   *
   * Carried on the status change rather than left to a separate edit, because the
   * server refuses a resolve without them: a rule whose fields live on another screen
   * is a rule that tells people to go away and come back. Optional here — most status
   * moves are not a resolve — and enforced where it can see which move this is.
   */
  rootCause: longText.optional(),
  preventiveMeasures: longText.optional(),
});
export type ChangeStatus = z.infer<typeof changeStatusSchema>;

/**
 * The rules an entry must satisfy, as the editor needs them.
 *
 * Sent to the browser rather than duplicated there, for the reason `taskLimitsSchema`
 * gives: these are settings, and a form holding its own copy of a configurable rule
 * is a form that is wrong the day somebody changes it.
 */
export const journalEntryRulesSchema = z.object({
  /** How far back an entry may be dated. The default (3650) is effectively no limit. */
  graceDays: z.number().int(),
  /** Whether the grace period binds this caller — a superadmin may be exempt. */
  graceApplies: z.boolean(),
  /**
   * Whether an issue must say what was done before it can be submitted. When true the
   * editor stops offering "I already did the work" and the server refuses a submit
   * with nothing in it.
   */
  requireWorkOnIssue: z.boolean(),
});
export type JournalEntryRules = z.infer<typeof journalEntryRulesSchema>;
