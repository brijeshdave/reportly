// Author: Brijesh Dave <https://github.com/brijeshdave>
import { describe, expect, it } from "vitest";

import { DATE_RANGE_PRESETS, dayEndIso, dayStartIso, isoToDay } from "@/lib/date-ranges.js";

const NOW = new Date("2026-07-11T15:30:00.000Z");

describe("date range presets", () => {
  it("every preset yields a from at or before to", () => {
    for (const preset of DATE_RANGE_PRESETS) {
      const [from, to] = preset.range(NOW);
      expect(new Date(from).getTime()).toBeLessThanOrEqual(new Date(to).getTime());
    }
  });

  it("today starts at the beginning of the day and ends now", () => {
    const today = DATE_RANGE_PRESETS.find((p) => p.id === "today")!;
    const [from, to] = today.range(NOW);
    expect(new Date(from).getTime()).toBeLessThan(NOW.getTime());
    expect(to).toBe(NOW.toISOString());
  });

  it("last 7 days reaches further back than last 30 days does not", () => {
    const seven = DATE_RANGE_PRESETS.find((p) => p.id === "7d")!.range(NOW)[0];
    const thirty = DATE_RANGE_PRESETS.find((p) => p.id === "30d")!.range(NOW)[0];
    expect(new Date(thirty).getTime()).toBeLessThan(new Date(seven).getTime());
  });
});

describe("day <-> iso conversions", () => {
  it("a blank day is a blank bound, both ways", () => {
    expect(dayStartIso("")).toBe("");
    expect(dayEndIso("")).toBe("");
    expect(isoToDay("")).toBe("");
  });

  it("the end of a day is later than its start", () => {
    const start = dayStartIso("2026-07-11");
    const end = dayEndIso("2026-07-11");
    expect(new Date(end).getTime()).toBeGreaterThan(new Date(start).getTime());
  });

  it("an iso instant round-trips back to its local day", () => {
    const day = isoToDay(dayStartIso("2026-07-11"));
    expect(day).toBe("2026-07-11");
  });
});
