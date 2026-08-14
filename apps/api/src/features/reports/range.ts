// Author: Brijesh Dave <https://github.com/brijeshdave>
// Resolving a named report range (today / this week / last month …) to a concrete
// [from, to) window. The boundaries are the caller's **local** day, not UTC's: the
// browser passes its offset (minutes east of UTC), and a "today" computed in UTC
// would cut a night shift in half or bleed a report into the wrong day. Kept pure
// and separate so the boundary maths is unit-testable without a database.
import type { ReportDefinition, ReportRange } from "@reportly/shared";

export interface ResolvedRange {
  from: Date;
  to: Date;
}

/** Shift a UTC instant into the caller's local clock, so UTC getters read local. */
function toLocal(instant: Date, tzOffsetMinutes: number): Date {
  return new Date(instant.getTime() + tzOffsetMinutes * 60_000);
}
/** Shift a local wall-clock time (built with UTC setters) back to a real UTC instant. */
function toUtc(localWall: Date, tzOffsetMinutes: number): Date {
  return new Date(localWall.getTime() - tzOffsetMinutes * 60_000);
}

/** Local midnight for the day `dayShift` days from `local`, as a UTC instant. */
function localMidnight(local: Date, tzOffsetMinutes: number, dayShift: number): Date {
  const d = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayShift),
  );
  return toUtc(d, tzOffsetMinutes);
}

/** Days since the most recent Monday (Mon=0 … Sun=6) for a local date. */
function daysSinceMonday(local: Date): number {
  return (local.getUTCDay() + 6) % 7;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The [from, to) window for a financial year (April `fyStart` – March `fyStart`+1),
 * or a single calendar month within it when `month` (1–12) is given. tz-aware, like
 * the named presets: the boundaries are the caller's local midnight. April–December
 * fall in `fyStart`; January–March in the following calendar year.
 */
export function financialYearWindow(
  fyStart: number,
  month: number | null,
  tzOffsetMinutes: number,
): ResolvedRange {
  if (month == null) {
    return {
      from: toUtc(new Date(Date.UTC(fyStart, 3, 1)), tzOffsetMinutes),
      to: toUtc(new Date(Date.UTC(fyStart + 1, 3, 1)), tzOffsetMinutes),
    };
  }
  const year = month >= 4 ? fyStart : fyStart + 1;
  return {
    from: toUtc(new Date(Date.UTC(year, month - 1, 1)), tzOffsetMinutes),
    to: toUtc(new Date(Date.UTC(year, month, 1)), tzOffsetMinutes),
  };
}

export interface MonthBucket {
  key: string;
  label: string;
  from: Date;
  to: Date;
}

/**
 * Split [from, to) into calendar months in the caller's local time — for a per-month
 * report. Edge months are clamped to the window, so a mid-month start yields a
 * partial first bucket. Capped so a runaway range cannot make hundreds of buckets.
 */
export function monthBuckets(
  from: Date,
  to: Date,
  tzOffsetMinutes: number,
  cap = 12,
): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  const localFrom = toLocal(from, tzOffsetMinutes);
  let year = localFrom.getUTCFullYear();
  let month = localFrom.getUTCMonth();

  while (buckets.length < cap) {
    const monthStart = toUtc(new Date(Date.UTC(year, month, 1)), tzOffsetMinutes);
    const nextStart = toUtc(new Date(Date.UTC(year, month + 1, 1)), tzOffsetMinutes);
    if (monthStart >= to) break;
    const bFrom = monthStart < from ? from : monthStart;
    const bTo = nextStart > to ? to : nextStart;
    if (bTo > bFrom) {
      buckets.push({
        key: `${year}-${String(month + 1).padStart(2, "0")}`,
        label: `${MONTHS[month]} ${year}`,
        from: bFrom,
        to: bTo,
      });
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return buckets;
}

/**
 * Resolve a definition's range to a window. For `custom`, the definition's own
 * `from`/`to` are used (falling back to the current month if a custom range is
 * somehow missing its dates, so a report never fails to render).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveRange(
  definition: Pick<ReportDefinition, "range" | "from" | "to">,
  tzOffsetMinutes: number,
  now: Date = new Date(),
  /** Cap for a *custom* window, in days. The named presets are never capped. */
  maxCustomDays?: number,
): ResolvedRange {
  const range: ReportRange = definition.range;
  const local = toLocal(now, tzOffsetMinutes);
  const midnight = (shift: number) => localMidnight(local, tzOffsetMinutes, shift);

  switch (range) {
    case "today":
      return { from: midnight(0), to: midnight(1) };
    case "yesterday":
      return { from: midnight(-1), to: midnight(0) };
    case "this_week": {
      const start = -daysSinceMonday(local);
      return { from: midnight(start), to: midnight(start + 7) };
    }
    case "last_week": {
      const start = -daysSinceMonday(local) - 7;
      return { from: midnight(start), to: midnight(start + 7) };
    }
    case "this_month": {
      const from = toUtc(
        new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1)),
        tzOffsetMinutes,
      );
      const to = toUtc(
        new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1)),
        tzOffsetMinutes,
      );
      return { from, to };
    }
    case "last_month": {
      const from = toUtc(
        new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1)),
        tzOffsetMinutes,
      );
      const to = toUtc(
        new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1)),
        tzOffsetMinutes,
      );
      return { from, to };
    }
    case "this_year": {
      const from = toUtc(new Date(Date.UTC(local.getUTCFullYear(), 0, 1)), tzOffsetMinutes);
      const to = toUtc(new Date(Date.UTC(local.getUTCFullYear() + 1, 0, 1)), tzOffsetMinutes);
      return { from, to };
    }
    // The financial year runs April–March. The current FY starts in April of this
    // calendar year once April has arrived, and in April of last year before it.
    case "this_fy": {
      const startYear =
        local.getUTCMonth() >= 3 ? local.getUTCFullYear() : local.getUTCFullYear() - 1;
      return {
        from: toUtc(new Date(Date.UTC(startYear, 3, 1)), tzOffsetMinutes),
        to: toUtc(new Date(Date.UTC(startYear + 1, 3, 1)), tzOffsetMinutes),
      };
    }
    case "last_fy": {
      const startYear =
        (local.getUTCMonth() >= 3 ? local.getUTCFullYear() : local.getUTCFullYear() - 1) - 1;
      return {
        from: toUtc(new Date(Date.UTC(startYear, 3, 1)), tzOffsetMinutes),
        to: toUtc(new Date(Date.UTC(startYear + 1, 3, 1)), tzOffsetMinutes),
      };
    }
    case "custom": {
      let from = definition.from ? new Date(definition.from) : midnight(-30);
      // `to` is inclusive of its day in the UI; callers pass the exclusive end.
      const to = definition.to ? new Date(definition.to) : midnight(1);
      // Cap an over-long custom window by pulling the start forward — a report is a
      // report, not a multi-year dump. Presets are never capped.
      if (maxCustomDays && to.getTime() - from.getTime() > maxCustomDays * DAY_MS) {
        from = new Date(to.getTime() - maxCustomDays * DAY_MS);
      }
      return { from, to };
    }
    default:
      return { from: midnight(0), to: midnight(1) };
  }
}
