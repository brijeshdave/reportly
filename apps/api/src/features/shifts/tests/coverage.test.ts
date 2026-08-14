// Author: Brijesh Dave <https://github.com/brijeshdave>
// The scheduling maths in isolation — overlap (including overnight wrap), coverage
// and gap detection, and the day-of-month carry-forward. No database: it is pure.
import { describe, expect, it } from "vitest";

import { carryForward, coverageFor, shiftsOverlap } from "../coverage.js";

describe("shiftsOverlap", () => {
  it("two shifts sharing time clash", () => {
    // 06:00–14:00 and 12:00–20:00 overlap between 12:00 and 14:00.
    expect(shiftsOverlap(360, 840, 720, 1200)).toBe(true);
  });

  it("back-to-back shifts do not clash (half-open)", () => {
    // 06:00–14:00 then 14:00–22:00 — a legitimate non-overlapping double.
    expect(shiftsOverlap(360, 840, 840, 1320)).toBe(false);
  });

  it("an overnight shift sits beside a morning one without a false clash", () => {
    // 22:00–06:00 (wraps) and 06:00–14:00 touch at 06:00 but do not overlap.
    expect(shiftsOverlap(1320, 360, 360, 840)).toBe(false);
  });

  it("an overnight shift clashes with one that runs into its start", () => {
    // 22:00–06:00 and 20:00–23:00 overlap between 22:00 and 23:00.
    expect(shiftsOverlap(1320, 360, 1200, 1380)).toBe(true);
  });
});

describe("coverageFor", () => {
  const shifts = [
    { id: "morning", startMinute: 360, endMinute: 840 },
    { id: "night", startMinute: 1320, endMinute: 360 },
  ];

  it("flags a shift nobody works and a member with no cell", () => {
    const result = coverageFor(["2026-08-01"], ["ravi", "sam"], shifts, [
      { date: "2026-08-01", userId: "ravi", shiftId: "morning", state: "working" },
    ]);
    // Night has nobody on it; Sam has no cell at all.
    expect(result.uncovered).toEqual([{ date: "2026-08-01", shiftId: "night" }]);
    expect(result.gaps).toEqual([{ date: "2026-08-01", userId: "sam" }]);
  });

  it("an explicit Off is not a gap, and does not cover a shift", () => {
    const result = coverageFor(
      ["2026-08-01"],
      ["ravi"],
      [shifts[0]!],
      [{ date: "2026-08-01", userId: "ravi", shiftId: null, state: "off" }],
    );
    expect(result.gaps).toEqual([]); // Ravi has a cell, just an Off one
    expect(result.uncovered).toEqual([{ date: "2026-08-01", shiftId: "morning" }]);
  });
});

describe("carryForward", () => {
  it("maps day-of-month across, dropping days the target month lacks", () => {
    const source = [
      { day: 1, userId: "ravi", shiftId: "morning", state: "working" },
      { day: 31, userId: "ravi", shiftId: "morning", state: "working" },
    ];
    // September has 30 days, so the 31st is dropped rather than clamped to the 30th.
    const result = carryForward(source, 2026, 9);
    expect(result).toEqual([
      { date: "2026-09-01", userId: "ravi", shiftId: "morning", state: "working" },
    ]);
  });
});
