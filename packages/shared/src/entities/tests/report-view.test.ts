// Author: Brijesh Dave <https://github.com/brijeshdave>
// The report duration formatter is shared by the web table and the API's Excel/HTML
// exports, so the three read identically — this pins its edge cases. Also checks the
// report definition schema fills its defaults, since a stored view may omit them.
import { describe, expect, it } from "vitest";

import { formatDurationMinutes, reportDefinitionSchema } from "@/entities/report-view.js";

describe("formatDurationMinutes", () => {
  it("renders a dash for nothing measurable", () => {
    expect(formatDurationMinutes(null)).toBe("—");
    expect(formatDurationMinutes(0)).toBe("—");
    expect(formatDurationMinutes(-5)).toBe("—");
  });

  it("renders minutes, hours and days compactly", () => {
    expect(formatDurationMinutes(45)).toBe("45m");
    expect(formatDurationMinutes(60)).toBe("1h");
    expect(formatDurationMinutes(135)).toBe("2h 15m");
    // Beyond a day the minutes are dropped — a multi-day total to the minute is noise.
    expect(formatDurationMinutes(60 * 24 + 60)).toBe("1d 1h");
  });
});

describe("reportDefinitionSchema", () => {
  it("fills defaults for a sparse stored definition", () => {
    const parsed = reportDefinitionSchema.parse({ range: "this_week", grouping: "location" });
    expect(parsed.columns.length).toBeGreaterThan(0);
    expect(parsed.filters).toEqual({});
  });
});
