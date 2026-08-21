// Author: Brijesh Dave <https://github.com/brijeshdave>
// The roster leaving the app. Two things are worth holding still: the stamp, because
// a printed rota is argued with a fortnight later and "is this the current one?" is
// the first question; and the landscape page rule, because a month is 31 columns and
// portrait A4 either shrinks it past reading or spills a third of it onto page two.
import { describe, expect, it } from "vitest";
import type { ScheduleGrid } from "@reportly/shared";

import { scheduleToHtml, scheduleToXlsx } from "@/features/shifts/export.js";

const grid = {
  departmentId: "d1",
  departmentName: "Maintenance",
  locationId: "l1",
  locationName: "Kosamba",
  locationOptions: [],
  year: 2026,
  month: 8,
  schedule: null,
  days: ["2026-08-01", "2026-08-02", "2026-08-03"],
  shifts: [
    {
      id: "s1",
      name: "General",
      code: "G",
      color: "blue",
      startMinute: 540,
      endMinute: 1020,
      runsOnDays: [1, 2, 3, 4, 5, 6],
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  stateColors: { off: "slate", leave: "dark-red", holiday: "teal" },
  members: [{ userId: "u1", name: "Ravi Kumar", avatarVersion: null, isHod: false }],
  entries: [
    { id: "e1", userId: "u1", date: "2026-08-01", shiftId: "s1", state: "working" },
    { id: "e2", userId: "u1", date: "2026-08-02", shiftId: null, state: "off" },
    { id: "e3", userId: "u1", date: "2026-08-03", shiftId: null, state: "leave" },
  ],
  coverage: { uncovered: [], gaps: [] },
  pendingChanges: [],
} as unknown as ScheduleGrid;

const stamp = { at: new Date("2026-08-21T14:32:00Z"), by: "Brijesh Dave" };

describe("the printable roster", () => {
  it("says when it was taken and by whom", () => {
    const html = scheduleToHtml(grid, stamp);
    expect(html).toContain("Exported");
    expect(html).toContain("2026");
    expect(html).toContain("Brijesh Dave");
  });

  it("is A4 landscape, because 31 columns are not a portrait page", () => {
    expect(scheduleToHtml(grid, stamp)).toContain("size: A4 landscape");
  });

  it("draws each day in its own colour, and every code it draws", () => {
    const html = scheduleToHtml(grid, stamp);
    expect(html).toContain(">G<");
    expect(html).toContain(">W/O<");
    expect(html).toContain(">L<");
    // Leave is dark red by default; the cell must be filled with it rather than
    // labelled and left white.
    expect(html.toLowerCase()).toContain("#7f1d1d");
  });

  it("escapes a name rather than letting it close a tag", () => {
    const withMarkup = {
      ...grid,
      members: [
        { userId: "u1", name: "<script>alert(1)</script>", avatarVersion: null, isHod: false },
      ],
    } as unknown as ScheduleGrid;
    const html = scheduleToHtml(withMarkup, stamp);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("builds a spreadsheet that opens", async () => {
    const buffer = await scheduleToXlsx(grid, stamp);
    // The zip magic: an .xlsx that is not a zip is a file nobody can open.
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
