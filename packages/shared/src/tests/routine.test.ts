// Author: Brijesh Dave <https://github.com/brijeshdave>
// The routine recurrence maths in isolation — the anchored occurrence dates for each
// cadence, and punctuality. No database: pure.
import { describe, expect, it } from "vitest";

import {
  isOccurrenceLocked,
  isOnTime,
  nextOccurrenceDate,
  occurrenceDates,
  type RoutineRecurrence,
} from "@/entities/routine.js";

const rec = (over: Partial<RoutineRecurrence>): RoutineRecurrence => ({
  cadence: "daily",
  anchorWeekday: null,
  anchorDay: null,
  anchorMonthOfQuarter: null,
  startDate: "2026-01-01",
  ...over,
});

describe("occurrenceDates", () => {
  it("daily is every day in the window, from the start date", () => {
    const out = occurrenceDates(
      rec({ cadence: "daily", startDate: "2026-08-03" }),
      "2026-08-01",
      "2026-08-05",
    );
    expect(out).toEqual(["2026-08-03", "2026-08-04"]);
  });

  it("weekly lands on the anchored weekday only", () => {
    // August 2026: the 3rd is a Monday. anchorWeekday 1 = Monday.
    const out = occurrenceDates(
      rec({ cadence: "weekly", anchorWeekday: 1 }),
      "2026-08-01",
      "2026-08-18",
    );
    expect(out).toEqual(["2026-08-03", "2026-08-10", "2026-08-17"]);
  });

  it("monthly lands on the anchored day, skipping months without it", () => {
    const out = occurrenceDates(
      rec({ cadence: "monthly", anchorDay: 15 }),
      "2026-08-01",
      "2026-10-31",
    );
    expect(out).toEqual(["2026-08-15", "2026-09-15", "2026-10-15"]);
  });

  it("quarterly lands on the chosen month-of-quarter and day", () => {
    // Second month of each quarter (Feb, May, Aug, Nov), the 10th, across a year.
    const out = occurrenceDates(
      rec({ cadence: "quarterly", anchorMonthOfQuarter: 2, anchorDay: 10 }),
      "2026-01-01",
      "2027-01-01",
    );
    expect(out).toEqual(["2026-02-10", "2026-05-10", "2026-08-10", "2026-11-10"]);
  });
});

describe("isOnTime", () => {
  it("finished on or before the due day is on time; after is late", () => {
    expect(isOnTime("2026-08-10", "2026-08-10T09:00:00.000Z")).toBe(true);
    expect(isOnTime("2026-08-10", "2026-08-09T23:00:00.000Z")).toBe(true);
    expect(isOnTime("2026-08-10", "2026-08-11T08:00:00.000Z")).toBe(false);
    expect(isOnTime("2026-08-10", null)).toBe(false);
  });
});

describe("nextOccurrenceDate", () => {
  it("is the next day for a daily routine", () => {
    expect(nextOccurrenceDate(rec({ cadence: "daily" }), "2026-08-10")).toBe("2026-08-11");
  });
  it("is the following anchored day for weekly / monthly", () => {
    expect(nextOccurrenceDate(rec({ cadence: "weekly", anchorWeekday: 1 }), "2026-08-03")).toBe(
      "2026-08-10",
    );
    expect(nextOccurrenceDate(rec({ cadence: "monthly", anchorDay: 15 }), "2026-08-15")).toBe(
      "2026-09-15",
    );
  });
});

describe("isOccurrenceLocked", () => {
  it("a daily occurrence relies on grace days, not the next day", () => {
    const r = rec({ cadence: "daily" });
    // grace 2: locked once today is more than 2 days past the due day.
    expect(isOccurrenceLocked(r, "2026-08-10", 2, "2026-08-11")).toBe(false);
    expect(isOccurrenceLocked(r, "2026-08-10", 2, "2026-08-12")).toBe(false);
    expect(isOccurrenceLocked(r, "2026-08-10", 2, "2026-08-13")).toBe(true);
  });

  it("a periodic occurrence also locks once the next one is due, even within grace", () => {
    // Weekly Mondays, grace 30 days. The next Monday (Aug 17) locks Aug 10 despite grace.
    const r = rec({ cadence: "weekly", anchorWeekday: 1 });
    expect(isOccurrenceLocked(r, "2026-08-10", 30, "2026-08-16")).toBe(false);
    expect(isOccurrenceLocked(r, "2026-08-10", 30, "2026-08-17")).toBe(true);
  });
});
