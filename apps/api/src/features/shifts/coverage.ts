// Author: Brijesh Dave <https://github.com/brijeshdave>
// The pure scheduling maths, kept out of the service so it is testable without a
// database: whether two shifts on a day clash, which shifts nobody covers and which
// people have no cell, and how a month's roster maps forward to the next.
import { shiftDurationMinutes } from "@reportly/shared";

/** A shift as an interval on the minute line, unwrapped so an overnight span is contiguous. */
function interval(startMinute: number, endMinute: number): { start: number; end: number } {
  return { start: startMinute, end: startMinute + shiftDurationMinutes(startMinute, endMinute) };
}

/**
 * Do two shifts assigned to the same day overlap in time? Half-open intervals, so a
 * shift ending exactly when another starts (14:00–14:00 boundary) does not clash.
 * Overnight shifts unwrap past 1440, which is what lets 22:00–06:00 sit beside an
 * 06:00–14:00 without a false clash.
 */
export function shiftsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const a = interval(aStart, aEnd);
  const b = interval(bStart, bEnd);
  return a.start < b.end && b.start < a.end;
}

export interface CoverageShift {
  id: string;
  startMinute: number;
  endMinute: number;
  /** Weekdays it runs, 0 = Sunday. Absent means every day, as it did before. */
  runsOnDays?: number[];
}
export interface CoverageEntry {
  date: string;
  userId: string;
  shiftId: string | null;
  state: string;
}

/**
 * The two things the calendar warns about:
 *   - `uncovered`: an active shift with nobody working it on a day.
 *   - `gaps`: a member with no cell at all on a day (an explicit Off/Leave is not a gap).
 * Both are advisory — the schedule still saves; the UI just highlights them.
 */
/** Day of week for a YYYY-MM-DD, 0 = Sunday. Parsed as UTC so it never slips a day. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function coverageFor(
  dates: string[],
  memberIds: string[],
  activeShifts: CoverageShift[],
  entries: CoverageEntry[],
): { uncovered: { date: string; shiftId: string }[]; gaps: { date: string; userId: string }[] } {
  // date -> shiftId -> count of working assignments
  const worked = new Map<string, Map<string, number>>();
  // date -> set of members with any cell
  const present = new Map<string, Set<string>>();

  for (const e of entries) {
    if (!present.has(e.date)) present.set(e.date, new Set());
    present.get(e.date)!.add(e.userId);
    if (e.state === "working" && e.shiftId) {
      if (!worked.has(e.date)) worked.set(e.date, new Map());
      const byShift = worked.get(e.date)!;
      byShift.set(e.shiftId, (byShift.get(e.shiftId) ?? 0) + 1);
    }
  }

  const uncovered: { date: string; shiftId: string }[] = [];
  const gaps: { date: string; userId: string }[] = [];
  for (const date of dates) {
    const byShift = worked.get(date);
    const weekday = weekdayOf(date);
    for (const shift of activeShifts) {
      // A shift that does not run today cannot be short-staffed today. Without this,
      // a general shift that is off on Sundays was reported uncovered every Sunday —
      // a warning that is always wrong, which teaches people to ignore the ones that
      // are not.
      if (shift.runsOnDays && !shift.runsOnDays.includes(weekday)) continue;
      if (!byShift?.get(shift.id)) uncovered.push({ date, shiftId: shift.id });
    }
    const here = present.get(date);
    for (const userId of memberIds) {
      if (!here?.has(userId)) gaps.push({ date, userId });
    }
  }
  return { uncovered, gaps };
}

export interface ForwardEntry {
  day: number;
  userId: string;
  shiftId: string | null;
  state: string;
}

/**
 * Map a source month's cells onto a target month by day-of-month: day 1 → day 1, and
 * so on. Days the target month does not have (a 31st carried into a 30-day month) are
 * dropped rather than clamped, so nothing lands on the wrong day.
 */
export function carryForward(
  source: ForwardEntry[],
  targetYear: number,
  targetMonth: number,
): { date: string; userId: string; shiftId: string | null; state: string }[] {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return source
    .filter((e) => e.day <= lastDay)
    .map((e) => ({
      date: `${targetYear}-${pad2(targetMonth)}-${pad2(e.day)}`,
      userId: e.userId,
      shiftId: e.shiftId,
      state: e.state,
    }));
}
