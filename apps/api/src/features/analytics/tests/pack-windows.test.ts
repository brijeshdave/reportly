// Author: Brijesh Dave <https://github.com/brijeshdave>
// Which month a management pack covers, and what it is compared against.
//
// This is the part of the pack that can be wrong without looking wrong: every
// indicator on the page is "this window against that one", so a window that is off
// by a day makes fourteen cards quietly lie in the same direction. A comparison
// between a 28-day month and 31 days of the month before would show February
// improving on January every single year.
import { describe, expect, it, vi, afterEach } from "vitest";

import { resolvePackWindows } from "@/features/analytics/pack-service.js";

afterEach(() => {
  vi.useRealTimers();
});

const day = (d: Date) => d.toISOString().slice(0, 10);

describe("the pack's windows", () => {
  it("compares a month with the month before it, not with thirty days", () => {
    const w = resolvePackWindows({ month: "2026-03" });
    expect(day(w.from)).toBe("2026-03-01");
    expect(day(w.to)).toBe("2026-03-31");
    // February, all of it and only it.
    expect(day(w.previousFrom)).toBe("2026-02-01");
    expect(day(w.previousTo)).toBe("2026-02-28");
    expect(w.label).toBe("March 2026");
  });

  it("crosses a year end without arithmetic on the month number", () => {
    const w = resolvePackWindows({ month: "2026-01" });
    expect(day(w.previousFrom)).toBe("2025-12-01");
    expect(day(w.previousTo)).toBe("2025-12-31");
  });

  it("handles a leap February, because the month decides its own length", () => {
    const w = resolvePackWindows({ month: "2028-02" });
    expect(day(w.to)).toBe("2028-02-29");
  });

  it("opens on the last COMPLETE month, never the one in progress", () => {
    // A part month beside a full one is the commonest way a dashboard lies: on the
    // 3rd, "this month" is three days of work against thirty-one and every card
    // reads as a collapse.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T09:00:00Z"));
    const w = resolvePackWindows({});
    expect(day(w.from)).toBe("2026-08-01");
    expect(day(w.to)).toBe("2026-08-31");
    expect(day(w.previousFrom)).toBe("2026-07-01");
  });

  it("steps back over a year end when January is in progress", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-10T09:00:00Z"));
    const w = resolvePackWindows({});
    expect(w.label).toBe("December 2026");
    expect(day(w.previousFrom)).toBe("2026-11-01");
  });

  it("compares an explicit range with the same length immediately before it", () => {
    const w = resolvePackWindows({ from: "2026-05-10T00:00:00Z", to: "2026-05-20T00:00:00Z" });
    expect(day(w.previousFrom)).toBe("2026-04-30");
    expect(day(w.previousTo)).toBe("2026-05-09");
  });

  it("refuses a backwards range rather than quietly swapping it", () => {
    expect(() =>
      resolvePackWindows({ from: "2026-05-20T00:00:00Z", to: "2026-05-10T00:00:00Z" }),
    ).toThrow();
  });

  it("refuses a month that is not one", () => {
    expect(() => resolvePackWindows({ month: "2026-13" })).toThrow();
  });
});
