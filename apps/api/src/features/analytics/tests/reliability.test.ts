// Author: Brijesh Dave <https://github.com/brijeshdave>
// The reliability maths, and — mostly — the things it refuses to claim.
import { describe, expect, it } from "vitest";

import { reliabilityFrom, resolveWindow } from "@/features/analytics/service.js";

const asset = { id: "11111111-1111-1111-1111-111111111111", name: "Line 3" };

/** A 100-hour window, so the arithmetic below is readable. */
const window = {
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-07-05T04:00:00.000Z",
  hours: 100,
};

const facts = (over: Partial<Parameters<typeof reliabilityFrom>[1]> = {}) => ({
  failures: 0,
  openCount: 0,
  totalDowntimeMinutes: 0,
  mttrMinutes: null,
  ...over,
});

describe("reliabilityFrom", () => {
  it("computes MTBF as operating time over failures", () => {
    // 100 h window, 4 h down, 4 failures → 96 h operating → 24 h between failures.
    const r = reliabilityFrom(asset, facts({ failures: 4, totalDowntimeMinutes: 240 }), window);

    expect(r.operatingMinutes).toBe(5760);
    expect(r.mtbfHours).toBe(24);
    expect(r.availabilityPct).toBe(96);
  });

  it("returns null MTBF when nothing failed, rather than zero or infinity", () => {
    // The load-bearing refusal. Zero would sort a healthy asset as the worst thing
    // in the plant; infinity would claim it is proven. It is neither — it is
    // unmeasured, and null is the only honest answer.
    const r = reliabilityFrom(asset, facts(), window);

    expect(r.mtbfHours).toBeNull();
    expect(r.failures).toBe(0);
    // Availability is still knowable: nothing was down, so it was up throughout.
    expect(r.availabilityPct).toBe(100);
  });

  it("returns null MTTR when nothing has been closed", () => {
    // Something broke and is still broken. The mean of no finished repairs is not
    // zero minutes, and `openCount` is what explains the gap.
    const r = reliabilityFrom(
      asset,
      facts({ failures: 2, openCount: 2, totalDowntimeMinutes: 600, mttrMinutes: null }),
      window,
    );

    expect(r.mttrMinutes).toBeNull();
    expect(r.openCount).toBe(2);
  });

  it("floors operating time at zero when overlapping outages exceed the window", () => {
    // Two things down at once is two entries, each counting its own span, so total
    // downtime can legitimately exceed the window. Negative operating time is not a
    // thing, and it would make MTBF negative.
    const r = reliabilityFrom(
      asset,
      facts({ failures: 3, totalDowntimeMinutes: 9000 /* 150 h in a 100 h window */ }),
      window,
    );

    expect(r.operatingMinutes).toBe(0);
    expect(r.mtbfHours).toBe(0);
    expect(r.availabilityPct).toBe(0);
  });

  it("never reports availability above 100%", () => {
    const r = reliabilityFrom(asset, facts({ failures: 1, totalDowntimeMinutes: 0 }), window);
    expect(r.availabilityPct).toBeLessThanOrEqual(100);
  });
});

describe("resolveWindow", () => {
  it("defaults to the last 90 days and reports the span it used", () => {
    const w = resolveWindow({});
    // The window is echoed rather than assumed: every figure moves with it.
    expect(w.hours).toBeCloseTo(90 * 24, 0);
    expect(new Date(w.from).getTime()).toBeLessThan(new Date(w.to).getTime());
  });

  it("honours an explicit window", () => {
    const w = resolveWindow({ from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" });
    expect(w.hours).toBe(24);
  });

  it("refuses a backwards window instead of quietly swapping it", () => {
    // A caller who sent these the wrong way round has a bug. Swapping would hand
    // them plausible numbers for a window they never asked for — which they would
    // then believe.
    expect(() =>
      resolveWindow({ from: "2026-07-05T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z" }),
    ).toThrow();
  });

  it("refuses a zero-length window", () => {
    const t = "2026-07-01T00:00:00.000Z";
    expect(() => resolveWindow({ from: t, to: t })).toThrow();
  });

  it("refuses an unparseable date", () => {
    expect(() => resolveWindow({ from: "yesterday-ish" })).toThrow();
  });
});
