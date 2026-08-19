// Author: Brijesh Dave <https://github.com/brijeshdave>
// Shift & schedule contracts.
//
// A shift is a named span of the day a department runs on — Morning, Night, and so
// on. Its times are minutes from local midnight (0–1439), not clock strings, so
// overlap and duration are plain arithmetic; the web form converts to and from the
// "HH:mm" a person types. An overnight shift wraps midnight and shows as
// `endMinute <= startMinute` (22:00–06:00 → 1320 → 360).
//
// Shift definitions are company-wide and reused across departments; the
// per-department planning (schedules, the calendar) is built on top of them.
import { z } from "zod";

import { nameSchema, timestampsSchema, uuidSchema } from "@/entities/common.js";

/** Active shifts can be scheduled; a disabled one is retired but keeps its history. */
export const SHIFT_STATUSES = ["active", "disabled"] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];
export const shiftStatusSchema = z.enum(SHIFT_STATUSES);

/** Minutes-from-midnight, 0–1439. A day has 1440 minutes; 1440 itself is midnight next day. */
const minuteOfDaySchema = z.number().int().min(0).max(1439);

/**
 * The 1–2 character code shown in a calendar cell — G, A, B, C … — so every cell is
 * the same width and the month reads evenly rather than as a wall of full names.
 */
export const shiftCodeSchema = z.string().trim().min(1).max(2);

/**
 * The colour a shift wears on the calendar, from a fixed palette so shifts are told
 * apart at a glance. Keys, not CSS — the web maps each to a swatch, the same way both
 * light and dark themes do.
 */
export const SHIFT_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;
export type ShiftColor = (typeof SHIFT_COLORS)[number];
export const shiftColorSchema = z.enum(SHIFT_COLORS);

export const shiftSchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    /** 1–2 char calendar code (e.g. "G", "A"). */
    code: shiftCodeSchema,
    color: shiftColorSchema,
    /** Start and end as minutes from local midnight. Equal start/end is rejected on write. */
    startMinute: minuteOfDaySchema,
    endMinute: minuteOfDaySchema,
    status: shiftStatusSchema,
  })
  .merge(timestampsSchema);

export type Shift = z.infer<typeof shiftSchema>;

/** A shift as listed. Same shape today; a distinct type leaves room for counts later. */
export const shiftRowSchema = shiftSchema;
export type ShiftRow = z.infer<typeof shiftRowSchema>;

/**
 * The window in minutes, and the length it works out to — a helper both the API
 * (overlap checks) and the web (duration label) read, so an overnight wrap is
 * measured the same way everywhere.
 */
export function shiftDurationMinutes(startMinute: number, endMinute: number): number {
  const span = endMinute - startMinute;
  return span > 0 ? span : span + 1440;
}

export const createShiftSchema = z
  .object({
    name: nameSchema,
    code: shiftCodeSchema,
    color: shiftColorSchema.default("slate"),
    startMinute: minuteOfDaySchema,
    endMinute: minuteOfDaySchema,
    status: shiftStatusSchema.default("active"),
  })
  // A zero-length shift is a typo, not a shift; an overnight wrap (end < start) is fine.
  .refine((s) => s.startMinute !== s.endMinute, {
    message: "A shift must start and end at different times",
    path: ["endMinute"],
  });

export type CreateShift = z.infer<typeof createShiftSchema>;

export const updateShiftSchema = z
  .object({
    name: nameSchema.optional(),
    code: shiftCodeSchema.optional(),
    color: shiftColorSchema.optional(),
    startMinute: minuteOfDaySchema.optional(),
    endMinute: minuteOfDaySchema.optional(),
    status: shiftStatusSchema.optional(),
  })
  .refine(
    (s) =>
      s.startMinute === undefined || s.endMinute === undefined || s.startMinute !== s.endMinute,
    {
      message: "A shift must start and end at different times",
      path: ["endMinute"],
    },
  );

export type UpdateShift = z.infer<typeof updateShiftSchema>;

// --- schedules: the per-department monthly roster shown as a calendar ---

/** `draft` while built; `published` freezes a scheduled baseline against which swaps show. */
export const SCHEDULE_STATUSES = ["draft", "published"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
export const scheduleStatusSchema = z.enum(SCHEDULE_STATUSES);

/**
 * A cell is a person working a shift, or one of the non-working states: a weekly Off,
 * on Leave, or a Public Holiday. The non-working states carry no shift and show their
 * own short code in the calendar (W/O, L, PH), so a day is never ambiguous.
 */
export const ENTRY_STATES = ["working", "off", "leave", "holiday"] as const;
export type EntryState = (typeof ENTRY_STATES)[number];
export const entryStateSchema = z.enum(ENTRY_STATES);

/** The short code a non-working state shows in a cell (working uses the shift's code). */
export const ENTRY_STATE_CODES: Record<Exclude<EntryState, "working">, string> = {
  off: "W/O",
  leave: "L",
  holiday: "PH",
};

/** The full label a non-working state reads as in menus and tooltips. */
export const ENTRY_STATE_LABELS: Record<Exclude<EntryState, "working">, string> = {
  off: "Weekly off",
  leave: "Leave",
  holiday: "Public holiday",
};

/** A calendar date with no time or zone — the day a cell belongs to. */
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const yearSchema = z.number().int().min(2000).max(2100);
export const monthSchema = z.number().int().min(1).max(12);

export const scheduleSchema = z
  .object({
    id: uuidSchema,
    departmentId: uuidSchema,
    departmentName: z.string(),
    /**
     * The site this rota is for. **Null is the central rota** — the people who
     * travel rather than belong to one site, scheduled apart from every plant.
     */
    locationId: uuidSchema.nullable(),
    locationName: z.string().nullable(),
    year: yearSchema,
    month: monthSchema,
    status: scheduleStatusSchema,
    publishedAt: z.string().datetime().nullable(),
    /** Frozen against direct edits; only a Head of Department can unlock it. */
    locked: z.boolean(),
  })
  .merge(timestampsSchema);

export type Schedule = z.infer<typeof scheduleSchema>;

/** One roster cell. `planned*` is the frozen baseline (null while draft / unpublished). */
export const scheduleEntrySchema = z.object({
  id: uuidSchema,
  date: dateOnlySchema,
  userId: z.string(),
  shiftId: uuidSchema.nullable(),
  state: entryStateSchema,
  plannedShiftId: uuidSchema.nullable(),
  plannedState: entryStateSchema.nullable(),
  /**
   * Which sites this day involved — for central staff, who work one general shift
   * but may spend it at one plant or two. An indication for whoever reads the
   * rota: no hours, no halves, nothing computed from it. Always empty on a site
   * rota, where the site is the rota's own.
   */
  locationIds: z.array(uuidSchema),
});

export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

/** A person the roster is built for — a row in the calendar grid. */
export const scheduleMemberSchema = z.object({
  userId: z.string(),
  name: nameSchema,
  avatarVersion: z.number().nullable(),
  /** Head of Department — never offered as a swap counterpart. */
  isHod: z.boolean(),
});

export type ScheduleMember = z.infer<typeof scheduleMemberSchema>;

/** What the calendar flags: shifts nobody covers, and members with no cell at all. */
export const coverageSchema = z.object({
  uncovered: z.array(z.object({ date: dateOnlySchema, shiftId: uuidSchema })),
  gaps: z.array(z.object({ date: dateOnlySchema, userId: z.string() })),
});

export type Coverage = z.infer<typeof coverageSchema>;

/** The whole month payload the calendar renders — schedule (or null if not started). */
export const scheduleGridSchema = z.object({
  departmentId: uuidSchema,
  departmentName: z.string(),
  /** Null means this is the department's central rota. */
  locationId: uuidSchema.nullable(),
  locationName: z.string().nullable(),
  /** The company's sites, for tagging a central person's day. Empty on a site rota. */
  locationOptions: z.array(z.object({ id: uuidSchema, name: nameSchema })),
  year: yearSchema,
  month: monthSchema,
  schedule: scheduleSchema.nullable(),
  /** Every day of the month, YYYY-MM-DD, in order — the calendar's columns. */
  days: z.array(dateOnlySchema),
  /** Active shifts, for chips and the cell picker. */
  shifts: z.array(shiftSchema),
  members: z.array(scheduleMemberSchema),
  entries: z.array(scheduleEntrySchema),
  coverage: coverageSchema,
  /** Pending shift-change requests, so their cells can be marked apart with detail on hover. */
  pendingChanges: z.array(
    z.object({
      id: uuidSchema,
      requesterEntryId: uuidSchema,
      requesterName: z.string(),
      counterpartEntryId: uuidSchema.nullable(),
      counterpartName: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
});

export type ScheduleGrid = z.infer<typeof scheduleGridSchema>;

/**
 * One of the caller's own cells, with the rota it is on. What the shift-change form
 * is built from: somebody asking to change a day knows the day, not which rota the
 * day belongs to.
 */
export const myEntrySchema = z.object({
  entryId: uuidSchema,
  scheduleId: uuidSchema,
  date: dateOnlySchema,
  shiftId: uuidSchema.nullable(),
  shiftName: z.string().nullable(),
  state: entryStateSchema,
  /** Null when the cell is on the department's central rota. */
  locationId: uuidSchema.nullable(),
  locationName: z.string().nullable(),
});
export type MyEntry = z.infer<typeof myEntrySchema>;

export const myEntriesQuerySchema = z.object({
  departmentId: uuidSchema,
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
export type MyEntriesQuery = z.infer<typeof myEntriesQuerySchema>;

export const scheduleQuerySchema = z.object({
  departmentId: uuidSchema,
  /** Omit for the department's central rota — the travelling staff. */
  locationId: uuidSchema.optional(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;

export const createScheduleSchema = z.object({
  departmentId: uuidSchema,
  /** The site this rota is for. Omit it only together with `central`. */
  locationId: uuidSchema.optional(),
  /**
   * Start the central rota — the travelling staff — rather than a site's.
   *
   * Explicit, because "no site" would otherwise mean two different things, and the
   * one it silently meant was a rota with none of the department's staff on it.
   */
  central: z.boolean().optional(),
  year: yearSchema,
  month: monthSchema,
  /** Copy an existing month's roster forward, mapped by day-of-month. */
  carryForwardFrom: z.object({ year: yearSchema, month: monthSchema }).optional(),
});
export type CreateSchedule = z.infer<typeof createScheduleSchema>;

/**
 * Set or add a cell. Omit `entryId` for a fresh assignment; pass it to change an
 * existing one. A second, non-overlapping shift the same day (a double) is a new
 * assignment; an overlapping one is refused by the service.
 */
export const assignEntrySchema = z.object({
  entryId: uuidSchema.optional(),
  date: dateOnlySchema,
  userId: z.string(),
  shiftId: uuidSchema.nullable(),
  state: entryStateSchema.default("working"),
  /**
   * Which sites this day involved — central rota only, where it is the whole point:
   * one general shift, one plant or two. Rejected on a site rota, whose site is the
   * rota's own.
   */
  locationIds: z.array(uuidSchema).max(10).optional(),
});
export type AssignEntry = z.infer<typeof assignEntrySchema>;

/**
 * Set (or clear) many days for one person at once — the multi-select brush. `set` of
 * null clears the chosen days; otherwise every day is set to the one shift/state,
 * replacing whatever was there (so a bulk apply is predictable, one entry per day).
 */
export const bulkAssignSchema = z.object({
  userId: z.string(),
  dates: z.array(dateOnlySchema).min(1).max(45),
  set: z.object({ shiftId: uuidSchema.nullable(), state: entryStateSchema }).nullable(),
  /** Sites to tag each of those days with — central rota only. */
  locationIds: z.array(uuidSchema).max(10).optional(),
});
export type BulkAssign = z.infer<typeof bulkAssignSchema>;

/** The number of days in a month (month is 1–12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Every date of a month as YYYY-MM-DD, in order. */
export function scheduleDates(year: number, month: number): string[] {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return Array.from(
    { length: daysInMonth(year, month) },
    (_, i) => `${year}-${pad2(month)}-${pad2(i + 1)}`,
  );
}

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "August 2026" for (2026, 8). */
export function formatMonthYear(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1] ?? ""} ${year}`;
}

/** The month after (year, month), rolling the year over at December. */
export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** The month before (year, month), rolling the year back at January. */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// --- shift-change requests, approved by the reporting manager ---
//
// A person asks to change their shift on a day, optionally *suggesting* a colleague to
// swap with. Their reporting manager decides; on approval the manager confirms (or picks
// a different) colleague, and the two shifts trade — so the calendar's Actual view moves
// while the published plan stays put. ("Swap" is kept as the internal name; the UI calls
// this a shift change.)

export const SWAP_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type SwapStatus = (typeof SWAP_STATUSES)[number];
export const swapStatusSchema = z.enum(SWAP_STATUSES);

/** A colleague working the same day the manager could swap the requester with. */
export const swapCandidateSchema = z.object({
  entryId: uuidSchema,
  userId: z.string(),
  name: z.string(),
  shiftName: z.string().nullable(),
  /**
   * Null when they are on the same rota — the ordinary case. Set when they are on
   * another site's rota, which an approver may allow but has to do deliberately.
   */
  otherSiteName: z.string().nullable(),
});
export type SwapCandidate = z.infer<typeof swapCandidateSchema>;

/** A shift-change request as the inbox and the requester's list read it. */
export const swapRequestSchema = z.object({
  id: uuidSchema,
  departmentId: uuidSchema,
  scheduleId: uuidSchema,
  date: dateOnlySchema,
  requesterUserId: z.string(),
  requesterName: z.string(),
  requesterShiftName: z.string().nullable(),
  /** Null once an approved no-swap change deleted the requester's cell. */
  requesterEntryId: uuidSchema.nullable(),
  /** The suggested/confirmed colleague — null until a manager picks one on approval. */
  counterpartUserId: z.string().nullable(),
  counterpartName: z.string().nullable(),
  counterpartShiftName: z.string().nullable(),
  counterpartEntryId: uuidSchema.nullable(),
  /** Colleagues working that day the manager may swap with (populated for the inbox). */
  candidates: z.array(swapCandidateSchema),
  note: z.string().nullable(),
  /** Set when an approver deliberately allowed a swap between two sites. */
  crossSite: z.boolean(),
  crossSiteReason: z.string().nullable(),
  status: swapStatusSchema,
  /** Who decided it, and when — so an approver has a record of what they did. */
  approverUserId: z.string().nullable(),
  approverName: z.string().nullable(),
  decidedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  /** Whether the caller may approve/reject this one (the requester's manager, or a scheduler). */
  canDecide: z.boolean(),
});
export type SwapRequest = z.infer<typeof swapRequestSchema>;

export const createSwapRequestSchema = z.object({
  requesterEntryId: uuidSchema,
  /** Optional at request time — a suggestion the manager can accept or override. */
  counterpartEntryId: uuidSchema.nullable().optional(),
  note: z.string().trim().max(500).optional(),
});
export type CreateSwapRequest = z.infer<typeof createSwapRequestSchema>;

export const swapDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  /** On approve, the colleague to swap with — required unless `noSwap` or an existing suggestion. */
  counterpartEntryId: uuidSchema.optional(),
  /** On approve, grant the change with no swap — the requester is simply taken off the shift. */
  noSwap: z.boolean().optional(),
  /**
   * Allow a counterpart from another site's rota. Refused without this, and the
   * reason is required with it: somebody reading the rota later needs to know why
   * two plants traded a shift, and "the manager said so" is not that.
   */
  allowCrossSite: z.boolean().optional(),
  crossSiteReason: z.string().trim().min(3).max(500).optional(),
});
export type SwapDecision = z.infer<typeof swapDecisionSchema>;

/**
 * `inbox` = pending requests the caller can act on; `mine` = requests they raised or
 * are named in; `handled` = requests the caller has already decided (their record).
 */
export const swapListQuerySchema = z.object({
  box: z.enum(["inbox", "mine", "handled"]).default("inbox"),
});
export type SwapListQuery = z.infer<typeof swapListQuerySchema>;
