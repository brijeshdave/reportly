// Author: Brijesh Dave <https://github.com/brijeshdave>
// Analytics over the reports domain — what the records add up to once there are
// enough of them: how reliable a thing is, what keeps going wrong, and what the
// person signing in owes today.
//
// Everything here is **derived**, never stored. No analytics number is written to
// a table and read back: an aggregate that is cached becomes an aggregate that is
// wrong, and the ledger it summarises (`point_awards`) is already frozen for the
// one fact that must never be recomputed. These are read models over reports,
// downtime entries and the asset tree.
import { z } from "zod";

import { pendingAppraisalSchema, pointsSummarySchema } from "@/entities/appraisal.js";
import { nameSchema, uuidSchema } from "@/entities/common.js";
import { targetKindSchema } from "@/entities/report-scope.js";

/**
 * The window an analytic was computed over. Echoed back in every response that
 * depends on one, because MTBF and availability **move with the date range** —
 * a number that moves must show what it moved with, or two screens quoting
 * different windows look like a bug in the maths.
 */
export const analyticsWindowSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  hours: z.number(),
});
export type AnalyticsWindow = z.infer<typeof analyticsWindowSchema>;

/** How far back an analytics read looks when the caller does not say. */
export const ANALYTICS_DEFAULT_WINDOW_DAYS = 90;

export const analyticsWindowQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AnalyticsWindowQuery = z.infer<typeof analyticsWindowQuerySchema>;

/**
 * Reliability figures for one thing in the asset tree.
 *
 * The nullables are the honest part of this schema and must not be coerced to
 * zero downstream. **MTBF is null when nothing failed** — an asset that never
 * broke is not infinitely reliable, it is unmeasured, and 0 would rank it as the
 * worst thing in the plant. **MTTR is null when nothing has been closed yet** —
 * the mean of no finished repairs is not zero minutes. Render null as "—", never
 * as a number.
 */
export const assetReliabilitySchema = z.object({
  assetId: uuidSchema,
  assetName: nameSchema,

  /** Downtime entries that *started* in the window. Downtime is the failure
   *  signal, not reports: a work log is not a failure. */
  failures: z.number().int().nonnegative(),
  /** Entries still open — excluded from MTTR (they would drag the mean down),
   *  surfaced here so a suspiciously good MTTR is explainable. */
  openCount: z.number().int().nonnegative(),

  totalDowntimeMinutes: z.number().nonnegative(),
  /** Window minus downtime, floored at zero: overlapping outages are counted per
   *  entry and can exceed the window, and negative operating time is not a thing. */
  operatingMinutes: z.number().nonnegative(),

  /** Mean duration of the entries **closed** in the window. Null = none closed. */
  mttrMinutes: z.number().nonnegative().nullable(),
  /** Operating time ÷ failures. Null = no failures, i.e. not measurable. */
  mtbfHours: z.number().nonnegative().nullable(),
  /** Operating time ÷ window. Null when the window has no duration. */
  availabilityPct: z.number().min(0).max(100).nullable(),
});
export type AssetReliability = z.infer<typeof assetReliabilitySchema>;

/**
 * The roll-up read for one asset: the asset itself (its whole subtree — the line,
 * its stations, and the devices standing at them), plus each child broken out, so
 * "which station on Line 3 costs us the most" is answerable without another call.
 */
export const assetReliabilityReportSchema = z.object({
  window: analyticsWindowSchema,
  /** The subtree total — this asset, everything under it, and their devices. */
  total: assetReliabilitySchema,
  /** Direct children, worst first. Each is itself a subtree total. */
  children: z.array(assetReliabilitySchema),
});
export type AssetReliabilityReport = z.infer<typeof assetReliabilityReportSchema>;

/**
 * A thing that keeps going wrong. Grouped by (target, category) rather than by
 * title, because "belt snapped" and "belt broke again" are the same problem typed
 * twice — the category is the vocabulary the org already agreed on.
 */
export const recurringIssueSchema = z.object({
  targetKind: targetKindSchema,
  targetId: z.string(),
  targetLabel: z.string(),
  categoryId: uuidSchema.nullable(),
  categoryName: z.string().nullable(),

  count: z.number().int().min(2),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  /** Mean gap between consecutive occurrences. Null when count < 2 (unreachable
   *  by the count floor above, but the maths is stated, not assumed). */
  meanGapDays: z.number().nonnegative().nullable(),
  /** The most recent one, so the row links somewhere useful. */
  latestReportId: uuidSchema,
});
export type RecurringIssue = z.infer<typeof recurringIssueSchema>;

export const recurringIssuesQuerySchema = analyticsWindowQuerySchema.extend({
  /** Narrow to one asset's subtree. Omitted = the whole company. */
  assetId: uuidSchema.optional(),
});
export type RecurringIssuesQuery = z.infer<typeof recurringIssuesQuerySchema>;

/** One report's place in an explicit recurrence chain (`reports.recurrenceOfId`). */
export const recurrenceLinkSchema = z.object({
  reportId: uuidSchema,
  title: nameSchema,
  reportDate: z.string().datetime(),
  statusName: z.string().nullable(),
  severityName: z.string().nullable(),
});
export type RecurrenceLink = z.infer<typeof recurrenceLinkSchema>;

// --- status-change timestamps ---

/**
 * One transition of a report's status. The events are the **truth**; response and
 * resolution times are derived from them on read and deliberately not stored on
 * the report. A second copy of a fact is free to drift from the first, which is
 * how the settings tabs and the user search both broke.
 */
export const reportStatusEventSchema = z.object({
  id: uuidSchema,
  reportId: uuidSchema,
  fromStatusId: uuidSchema.nullable(),
  fromStatusName: z.string().nullable(),
  toStatusId: uuidSchema.nullable(),
  toStatusName: z.string().nullable(),
  changedById: z.string(),
  changedByName: nameSchema,
  changedAt: z.string().datetime(),
});
export type JournalStatusEvent = z.infer<typeof reportStatusEventSchema>;

/**
 * What the events add up to for one report. Every field is nullable because every
 * one of them is a thing that may simply not have happened yet.
 */
export const reportTimingSchema = z.object({
  /** The first status change after filing — somebody picked it up. Deliberately
   *  "any move", not "a move out of the `open` group": the seeded ladder puts every
   *  working status (Acknowledged, In progress, On hold) in `open`, so the group is
   *  a badge colour, not a stage, and keying off it would make response time equal
   *  resolution time on every report. */
  respondedAt: z.string().datetime().nullable(),
  /** First entry into a terminal status. A reopen starts a new cycle; this is the
   *  latest such entry, so a reopened-then-refixed report reads as fixed. */
  resolvedAt: z.string().datetime().nullable(),
  timeToRespondMinutes: z.number().nonnegative().nullable(),
  timeToResolveMinutes: z.number().nonnegative().nullable(),
  /** True once a report has left terminal at least once — the number above is a
   *  total across cycles, and a reader deserves to know that. */
  reopened: z.boolean(),
});
export type ReportTiming = z.infer<typeof reportTimingSchema>;

export const journalTimelineSchema = z.object({
  timing: reportTimingSchema,
  events: z.array(reportStatusEventSchema),
});
export type JournalTimeline = z.infer<typeof journalTimelineSchema>;

// --- "My day" ---

/** A report of the caller's own, today. */
export const myDayReportSchema = z.object({
  id: uuidSchema,
  title: nameSchema,
  kind: z.string(),
  state: z.string(),
  severityName: z.string().nullable(),
  statusName: z.string().nullable(),
});
export type MyDayReport = z.infer<typeof myDayReportSchema>;

/** A downtime entry the caller opened and has not closed. */
export const myDayDowntimeSchema = z.object({
  id: uuidSchema,
  reportId: uuidSchema,
  targetLabel: z.string(),
  startedAt: z.string().datetime(),
  /** Running total so far — an open entry has no duration, only an age. */
  openForMinutes: z.number().nonnegative(),
});
export type MyDayDowntime = z.infer<typeof myDayDowntimeSchema>;

/** A task assigned to the caller and not yet finished. */
export const myDayTaskSchema = z.object({
  id: uuidSchema,
  title: nameSchema,
  state: z.string(),
  dueAt: z.string().datetime().nullable(),
  /** Due before now. Sorted first, because that is the point of the tile. */
  overdue: z.boolean(),
});
export type MyDayTask = z.infer<typeof myDayTaskSchema>;

/**
 * The home screen's one request.
 *
 * Every section but `points` is **optional, not empty** — a caller without
 * `downtime:read` gets no `openDowntimes` key at all, and the tile is not
 * rendered. The distinction is load-bearing: an empty array means "you are clear",
 * an absent key means "this is not yours to see", and a home screen that shows
 * "nothing to close" to someone who may not close anything is lying. It is also
 * why this endpoint does not 403 — a home screen that errors because one tile is
 * out of reach is a broken home screen.
 */
export const myDaySchema = z.object({
  /** The day boundary actually used, resolved from the caller's UTC offset. The
   *  browser knows the operator's day; the server does not. */
  dayStart: z.string().datetime(),
  dayEnd: z.string().datetime(),

  points: pointsSummarySchema,
  myReports: z.array(myDayReportSchema),
  draftCount: z.number().int().nonnegative(),

  pendingAppraisals: z.array(pendingAppraisalSchema).optional(),
  openDowntimes: z.array(myDayDowntimeSchema).optional(),
  openTasks: z.array(myDayTaskSchema).optional(),
});
export type MyDay = z.infer<typeof myDaySchema>;

/**
 * Minutes east of UTC, as `Date.prototype.getTimezoneOffset()` negated. The range
 * is real: UTC-12 (Baker Island) to UTC+14 (Kiritimati). Absent = UTC, so a caller
 * that sends nothing still gets a coherent day rather than an error.
 */
export const myDayQuerySchema = z.object({
  tzOffsetMinutes: z.coerce.number().int().min(-720).max(840).optional(),
});
export type MyDayQuery = z.infer<typeof myDayQuerySchema>;

/* ------------------------------ Insights charts ----------------------------- */

/**
 * One labelled magnitude. Every Insights chart is a list of these, or a small
 * record of them, because the shape a chart needs is the same shape every time
 * and the client should never be doing arithmetic to get there.
 */
export const chartPointSchema = z.object({
  label: z.string(),
  value: z.number(),
});
export type ChartPoint = z.infer<typeof chartPointSchema>;

/** Issues and work logs per day. Two series on ONE axis: both are entry counts. */
export const chartTrendPointSchema = z.object({
  label: z.string(),
  issues: z.number().int(),
  work: z.number().int(),
});
export type ChartTrendPoint = z.infer<typeof chartTrendPointSchema>;

/**
 * Everything the Insights pages draw, in one response.
 *
 * One request rather than six: the charts share a window and a company, they are
 * read together, and six round trips would make the page assemble itself on
 * screen. The window is echoed back so a chart can state the period it covers —
 * a figure without its window is not a figure.
 */
export const insightsSchema = z.object({
  window: analyticsWindowSchema,
  issuesOverTime: z.array(chartTrendPointSchema),
  issuesByCategory: z.array(chartPointSchema),
  downtimeByAsset: z.array(chartPointSchema),
  pointsByPerson: z.array(chartPointSchema),
  pointsByDepartment: z.array(chartPointSchema),
  entriesByStatus: z.array(chartPointSchema),
});
export type Insights = z.infer<typeof insightsSchema>;
