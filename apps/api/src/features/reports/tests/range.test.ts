// Author: Brijesh Dave <https://github.com/brijeshdave>
// The range maths in isolation — the boundaries must land on the caller's local day,
// not UTC's, or "today" cuts a night shift in half. No database here: it is pure.
import { describe, expect, it } from "vitest";

import { financialYearWindow, monthBuckets, resolveRange } from "../range.js";

// A fixed instant: 2026-07-21T02:00:00Z — 21 Jul early morning in UTC.
const NOW = new Date("2026-07-21T02:00:00.000Z");

describe("resolveRange", () => {
  it("today is the caller's local midnight-to-midnight, not UTC's", () => {
    // UTC+330 (India, +5:30): local time is 07:30 on 21 Jul, so "today" is the
    // window [20 Jul 18:30Z, 21 Jul 18:30Z) — a full local day, offset from UTC.
    const { from, to } = resolveRange({ range: "today" }, 330, NOW);
    expect(from.toISOString()).toBe("2026-07-20T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-07-21T18:30:00.000Z");
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("a negative offset still gives a 24h local day", () => {
    // UTC-300 (US Eastern, -5): local is 21:00 on 20 Jul, so "today" is 20 Jul local.
    const { from, to } = resolveRange({ range: "today" }, -300, NOW);
    expect(from.toISOString()).toBe("2026-07-20T05:00:00.000Z");
    expect(to.toISOString()).toBe("2026-07-21T05:00:00.000Z");
  });

  it("this_week runs Monday to Monday", () => {
    // 21 Jul 2026 is a Tuesday; the week is Mon 20 Jul → Mon 27 Jul (UTC offset 0).
    const { from, to } = resolveRange({ range: "this_week" }, 0, NOW);
    expect(from.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("this_month spans the calendar month", () => {
    const { from, to } = resolveRange({ range: "this_month" }, 0, NOW);
    expect(from.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("this_fy runs April–March; after April it is this year's April", () => {
    // NOW is 21 Jul 2026, so the financial year is Apr 2026 → Apr 2027.
    const { from, to } = resolveRange({ range: "this_fy" }, 0, NOW);
    expect(from.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2027-04-01T00:00:00.000Z");
  });

  it("before April, this_fy is last year's April", () => {
    // February is in the financial year that started the previous April.
    const feb = new Date("2026-02-10T00:00:00.000Z");
    const { from, to } = resolveRange({ range: "this_fy" }, 0, feb);
    expect(from.toISOString()).toBe("2025-04-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("last_fy is the financial year before this one", () => {
    const { from, to } = resolveRange({ range: "last_fy" }, 0, NOW);
    expect(from.toISOString()).toBe("2025-04-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("last_month is the month before", () => {
    const { from, to } = resolveRange({ range: "last_month" }, 0, NOW);
    expect(from.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("custom uses the definition's own dates", () => {
    const { from, to } = resolveRange(
      { range: "custom", from: "2026-01-01T00:00:00.000Z", to: "2026-04-01T00:00:00.000Z" },
      0,
      NOW,
    );
    expect(from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("caps an over-long custom range by pulling the start forward", () => {
    const { from, to } = resolveRange(
      { range: "custom", from: "2026-01-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z" },
      0,
      NOW,
      31,
    );
    // The end is kept; the start is moved to 31 days before it.
    expect(to.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(to.getTime() - from.getTime()).toBe(31 * 24 * 60 * 60 * 1000);
  });

  it("never caps a named preset — the cap is for custom ranges only", () => {
    // this_year is far longer than 31 days, but a preset is trusted.
    const { from, to } = resolveRange({ range: "this_year" }, 0, NOW, 31);
    expect(from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("financialYearWindow", () => {
  it("a whole financial year is April fyStart → April fyStart+1", () => {
    const { from, to } = financialYearWindow(2026, null, 0);
    expect(from.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2027-04-01T00:00:00.000Z");
  });

  it("a month April–December falls in the starting calendar year", () => {
    const { from, to } = financialYearWindow(2026, 7, 0); // July
    expect(from.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("a month January–March falls in the following calendar year", () => {
    const { from, to } = financialYearWindow(2026, 2, 0); // February 2027
    expect(from.toISOString()).toBe("2027-02-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2027-03-01T00:00:00.000Z");
  });

  it("December is the last month in the starting year; March the last of the FY", () => {
    expect(financialYearWindow(2026, 12, 0).from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    const march = financialYearWindow(2026, 3, 0);
    expect(march.from.toISOString()).toBe("2027-03-01T00:00:00.000Z");
    expect(march.to.toISOString()).toBe("2027-04-01T00:00:00.000Z");
  });

  it("is tz-aware: the boundary is the caller's local midnight", () => {
    // UTC+330: the local FY start is 00:00 IST on 1 Apr, which is 18:30Z on 31 Mar.
    const { from } = financialYearWindow(2026, null, 330);
    expect(from.toISOString()).toBe("2026-03-31T18:30:00.000Z");
  });
});

describe("monthBuckets", () => {
  it("splits a window into calendar months", () => {
    const buckets = monthBuckets(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-04-01T00:00:00.000Z"),
      0,
    );
    expect(buckets.map((b) => b.label)).toEqual(["Jan 2026", "Feb 2026", "Mar 2026"]);
  });

  it("caps the number of buckets", () => {
    const buckets = monthBuckets(
      new Date("2020-01-01T00:00:00.000Z"),
      new Date("2030-01-01T00:00:00.000Z"),
      0,
    );
    expect(buckets).toHaveLength(12);
  });
});
