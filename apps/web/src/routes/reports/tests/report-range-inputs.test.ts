// Author: Brijesh Dave <https://github.com/brijeshdave>
// The custom-range date pickers must show the window that will actually run: the
// server caps an over-long custom range and treats `to` as an exclusive boundary,
// and a picker that showed neither left the user reading dates the report never used.
import { MAX_CUSTOM_RANGE_DAYS } from "@reportly/shared";
import { describe, expect, it } from "vitest";

import { cappedRange, toDateInputInclusive } from "@/routes/reports/report-workspace.js";

describe("toDateInputInclusive", () => {
  it("shows the last day the exclusive end actually covers", () => {
    // Stored as "1 June 00:00 exclusive"; the user picked 31 May.
    expect(toDateInputInclusive("2026-06-01T00:00:00.000Z")).toBe("2026-05-31");
  });

  it("is empty for no value", () => {
    expect(toDateInputInclusive(undefined)).toBe("");
  });
});

describe("cappedRange", () => {
  const cap = MAX_CUSTOM_RANGE_DAYS.journal; // 31 days

  it("leaves a within-cap range untouched", () => {
    const r = cappedRange("2026-05-01T00:00:00.000Z", "2026-05-20T00:00:00.000Z", cap);
    expect(r.from).toBe("2026-05-01T00:00:00.000Z");
    expect(r.to).toBe("2026-05-20T00:00:00.000Z");
  });

  it("moves the start forward on an over-long span, keeping the end", () => {
    const r = cappedRange("2026-01-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", cap);
    expect(r.to).toBe("2026-12-01T00:00:00.000Z");
    // Exactly the cap, matching what the server would compute.
    expect(new Date(r.to!).getTime() - new Date(r.from!).getTime()).toBe(cap * 24 * 60 * 60 * 1000);
  });

  it("passes a half-filled range through so the user can finish typing", () => {
    expect(cappedRange(undefined, "2026-05-20T00:00:00.000Z", cap).to).toBe(
      "2026-05-20T00:00:00.000Z",
    );
  });
});
