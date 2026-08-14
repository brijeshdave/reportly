// Author: Brijesh Dave <https://github.com/brijeshdave>
// The timing rules are judgement calls, not arithmetic — each of these tests pins
// one decision that could reasonably have gone the other way.
import { describe, expect, it } from "vitest";

import { computeTiming, type TimingEvent } from "@/features/journal/timing.js";

const at = (iso: string): Date => new Date(iso);

const event = (iso: string, toIsTerminal = false): TimingEvent => ({
  changedAt: at(iso),
  toIsTerminal,
});

describe("computeTiming", () => {
  it("reports nothing at all for a report with no events", () => {
    // Unmeasured is not instant. Every field null, rather than a confident zero.
    expect(computeTiming([])).toEqual({
      respondedAt: null,
      resolvedAt: null,
      timeToRespondMinutes: null,
      timeToResolveMinutes: null,
      reopened: false,
    });
  });

  it("starts the clock at the creation event and measures response from it", () => {
    const timing = computeTiming([
      event("2026-07-01T09:00:00.000Z"),
      event("2026-07-01T09:30:00.000Z"),
    ]);

    expect(timing.respondedAt).toBe("2026-07-01T09:30:00.000Z");
    expect(timing.timeToRespondMinutes).toBe(30);
    // Picked up, not finished.
    expect(timing.resolvedAt).toBeNull();
    expect(timing.timeToResolveMinutes).toBeNull();
  });

  it("treats a filed-but-untouched report as never responded to", () => {
    // Creation alone is not a response: the author filing it is not somebody
    // picking it up. Null, not zero — zero would report a perfect response time for
    // every report nobody has looked at, which is precisely backwards.
    const timing = computeTiming([event("2026-07-01T09:00:00.000Z")]);

    expect(timing.respondedAt).toBeNull();
    expect(timing.timeToRespondMinutes).toBeNull();
  });

  it("counts any status move as the response, not just one that leaves the open group", () => {
    // The rule this pins is not the obvious one. The seeded ladder puts Unattended,
    // Acknowledged, In progress and On hold ALL in group `open` — the group is a
    // badge colour, not a workflow stage. So Unattended → Acknowledged is a real
    // response, and a rule keyed on leaving the `open` group would score it as no
    // response at all and make response time equal resolution time everywhere.
    const timing = computeTiming([
      event("2026-07-01T09:00:00.000Z"), // filed: Unattended  (group open)
      event("2026-07-01T09:15:00.000Z"), // moved: Acknowledged (group open, still!)
    ]);

    expect(timing.respondedAt).toBe("2026-07-01T09:15:00.000Z");
    expect(timing.timeToRespondMinutes).toBe(15);
  });

  it("measures resolution from creation to the terminal status", () => {
    const timing = computeTiming([
      event("2026-07-01T09:00:00.000Z"),
      event("2026-07-01T09:30:00.000Z"),
      event("2026-07-01T11:00:00.000Z", true),
    ]);

    expect(timing.resolvedAt).toBe("2026-07-01T11:00:00.000Z");
    expect(timing.timeToResolveMinutes).toBe(120);
    expect(timing.reopened).toBe(false);
  });

  it("resolves when the work finished, not when the paperwork was filed", () => {
    // Two terminal moves in a row — the ladder no longer ships a pair like this,
    // but a configurable catalogue can grow one, and the rule still has to hold:
    // the report was finished at the first of them, and taking the last event
    // would inflate every MTTR by however long the paperwork took.
    const timing = computeTiming([
      event("2026-07-01T09:00:00.000Z"),
      event("2026-07-01T10:00:00.000Z", true),
      event("2026-07-05T10:00:00.000Z", true),
    ]);

    expect(timing.resolvedAt).toBe("2026-07-01T10:00:00.000Z");
    expect(timing.timeToResolveMinutes).toBe(60);
  });

  it("does not claim a reopened report is resolved", () => {
    // It is open right now. A dashboard that shows a resolution date for an open
    // report is a dashboard nobody trusts twice.
    const timing = computeTiming([
      event("2026-07-01T09:00:00.000Z"),
      event("2026-07-01T10:00:00.000Z", true),
      event("2026-07-02T08:00:00.000Z"),
    ]);

    expect(timing.resolvedAt).toBeNull();
    expect(timing.timeToResolveMinutes).toBeNull();
    expect(timing.reopened).toBe(true);
  });

  it("measures a reopened-then-refixed report from the original filing, and says so", () => {
    const timing = computeTiming([
      event("2026-07-01T09:00:00.000Z"),
      event("2026-07-01T10:00:00.000Z", true),
      event("2026-07-02T08:00:00.000Z"),
      event("2026-07-02T09:00:00.000Z", true),
    ]);

    // 09:00 on the 1st to 09:00 on the 2nd — a full day, including the time it
    // spent wrongly believed fixed. `reopened` is what tells the reader that.
    expect(timing.timeToResolveMinutes).toBe(1440);
    expect(timing.reopened).toBe(true);
  });

  it("orders events itself rather than trusting the caller", () => {
    const timing = computeTiming([
      event("2026-07-01T11:00:00.000Z", true),
      event("2026-07-01T09:00:00.000Z"),
      event("2026-07-01T09:30:00.000Z"),
    ]);

    expect(timing.timeToRespondMinutes).toBe(30);
    expect(timing.timeToResolveMinutes).toBe(120);
  });

  it("does not treat a retired status as resolved", () => {
    // The status was deleted and set-null'd away, so its terminal flag is unknown.
    // The move still counts as a response — somebody did something — but unknown is
    // not "resolved", and guessing would fabricate a fix that never happened.
    const timing = computeTiming([
      event("2026-07-01T09:00:00.000Z"),
      event("2026-07-01T10:00:00.000Z", false),
    ]);

    expect(timing.respondedAt).toBe("2026-07-01T10:00:00.000Z");
    expect(timing.resolvedAt).toBeNull();
  });

  it("never returns a negative duration when timestamps go backwards", () => {
    // Clock skew between app servers is real. A negative time-to-respond would show
    // up as a nonsense average rather than as an obvious error.
    const timing = computeTiming([
      event("2026-07-01T09:00:00.000Z"),
      event("2026-07-01T08:59:59.000Z"),
    ]);

    expect(timing.timeToRespondMinutes).toBeGreaterThanOrEqual(0);
  });
});
