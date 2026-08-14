// Author: Brijesh Dave <https://github.com/brijeshdave>
// The suggested periods behind the date-range filter, plus the conversions
// between the `<input type="date">` day strings a person picks and the ISO
// instants the API compares against. A range is `[from, to]`; either end may be
// an empty string for an open bound, which the `between` operator understands.

export type DateRangeValue = [string, string];

export interface DateRangePreset {
  id: string;
  label: string;
  /** Compute `[fromISO, toISO]` relative to now. */
  range: (now: Date) => DateRangeValue;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function daysAgo(now: Date, days: number): Date {
  const copy = new Date(now);
  copy.setDate(copy.getDate() - days);
  return copy;
}

/** Ordered so the common short windows come first. `custom` is handled separately. */
export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  {
    id: "today",
    label: "Today",
    range: (now) => [startOfDay(now).toISOString(), now.toISOString()],
  },
  {
    id: "yesterday",
    label: "Yesterday",
    range: (now) => {
      const y = daysAgo(now, 1);
      return [startOfDay(y).toISOString(), endOfDay(y).toISOString()];
    },
  },
  {
    id: "7d",
    label: "Last 7 days",
    range: (now) => [startOfDay(daysAgo(now, 6)).toISOString(), now.toISOString()],
  },
  {
    id: "30d",
    label: "Last 30 days",
    range: (now) => [startOfDay(daysAgo(now, 29)).toISOString(), now.toISOString()],
  },
  {
    id: "90d",
    label: "Last 90 days",
    range: (now) => [startOfDay(daysAgo(now, 89)).toISOString(), now.toISOString()],
  },
  {
    id: "month",
    label: "This month",
    range: (now) => {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return [first.toISOString(), now.toISOString()];
    },
  },
];

/** `2026-07-11` (from a date input) -> the ISO instant at the start of that day. */
export function dayStartIso(day: string): string {
  return day ? startOfDay(new Date(`${day}T00:00:00`)).toISOString() : "";
}

/** `2026-07-11` -> the ISO instant at the end of that day, so the day is inclusive. */
export function dayEndIso(day: string): string {
  return day ? endOfDay(new Date(`${day}T00:00:00`)).toISOString() : "";
}

/** An ISO instant back to the `YYYY-MM-DD` a date input shows, in local time. */
export function isoToDay(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
