// Author: Brijesh Dave <https://github.com/brijeshdave>
// Team routines — recurring duties a manager gives their team. A routine's cadence and
// anchor define one expected occurrence per period; the pure helpers here enumerate
// those occurrence dates and judge punctuality, with no database, so both the API and
// the tests read the recurrence the same way.
import { z } from "zod";

import { nameSchema, timestampsSchema, uuidSchema } from "@/entities/common.js";

export const ROUTINE_CADENCES = ["daily", "weekly", "monthly", "quarterly"] as const;
export type RoutineCadence = (typeof ROUTINE_CADENCES)[number];
export const routineCadenceSchema = z.enum(ROUTINE_CADENCES);

export const ROUTINE_CADENCE_LABELS: Record<RoutineCadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

export const ROUTINE_STATUSES = ["active", "paused"] as const;
export type RoutineStatus = (typeof ROUTINE_STATUSES)[number];
export const routineStatusSchema = z.enum(ROUTINE_STATUSES);

/** An occurrence's live status, computed against completions and today. */
export const ROUTINE_OCCURRENCE_STATES = ["completed", "in_progress", "pending", "missed"] as const;
export type RoutineOccurrenceState = (typeof ROUTINE_OCCURRENCE_STATES)[number];

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

// --- the anchored recurrence, and its pure maths ---

export interface RoutineRecurrence {
  cadence: RoutineCadence;
  anchorWeekday: number | null; // 0 (Sun) – 6, weekly
  anchorDay: number | null; // 1–28, monthly / quarterly
  anchorMonthOfQuarter: number | null; // 1–3, quarterly
  startDate: string; // YYYY-MM-DD, the routine begins recurring on/after this
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Every expected occurrence date (YYYY-MM-DD) for a recurrence within [from, to),
 * on/after its start date. Anchored, one per period: daily = every day; weekly = the
 * anchored weekday; monthly = the anchored day-of-month (skipped in months without it);
 * quarterly = the anchored month-of-quarter + day.
 */
export function occurrenceDates(rec: RoutineRecurrence, from: string, to: string): string[] {
  const lo = from < rec.startDate ? rec.startDate : from;
  if (lo >= to) return [];
  const out: string[] = [];

  if (rec.cadence === "daily") {
    for (let d = new Date(`${lo}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
      const s = d.toISOString().slice(0, 10);
      if (s >= to) break;
      out.push(s);
    }
    return out;
  }

  if (rec.cadence === "weekly") {
    const wanted = rec.anchorWeekday ?? 1;
    for (let d = new Date(`${lo}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
      const s = d.toISOString().slice(0, 10);
      if (s >= to) break;
      if (d.getUTCDay() === wanted) out.push(s);
    }
    return out;
  }

  // monthly / quarterly land on one day of one month per period; walk months.
  const day = rec.anchorDay ?? 1;
  const [ly, lm] = [Number(lo.slice(0, 4)), Number(lo.slice(5, 7))];
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  for (
    let y = ly, m = lm;
    y < ty || (y === ty && m <= tm);
    m === 12 ? ((y += 1), (m = 1)) : (m += 1)
  ) {
    if (rec.cadence === "quarterly") {
      // The chosen month of the quarter this month falls in: quarter start + offset.
      const quarterStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
      if (m !== quarterStartMonth + ((rec.anchorMonthOfQuarter ?? 1) - 1)) continue;
    }
    if (day > daysInMonth(y, m)) continue;
    const s = ymd(y, m, day);
    if (s >= lo && s < to) out.push(s);
  }
  return out;
}

/** On time if the work was finished on or before the occurrence's due day. */
export function isOnTime(occurrenceDate: string, finishedAt: string | Date | null): boolean {
  if (!finishedAt) return false;
  const finished = (finishedAt instanceof Date ? finishedAt : new Date(finishedAt))
    .toISOString()
    .slice(0, 10);
  return finished <= occurrenceDate;
}

/** A YYYY-MM-DD date shifted by `n` days (UTC). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The first occurrence strictly after `date`, or null if none within a year's look-ahead. */
export function nextOccurrenceDate(rec: RoutineRecurrence, date: string): string | null {
  // 400 days comfortably spans a quarter, so every cadence yields at least one date.
  return occurrenceDates(rec, addDays(date, 1), addDays(date, 400))[0] ?? null;
}

/**
 * Whether an occurrence can no longer be logged. It expires once its grace window has
 * passed (`today` more than `graceDays` after the due day). For a periodic routine it
 * also expires once the next occurrence has arrived — a monthly duty is not logged after
 * next month's is already due. Daily routines rely on grace days alone, since their next
 * occurrence is always the very next day. `today`/`occurrenceDate` are YYYY-MM-DD.
 */
export function isOccurrenceLocked(
  rec: RoutineRecurrence,
  occurrenceDate: string,
  graceDays: number,
  today: string,
): boolean {
  if (today > addDays(occurrenceDate, graceDays)) return true;
  if (rec.cadence !== "daily") {
    const next = nextOccurrenceDate(rec, occurrenceDate);
    if (next !== null && today >= next) return true;
  }
  return false;
}

// --- entity schemas ---

export const routineAssigneeSchema = z.object({ userId: z.string(), name: nameSchema });
export type RoutineAssignee = z.infer<typeof routineAssigneeSchema>;

export const routineSchema = z
  .object({
    id: uuidSchema,
    departmentId: uuidSchema.nullable(),
    departmentName: z.string().nullable(),
    title: nameSchema,
    description: z.string().nullable(),
    cadence: routineCadenceSchema,
    anchorWeekday: z.number().int().min(0).max(6).nullable(),
    anchorDay: z.number().int().min(1).max(28).nullable(),
    anchorMonthOfQuarter: z.number().int().min(1).max(3).nullable(),
    points: z.number(),
    startDate: dateOnlySchema,
    /** Days after an occurrence's due day it stays loggable before it expires. */
    graceDays: z.number().int().min(0).max(366),
    status: routineStatusSchema,
    createdBy: z.string().nullable(),
    assignees: z.array(routineAssigneeSchema),
  })
  .merge(timestampsSchema);
export type Routine = z.infer<typeof routineSchema>;

const anchorRefine = (
  s: {
    cadence: RoutineCadence;
    anchorWeekday?: number | null;
    anchorDay?: number | null;
    anchorMonthOfQuarter?: number | null;
  },
  ctx: z.RefinementCtx,
) => {
  if (s.cadence === "weekly" && (s.anchorWeekday === null || s.anchorWeekday === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pick a weekday",
      path: ["anchorWeekday"],
    });
  }
  if (
    (s.cadence === "monthly" || s.cadence === "quarterly") &&
    (s.anchorDay === null || s.anchorDay === undefined)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pick a day of the month",
      path: ["anchorDay"],
    });
  }
  if (
    s.cadence === "quarterly" &&
    (s.anchorMonthOfQuarter === null || s.anchorMonthOfQuarter === undefined)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pick the month of the quarter",
      path: ["anchorMonthOfQuarter"],
    });
  }
};

export const createRoutineSchema = z
  .object({
    /** The department its points are credited to — the creator picks one of theirs. */
    departmentId: uuidSchema,
    title: nameSchema,
    description: z.string().trim().max(2000).optional(),
    cadence: routineCadenceSchema,
    anchorWeekday: z.number().int().min(0).max(6).nullable().optional(),
    anchorDay: z.number().int().min(1).max(28).nullable().optional(),
    anchorMonthOfQuarter: z.number().int().min(1).max(3).nullable().optional(),
    points: z.number().min(0).max(100).default(1),
    startDate: dateOnlySchema,
    /** How many days late an occurrence may still be logged; then it expires. */
    graceDays: z.number().int().min(0).max(366).default(3),
    status: routineStatusSchema.default("active"),
    assigneeIds: z.array(z.string()).min(1),
  })
  .superRefine(anchorRefine);
export type CreateRoutine = z.infer<typeof createRoutineSchema>;

// --- occurrences & completions ---

export const routineCompletionSchema = z.object({
  id: uuidSchema,
  userId: z.string(),
  name: nameSchema,
  status: z.enum(["in_progress", "completed"]),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  notes: z.string().nullable(),
  /** Finished on or before the occurrence's due day. */
  onTime: z.boolean(),
  /** Points credited by the month-end award; null until that month is awarded. */
  awardedPoints: z.number().nullable(),
});
export type RoutineCompletion = z.infer<typeof routineCompletionSchema>;

/** One expected occurrence of a routine, with everyone's completions and a derived state. */
export const routineOccurrenceSchema = z.object({
  routineId: uuidSchema,
  routineTitle: nameSchema,
  points: z.number(),
  date: dateOnlySchema,
  state: z.enum(ROUTINE_OCCURRENCE_STATES),
  /** Expired — its grace window has passed (or the next occurrence is due), so it can no
   *  longer be logged. Computed against today. */
  locked: z.boolean(),
  completions: z.array(routineCompletionSchema),
});
export type RoutineOccurrence = z.infer<typeof routineOccurrenceSchema>;

export const occurrenceQuerySchema = z.object({ from: dateOnlySchema, to: dateOnlySchema });
export type OccurrenceQuery = z.infer<typeof occurrenceQuerySchema>;

/**
 * Finishing (or editing) a completion. The times are entered by the person — a routine
 * is often logged after the fact — so both are given, not stamped from the clock. A
 * finished completion can be logged again to correct it.
 */
export const finishOccurrenceSchema = z.object({
  startedAt: z.string().datetime().nullable().optional(),
  finishedAt: z.string().datetime(),
  notes: z.string().trim().max(2000).optional(),
});
export type FinishOccurrence = z.infer<typeof finishOccurrenceSchema>;

export const updateRoutineSchema = z
  .object({
    departmentId: uuidSchema.optional(),
    title: nameSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    cadence: routineCadenceSchema.optional(),
    anchorWeekday: z.number().int().min(0).max(6).nullable().optional(),
    anchorDay: z.number().int().min(1).max(28).nullable().optional(),
    anchorMonthOfQuarter: z.number().int().min(1).max(3).nullable().optional(),
    points: z.number().min(0).max(100).optional(),
    startDate: dateOnlySchema.optional(),
    graceDays: z.number().int().min(0).max(366).optional(),
    status: routineStatusSchema.optional(),
    assigneeIds: z.array(z.string()).min(1).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.cadence) anchorRefine({ cadence: s.cadence, ...s }, ctx);
  });
export type UpdateRoutine = z.infer<typeof updateRoutineSchema>;
