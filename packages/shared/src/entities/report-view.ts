// Author: Brijesh Dave <https://github.com/brijeshdave>
// Generated reports — a shaped, grouped, printable/exportable view over the
// journal. A **report view** is a saved definition (a date range, a grouping, the
// columns, and the filters); running one against the journal yields a **report
// result** (rows gathered into groups, with subtotals). Nothing here is stored as
// an aggregate — a result is computed on every read from the journal, so it is
// always current and always scoped to what the caller may already see.
//
// System views are the ones we ship: they cannot be edited or deleted, only run or
// cloned. A clone becomes an ordinary custom view its owner may customise and share
// — with nobody (private), the whole company, or specific groups. The rows a view
// returns are governed by the journal's own reporting-line and location scope, not
// by who may see the view: sharing widens which *shapes* people may run, never
// which rows they may read.
import { z } from "zod";

import { nameSchema, timestampsSchema, uuidSchema } from "@/entities/common.js";
import { reportKindSchema } from "@/entities/report.js";

// --- the pieces a definition is built from ---

/**
 * The date window a report covers. The named presets resolve to concrete `from`/`to`
 * on the server against the caller's day; `custom` uses the definition's own dates.
 * A report reads `reportDate` (when it was filed), so "this week" means filed this
 * week — the same field the journal list sorts by.
 */
export const REPORT_RANGES = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
  "this_fy",
  "last_fy",
  "custom",
] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];
export const reportRangeSchema = z.enum(REPORT_RANGES);

/** Human labels for the range picker; the server never reads these. */
export const REPORT_RANGE_LABELS: Record<ReportRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  this_year: "This calendar year",
  this_fy: "This financial year (Apr–Mar)",
  last_fy: "Last financial year",
  custom: "Custom range",
};

/**
 * How rows are gathered into sections, each with its own subtotal. `none` is a flat
 * table. Every other value is a dimension the journal already carries, so a group
 * can never leak a row the flat report would not have shown.
 */
export const REPORT_GROUPINGS = [
  "none",
  "date",
  "location",
  "department",
  "category",
  "author",
  "assignee",
  "severity",
  "status",
  "asset",
  "kind",
] as const;
export type ReportGrouping = (typeof REPORT_GROUPINGS)[number];
export const reportGroupingSchema = z.enum(REPORT_GROUPINGS);

export const REPORT_GROUPING_LABELS: Record<ReportGrouping, string> = {
  none: "No grouping (flat list)",
  date: "By day",
  location: "By location",
  department: "By department",
  category: "By category",
  author: "By person (author)",
  assignee: "By assignee",
  severity: "By severity",
  status: "By status",
  asset: "By asset",
  kind: "By kind (issue / work)",
};

/**
 * The columns a report table may show. A superset — a definition picks a subset and
 * an order. These are the fields the journal row already carries (plus the derived
 * duration and the linked asset labels), so no column implies a wider read.
 */
export const REPORT_COLUMNS = [
  "date",
  "kind",
  "title",
  "issueSummary",
  "workSummary",
  "category",
  "department",
  "location",
  "asset",
  "author",
  "assignee",
  "severity",
  "status",
  "duration",
  "age",
  "points",
] as const;
export type ReportColumn = (typeof REPORT_COLUMNS)[number];
export const reportColumnSchema = z.enum(REPORT_COLUMNS);

export const REPORT_COLUMN_LABELS: Record<ReportColumn, string> = {
  date: "Date",
  kind: "Kind",
  title: "Issue / title",
  issueSummary: "Description",
  workSummary: "Work done",
  category: "Category",
  department: "Department",
  location: "Location",
  asset: "Asset",
  author: "Reported by",
  assignee: "Assigned to",
  severity: "Severity",
  status: "Status",
  duration: "Time spent",
  age: "Age (days)",
  points: "Points",
};

/** A sensible default column set for a fresh custom report. */
export const DEFAULT_REPORT_COLUMNS: ReportColumn[] = [
  "date",
  "title",
  "issueSummary",
  "category",
  "location",
  "asset",
  "workSummary",
  "duration",
];

/**
 * What a report reads. The journal (issues & work) is the default; downtime and
 * reliability are separate sources — outages and the MTBF/MTTR figures rolled up
 * from them. Each has its own columns, so a row is pre-formatted server-side into
 * `cells` and the table/exports stay source-agnostic.
 */
export const REPORT_SOURCES = [
  "journal",
  "downtime",
  "reliability",
  "leaderboard",
  "shift_roster",
  "shift_changes",
  "shift_coverage",
  "shift_attendance",
  "routine_log",
  "routine_compliance",
  "part_register",
  "part_services",
  "part_consumption",
  "part_health",
  "printer_health",
  "part_failures",
  "part_workload",
] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];
export const reportSourceSchema = z.enum(REPORT_SOURCES);

export const REPORT_SOURCE_LABELS: Record<ReportSource, string> = {
  journal: "Journal — issues & work",
  downtime: "Downtime — outages",
  reliability: "Reliability — MTBF / MTTR",
  leaderboard: "Leaderboard — points earned",
  shift_roster: "Shift roster — who works when",
  shift_changes: "Shift changes — schedule change history",
  shift_coverage: "Shift coverage — assigned & gaps",
  shift_attendance: "Shift attendance — days per person",
  routine_log: "Routine log — completions",
  routine_compliance: "Routine compliance — done vs missed",
  part_register: "Cartridges — the register",
  part_services: "Cartridge services — refills & repairs",
  part_consumption: "Consumable usage — what was used up",
  part_health: "Cartridge health — failures & yield",
  printer_health: "Printer health — which machines eat cartridges",
  part_failures: "Cartridge failures — what failed, after whose work",
  part_workload: "Cartridge workload — who serviced how many, and what came back",
};

/** The sources that read the cartridges module, hidden where it is switched off. */
export const PART_SOURCES = [
  "part_register",
  "part_services",
  "part_consumption",
  "part_health",
  "printer_health",
  "part_failures",
  "part_workload",
] as const;
export function isPartSource(source: ReportSource): boolean {
  return (PART_SOURCES as readonly string[]).includes(source);
}

/**
 * Whether narrowing by person means anything for this source.
 *
 * The register is a statement about cartridges and the two health reports
 * aggregate tours of duty; neither has a person to narrow by. Offering the
 * picker there and quietly ignoring it would be worse than not offering it —
 * a filter that changes nothing reads as a broken filter.
 */
export function sourceSupportsPerson(source: ReportSource): boolean {
  return (
    source === "part_services" ||
    source === "part_consumption" ||
    source === "part_failures" ||
    source === "part_workload"
  );
}

/** The sources that read the schedule (scoped to one department, not the journal). */
export const SHIFT_SOURCES = [
  "shift_roster",
  "shift_changes",
  "shift_coverage",
  "shift_attendance",
] as const;
export function isShiftSource(source: ReportSource): boolean {
  return (SHIFT_SOURCES as readonly string[]).includes(source);
}

/** Columns for each schedule report (one row per… assignment / change / date-shift / person). */
export const SHIFT_ROSTER_COLUMNS = ["date", "person", "shift", "hours"] as const;
export const SHIFT_CHANGE_COLUMNS = ["date", "person", "change", "action", "actor"] as const;
export const SHIFT_COVERAGE_COLUMNS = ["date", "shift", "assigned", "status"] as const;
export const SHIFT_ATTENDANCE_COLUMNS = [
  "person",
  "working",
  "off",
  "leave",
  "holiday",
  "doubles",
] as const;

/** Columns for the routine reports (one row per completion / per person). */
export const ROUTINE_LOG_COLUMNS = [
  "date",
  "routine",
  "person",
  "status",
  "started",
  "finished",
] as const;
export const ROUTINE_COMPLIANCE_COLUMNS = [
  "person",
  "due",
  "completed",
  "missed",
  "onTime",
] as const;

/**
 * The product area a report belongs to, derived from its source. Used as the report's
 * tag/chip and to group the Reports library into tabs — one consistent domain per
 * source rather than free-form tags.
 */
export const REPORT_DOMAINS = [
  "Journal",
  "Downtime",
  "Reliability",
  "Leaderboard",
  "Scheduling",
  "Routines",
  "Cartridges",
] as const;
export type ReportDomain = (typeof REPORT_DOMAINS)[number];

export function reportDomain(source: ReportSource): ReportDomain {
  if (source.startsWith("shift_")) return "Scheduling";
  if (source.startsWith("routine_")) return "Routines";
  if (isPartSource(source)) return "Cartridges";
  switch (source) {
    case "downtime":
      return "Downtime";
    case "reliability":
      return "Reliability";
    case "leaderboard":
      return "Leaderboard";
    default:
      return "Journal";
  }
}

/** Columns for a performance leaderboard (one row per person, ranked by points). */
export const LEADERBOARD_COLUMNS = ["rank", "person", "points", "own", "team"] as const;

// --- the dedicated leaderboard page (podium view, not the tabular report) ---

/** How many places the board shows. Five by default. */
export const LEADERBOARD_LIMITS = [3, 5, 10] as const;
export type LeaderboardLimit = (typeof LEADERBOARD_LIMITS)[number];
export const DEFAULT_LEADERBOARD_LIMIT: LeaderboardLimit = 5;

// The leaderboard is always read a financial year at a time (April–March), either
// the whole year or one month within it. A financial year is named by the calendar
// year it starts in: FY 2026-27 → fyStart 2026.

/** The calendar year the current financial year began (April). FY 2026-27 → 2026. */
export function currentFinancialYearStart(now: Date = new Date()): number {
  // Months are 0-based; March is 2, April is 3.
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

/** "FY 2026-27" for fyStart 2026. */
export function financialYearLabel(fyStart: number): string {
  return `FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
}

/**
 * The earliest financial year the leaderboard offers — the app's first year of data,
 * with one before it kept for testing. The list runs from here up to the current
 * financial year, so a new year appears on its own each April with no code change.
 */
export const EARLIEST_LEADERBOARD_FY = 2025;

/** The financial years to choose from, newest first: current FY down to the earliest. */
export function financialYearOptions(now: Date = new Date()): number[] {
  const current = currentFinancialYearStart(now);
  const earliest = Math.min(EARLIEST_LEADERBOARD_FY, current);
  return Array.from({ length: current - earliest + 1 }, (_, i) => current - i);
}

const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

/** The short label for a 1-based calendar month, e.g. 4 → "APR". */
export function monthLabel(month: number): string {
  return MONTH_NAMES[month - 1] ?? "";
}

/**
 * The twelve months of a financial year in order — April … March — each with its
 * 1-based calendar month and a generic label (APR, MAY …). The year is not in the
 * label: it is fixed by the financial year already chosen alongside it.
 */
export const FINANCIAL_YEAR_MONTHS: { month: number; label: string }[] = Array.from(
  { length: 12 },
  (_, i) => {
    const month = ((3 + i) % 12) + 1; // April(4) … December(12), January(1) … March(3)
    return { month, label: monthLabel(month) };
  },
);

export const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  userId: z.string(),
  name: nameSchema,
  /** Null when they have no picture — the page shows initials. */
  avatarVersion: z.number().nullable(),
  points: z.number(),
  own: z.number(),
  team: z.number(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardResultSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  /** The financial year the standings cover, named by its starting calendar year. */
  fyStart: z.number().int(),
  /** The 1-based calendar month within that year, or null for the whole year. */
  month: z.number().int().min(1).max(12).nullable(),
  departmentId: uuidSchema.nullable(),
  departmentName: z.string().nullable(),
  limit: z.number().int().positive(),
  /** Everyone with points in the window (before the top-N cut) — for "of N people". */
  totalPeople: z.number().int().nonnegative(),
  entries: z.array(leaderboardEntrySchema),
});
export type LeaderboardResult = z.infer<typeof leaderboardResultSchema>;

/** The query the leaderboard page sends. */
export const leaderboardQuerySchema = z.object({
  departmentId: uuidSchema.optional(),
  /** The financial year to rank, by its starting calendar year. Defaults to the current one. */
  fyStart: z.coerce
    .number()
    .int()
    .min(2000)
    .max(2100)
    .default(() => currentFinancialYearStart()),
  /** A single calendar month (1–12) within that year; omit for the whole year. */
  month: z.coerce.number().int().min(1).max(12).optional(),
  limit: z.coerce
    .number()
    .int()
    .refine((n): n is LeaderboardLimit => (LEADERBOARD_LIMITS as readonly number[]).includes(n))
    .default(DEFAULT_LEADERBOARD_LIMIT),
  tzOffsetMinutes: z.coerce.number().int().min(-720).max(840).optional(),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

/** Columns for a downtime report (one row per outage). */
export const DOWNTIME_COLUMNS = [
  "date",
  "asset",
  "reason",
  "start",
  "end",
  "downtime",
  "reporter",
] as const;
/** Columns for a reliability report (one row per asset subtree). */
export const RELIABILITY_COLUMNS = [
  "asset",
  "failures",
  "open",
  "downtime",
  "mttr",
  "mtbf",
  "availability",
] as const;
/** Columns for a per-month reliability report (one row per month of one asset). */
export const RELIABILITY_MONTHLY_COLUMNS = [
  "month",
  "failures",
  "open",
  "downtime",
  "mttr",
  "mtbf",
  "availability",
] as const;
/** Columns for a per-device reliability report (one row per device). */
export const RELIABILITY_DEVICE_COLUMNS = [
  "device",
  "failures",
  "open",
  "downtime",
  "mttr",
  "mtbf",
  "availability",
] as const;

/** Labels for every column across all sources — the renderer/export reads these. */
export const ALL_REPORT_COLUMN_LABELS: Record<string, string> = {
  ...REPORT_COLUMN_LABELS,
  // cartridges
  cartridge: "Cartridge",
  model: "Model",
  partStatus: "Status",
  where: "Where",
  cycles: "Cycles",
  meanPages: "Mean pages",
  ratedPages: "Rated pages",
  serviceKind: "What was done",
  used: "Used",
  consumable: "Consumable",
  unit: "Unit",
  quantity: "Quantity",
  jobs: "Jobs",
  tours: "Tours",
  // `failures` is already labelled by the reliability block below, and means the
  // same thing here.
  verdict: "Verdict",
  printer: "Printer",
  printerType: "Type",
  lastedDays: "Lasted",
  pages: "Pages",
  servicedBy: "Serviced by",
  services: "Services",
  breakdown: "Of which",
  cartridges: "Cartridges",
  cameBack: "Came back faulty",
  removedBy: "Taken out by",
  reversed: "Points",
  // downtime
  start: "Down from",
  end: "Back up",
  downtime: "Downtime",
  reason: "Reason",
  reporter: "Logged by",
  // reliability
  failures: "Failures",
  open: "Still open",
  mttr: "MTTR",
  mtbf: "MTBF",
  availability: "Availability",
  month: "Month",
  device: "Device",
  // leaderboard
  rank: "#",
  person: "Person",
  own: "Own",
  team: "From team",
  // shift changes
  change: "Change",
  action: "Action",
  actor: "By",
  // shift roster / coverage / attendance
  shift: "Shift",
  hours: "Hours",
  assigned: "Assigned",
  working: "Working",
  off: "Off (W/O)",
  leave: "Leave",
  holiday: "Holiday",
  doubles: "Doubles",
  // routines
  routine: "Routine",
  started: "Started",
  finished: "Finished",
  due: "Due",
  completed: "Completed",
  missed: "Missed",
  onTime: "On-time %",
};

/**
 * The longest window a custom range may cover, by source. Detail reports (a row per
 * entry/outage) are capped at a month so a report stays a report, not a data dump;
 * the reliability roll-up may span a year. Named presets are never capped.
 */
export const MAX_CUSTOM_RANGE_DAYS: Record<ReportSource, number> = {
  journal: 31,
  downtime: 31,
  reliability: 366,
  // A leaderboard is a whole-period ranking; a financial year is its natural span.
  leaderboard: 366,
  // Schedule reports span a month or a year of history comfortably.
  shift_roster: 366,
  shift_changes: 366,
  shift_coverage: 366,
  shift_attendance: 366,
  // Routine reports likewise.
  routine_log: 366,
  routine_compliance: 366,
  // A cartridge's life is measured in months, and the health reports are only
  // meaningful over enough tours to see a pattern.
  part_register: 366,
  part_services: 366,
  part_consumption: 366,
  part_health: 366,
  printer_health: 366,
  part_failures: 366,
  part_workload: 366,
};

/** The fixed columns for a source (journal is user-chosen; the others are fixed). */
/* --------------------------- cartridge reports ----------------------------- */

/**
 * One row per cartridge: what it is, where it is, how hard it has worked.
 *
 * No yield column: how WELL a cartridge performs is the health report's job, and
 * it needs a window while a register is a statement of now.
 */
export const PART_REGISTER_COLUMNS = [
  "cartridge",
  "model",
  "partStatus",
  "where",
  "cycles",
] as const;

/** One row per refill or repair. */
export const PART_SERVICE_COLUMNS = [
  "date",
  "cartridge",
  "serviceKind",
  "person",
  "used",
  "points",
] as const;

/** One row per consumable: how much of it went. */
export const PART_CONSUMPTION_COLUMNS = ["consumable", "unit", "quantity", "jobs"] as const;

/**
 * One row per cartridge, worst first. The report that answers "is anything
 * abnormal" for a part rather than for a machine.
 */
export const PART_HEALTH_COLUMNS = [
  "cartridge",
  "model",
  "tours",
  "failures",
  "meanPages",
  "ratedPages",
  "verdict",
] as const;

/**
 * One row per printer. A cartridge failing repeatedly is a cartridge problem;
 * three different cartridges failing in one printer is a PRINTER problem, and
 * only grouping by machine shows it.
 */
export const PRINTER_HEALTH_COLUMNS = [
  "printer",
  "printerType",
  "tours",
  "failures",
  "cartridges",
  "meanPages",
  "verdict",
] as const;

/**
 * One row per faulty return: what failed, in which machine, who took it out —
 * and the service it had been given first, with who did that.
 *
 * The question this answers is "did the work we did hold up", which no other
 * report does: the health reports aggregate and the service log stops at the
 * refill. Naming the person who serviced it is not about blame — the reversal
 * already moved the points — it is so a pattern in WHOSE refills come back is
 * visible at all, which is the only way to spot somebody who needs shown
 * something rather than docked.
 */
export const PART_FAILURE_COLUMNS = [
  "date",
  "cartridge",
  "printer",
  "lastedDays",
  "pages",
  "serviceKind",
  "servicedBy",
  "removedBy",
  "reversed",
] as const;

/**
 * One row per person: how much cartridge work they did, and how much of it came
 * back.
 *
 * `cameBack` is the column that makes this more than a tally. Twelve refills is
 * not a fact about anybody until you know whether they held up, and the same
 * number with three returns and with none describe two different technicians.
 */
export const PART_WORKLOAD_COLUMNS = [
  "person",
  "services",
  "breakdown",
  "cartridges",
  "used",
  "cameBack",
  "reversed",
] as const;

export function columnsForSource(source: ReportSource): readonly string[] {
  if (source === "part_workload") return PART_WORKLOAD_COLUMNS;
  if (source === "part_failures") return PART_FAILURE_COLUMNS;
  if (source === "part_register") return PART_REGISTER_COLUMNS;
  if (source === "part_services") return PART_SERVICE_COLUMNS;
  if (source === "part_consumption") return PART_CONSUMPTION_COLUMNS;
  if (source === "part_health") return PART_HEALTH_COLUMNS;
  if (source === "printer_health") return PRINTER_HEALTH_COLUMNS;
  if (source === "downtime") return DOWNTIME_COLUMNS;
  if (source === "reliability") return RELIABILITY_COLUMNS;
  if (source === "leaderboard") return LEADERBOARD_COLUMNS;
  if (source === "shift_roster") return SHIFT_ROSTER_COLUMNS;
  if (source === "shift_changes") return SHIFT_CHANGE_COLUMNS;
  if (source === "shift_coverage") return SHIFT_COVERAGE_COLUMNS;
  if (source === "shift_attendance") return SHIFT_ATTENDANCE_COLUMNS;
  if (source === "routine_log") return ROUTINE_LOG_COLUMNS;
  if (source === "routine_compliance") return ROUTINE_COMPLIANCE_COLUMNS;
  return REPORT_COLUMNS;
}

/**
 * The filters a report may narrow by. Every field is an id list (any-of) except
 * `kind`, which is the single issue/work switch. These map one-to-one onto the
 * journal list's whitelisted filter columns, so the report cannot filter by
 * anything the list could not.
 */
export const reportFiltersSchema = z.object({
  locationId: z.array(uuidSchema).optional(),
  departmentId: z.array(uuidSchema).optional(),
  categoryId: z.array(uuidSchema).optional(),
  authorId: z.array(z.string()).optional(),
  assigneeId: z.array(z.string()).optional(),
  severityId: z.array(uuidSchema).optional(),
  statusId: z.array(uuidSchema).optional(),
  tagId: z.array(uuidSchema).optional(),
  /**
   * The people whose cartridge work a report is narrowed to.
   *
   * Its own field rather than reusing `authorId`: a journal author and the
   * technician who refilled a cartridge are different relationships, and one
   * name for both is how a filter starts meaning two things.
   */
  personId: z.array(z.string()).optional(),
  /** Entries tagged to any of these assets — "what is Line 3 about". */
  assetId: z.array(uuidSchema).optional(),
  /** Entries tagged to any of these devices — "every issue and work log on sensor 12". */
  deviceId: z.array(uuidSchema).optional(),
  kind: reportKindSchema.optional(),
  /** Only entries that are a recurrence of an earlier one — the "keeps happening" set. */
  recurring: z.boolean().optional(),
  /** Only entries that are not in a terminal status — the still-open / ageing set. */
  openOnly: z.boolean().optional(),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

/**
 * The saved shape of a report: what window, how grouped, which columns, and which
 * filters. Stored as one JSON blob on a report view, and also accepted inline on the
 * run endpoint so a view can be previewed before it is saved.
 */
export const reportDefinitionSchema = z.object({
  /** Which data the report reads. Defaults to the journal. */
  source: reportSourceSchema.default("journal"),
  range: reportRangeSchema.default("this_month"),
  /** Only read when `range` is `custom`; ignored otherwise. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  grouping: reportGroupingSchema.default("none"),
  /** Journal columns are user-chosen; downtime/reliability use their fixed set and
   *  ignore this. Kept as free strings so a column outside the journal set is valid. */
  columns: z
    .array(z.string())
    .min(1)
    .default([...DEFAULT_REPORT_COLUMNS]),
  filters: reportFiltersSchema.default({}),
  /** The asset a downtime/reliability report is scoped to (its whole subtree). Omit
   *  for the whole company. Ignored by the journal source, which scopes via filters. */
  assetId: uuidSchema.optional(),
  /** Reliability only: one row per month over the window (capped at a year) instead
   *  of one row per asset — a reliability trend for the chosen asset. */
  monthly: z.boolean().optional(),
  /** Reliability only: one row per device under the chosen asset (or the whole
   *  company), instead of per asset — which machine is failing, not which line. */
  byDevice: z.boolean().optional(),
  /** The department a shift-source report reads. Required by the shift_* sources. */
  departmentId: uuidSchema.nullable().optional(),
});
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

// --- the saved view and its access ---

/**
 * Who may see (and run) a report view. The rows it returns are scoped by the
 * journal's own rules regardless — this only decides who the view is offered to.
 *   private — the owner alone
 *   company — everyone in the company who holds `reports:view`
 *   groups  — only members of the named groups (plus the owner)
 * System views are always `company`.
 */
export const REPORT_VIEW_ACCESS = ["private", "company", "groups"] as const;
export type ReportViewAccess = (typeof REPORT_VIEW_ACCESS)[number];
export const reportViewAccessSchema = z.enum(REPORT_VIEW_ACCESS);

export const REPORT_VIEW_ACCESS_LABELS: Record<ReportViewAccess, string> = {
  private: "Only me",
  company: "Everyone in the company",
  groups: "Specific groups",
};

export const reportViewSchema = z
  .object({
    id: uuidSchema,
    /** Null for a system view — it belongs to no single company and shows in all. */
    companyId: uuidSchema.nullable(),
    name: nameSchema,
    description: z.string().nullable(),
    /** Shipped view: cannot be edited or deleted, only run or cloned. */
    isSystem: z.boolean(),
    /** Who built it. Null on system views. */
    ownerId: z.string().nullable(),
    ownerName: z.string().nullable(),
    access: reportViewAccessSchema,
    /** The groups the view is shared with, when `access` is `groups`. */
    groupIds: z.array(uuidSchema).default([]),
    definition: reportDefinitionSchema,
  })
  .merge(timestampsSchema);
export type ReportView = z.infer<typeof reportViewSchema>;

const shortText = z.string().trim().max(2000);

export const createReportViewSchema = z.object({
  name: nameSchema,
  description: shortText.optional(),
  access: reportViewAccessSchema.default("private"),
  groupIds: z.array(uuidSchema).optional(),
  definition: reportDefinitionSchema,
});
export type CreateReportView = z.infer<typeof createReportViewSchema>;

export const updateReportViewSchema = z.object({
  name: nameSchema.optional(),
  description: shortText.nullable().optional(),
  access: reportViewAccessSchema.optional(),
  groupIds: z.array(uuidSchema).optional(),
  definition: reportDefinitionSchema.optional(),
});
export type UpdateReportView = z.infer<typeof updateReportViewSchema>;

/** Cloning names the copy; everything else is carried from the source. */
export const cloneReportViewSchema = z.object({ name: nameSchema });
export type CloneReportView = z.infer<typeof cloneReportViewSchema>;

// --- running a report ---

/**
 * The run request. Either name a saved `viewId`, or pass a `definition` inline (the
 * editor previewing an unsaved shape). When both are present the inline definition
 * wins, so tweaking a saved view's controls re-runs it without saving first.
 */
export const runReportSchema = z.object({
  viewId: uuidSchema.optional(),
  definition: reportDefinitionSchema.optional(),
});
export type RunReport = z.infer<typeof runReportSchema>;

/**
 * One row as it appears in a report — source-agnostic. The server pre-formats every
 * value into `cells` (keyed by column), so the table and the Excel/HTML exports just
 * print `cells[column]` whatever the source is. `reportId` is the journal entry to
 * link to when there is one (null for a reliability row, which is an asset).
 */
export const reportRowSchema = z.object({
  id: z.string(),
  reportId: uuidSchema.nullable(),
  cells: z.record(z.string(), z.string()),
});
export type ReportRow = z.infer<typeof reportRowSchema>;

/**
 * The subtotals a group (and the report as a whole) carries. Which ones are shown
 * depends on the source: the journal shows time & points, downtime shows the outage
 * minutes; a reliability report has only a count (you cannot sum an MTBF).
 */
export const reportTotalsSchema = z.object({
  count: z.number().int().nonnegative(),
  durationMinutes: z.number().nonnegative(),
  downtimeMinutes: z.number().nonnegative(),
  points: z.number().nonnegative(),
});
export type ReportTotals = z.infer<typeof reportTotalsSchema>;

export const reportGroupSchema = z.object({
  /** The grouping value's id or key; null for the single group of an ungrouped
   *  report, or for rows with no value on the grouped dimension. */
  key: z.string().nullable(),
  label: z.string(),
  rows: z.array(reportRowSchema),
  totals: reportTotalsSchema,
});
export type ReportGroup = z.infer<typeof reportGroupSchema>;

export const reportMetaSchema = z.object({
  generatedAt: z.string().datetime(),
  from: z.string().datetime(),
  /** The exclusive end of the query window (the next period's first instant). */
  to: z.string().datetime(),
  /** The last instant actually included (to − 1ms) — what the header shows, so a
   *  week reads "…– Sun" and a month "…– 31", not the next period's first day. */
  toInclusive: z.string().datetime(),
  range: reportRangeSchema,
  source: reportSourceSchema,
  grouping: reportGroupingSchema,
  /** Ordered column keys, and their labels in parallel — the renderer/export needs
   *  no source knowledge, it just prints these headers and the matching cells. */
  columns: z.array(z.string()),
  columnLabels: z.array(z.string()),
  /** The saved view this run came from, if any — for the printed header. */
  viewId: uuidSchema.nullable(),
  viewName: z.string().nullable(),
  companyName: z.string().nullable(),
  /** The asset a downtime/reliability report was scoped to, for the header. */
  assetName: z.string().nullable(),
});
export type ReportMeta = z.infer<typeof reportMetaSchema>;

export const reportResultSchema = z.object({
  meta: reportMetaSchema,
  groups: z.array(reportGroupSchema),
  totals: reportTotalsSchema,
});
export type ReportResult = z.infer<typeof reportResultSchema>;

// --- shared formatting, used by the web table and the server's Excel/HTML export ---

/**
 * A duration in minutes as "2h 15m" / "45m" / "3d 4h". Kept here, not in the web
 * app, because the xlsx and html exports the API generates must read identically to
 * the on-screen table — one formatter, one truth.
 */
export function formatDurationMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return "—";
  const total = Math.round(minutes);
  const days = Math.floor(total / (60 * 24));
  const hours = Math.floor((total % (60 * 24)) / 60);
  const mins = total % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  // Show minutes only when they are the finest unit present, or nothing else is.
  if (mins > 0 && days === 0) parts.push(`${mins}m`);
  return parts.length > 0 ? parts.join(" ") : `${total}m`;
}
