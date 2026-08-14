// Author: Brijesh Dave <https://github.com/brijeshdave>
// Small presentation helpers for the routines pages.
import type { Routine, RoutineOccurrenceState } from "@reportly/shared";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** "Every day" / "Every Monday" / "Monthly on the 1st" / "Quarterly · 2nd month, 10th". */
export function describeCadence(
  r: Pick<Routine, "cadence" | "anchorWeekday" | "anchorDay" | "anchorMonthOfQuarter">,
): string {
  switch (r.cadence) {
    case "daily":
      return "Every day";
    case "weekly":
      return `Every ${WEEKDAYS[r.anchorWeekday ?? 1]}`;
    case "monthly":
      return `Monthly on the ${ordinal(r.anchorDay ?? 1)}`;
    case "quarterly":
      return `Quarterly · month ${r.anchorMonthOfQuarter ?? 1} of the quarter, the ${ordinal(r.anchorDay ?? 1)}`;
  }
}

export const STATE_TONE: Record<
  RoutineOccurrenceState,
  "success" | "warning" | "neutral" | "danger"
> = {
  completed: "success",
  in_progress: "warning",
  pending: "neutral",
  missed: "danger",
};

export const STATE_LABEL: Record<RoutineOccurrenceState, string> = {
  completed: "Done",
  in_progress: "In progress",
  pending: "Pending",
  missed: "Missed",
};

/** A date `days` from today (negative = past), as YYYY-MM-DD. */
export function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
