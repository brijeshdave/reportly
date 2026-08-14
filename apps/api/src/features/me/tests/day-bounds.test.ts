// Author: Brijesh Dave <https://github.com/brijeshdave>
// "Today" is the only hard part of the home screen: it depends on where the person
// standing at the machine is, not on where the server is.
import { describe, expect, it } from "vitest";

import { dayBounds } from "@/features/me/my-day-service.js";

describe("dayBounds", () => {
  it("uses UTC's day when no offset is given", () => {
    const { start, end } = dayBounds(new Date("2026-07-17T14:30:00.000Z"), 0);

    expect(start.toISOString()).toBe("2026-07-17T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-18T00:00:00.000Z");
  });

  it("gives a UTC+5:30 caller their own local day", () => {
    // 14:30 UTC is 20:00 in Kolkata, still the 17th there. The day boundaries are
    // 18:30 UTC on the 16th → 18:30 UTC on the 17th.
    const { start, end } = dayBounds(new Date("2026-07-17T14:30:00.000Z"), 330);

    expect(start.toISOString()).toBe("2026-07-16T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-07-17T18:30:00.000Z");
  });

  it("keeps a late-night report in the day its author filed it", () => {
    // The case that makes this worth its own function. 19:30 UTC is 01:00 on the
    // 18th in Kolkata — the operator's *today*. Computed in UTC it lands on the
    // 17th and disappears off their screen the moment they file it.
    const { start, end } = dayBounds(new Date("2026-07-17T19:30:00.000Z"), 330);

    expect(start.toISOString()).toBe("2026-07-17T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-07-18T18:30:00.000Z");
    // The report they just filed falls inside their day.
    expect(new Date("2026-07-17T19:30:00.000Z") >= start).toBe(true);
    expect(new Date("2026-07-17T19:30:00.000Z") < end).toBe(true);
  });

  it("handles a negative offset", () => {
    // 02:00 UTC on the 17th is 21:00 on the 16th at UTC-5 — still their yesterday.
    // Their day therefore began at local midnight on the 16th, which is 05:00 UTC.
    const { start, end } = dayBounds(new Date("2026-07-17T02:00:00.000Z"), -300);

    expect(start.toISOString()).toBe("2026-07-16T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-17T05:00:00.000Z");
  });

  it("spans exactly 24 hours at the extremes of the allowed range", () => {
    // UTC-12 (Baker Island) and UTC+14 (Kiritimati) are the real ends of the range
    // the schema permits; neither may produce a malformed day.
    for (const offset of [-720, 840]) {
      const { start, end } = dayBounds(new Date("2026-07-17T12:00:00.000Z"), offset);
      expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
      expect(start.getTime()).toBeLessThanOrEqual(new Date("2026-07-17T12:00:00.000Z").getTime());
      expect(end.getTime()).toBeGreaterThan(new Date("2026-07-17T12:00:00.000Z").getTime());
    }
  });

  it("always contains the instant it was asked about", () => {
    // The invariant behind all of the above: whatever offset a browser sends, the
    // caller's 'now' must fall inside the day the server computes for them.
    const now = new Date("2026-07-17T23:45:00.000Z");
    for (const offset of [-720, -300, -60, 0, 60, 330, 540, 840]) {
      const { start, end } = dayBounds(now, offset);
      expect(now.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(now.getTime()).toBeLessThan(end.getTime());
    }
  });
});
