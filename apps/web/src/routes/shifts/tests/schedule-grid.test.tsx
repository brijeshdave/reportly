// Author: Brijesh Dave <https://github.com/brijeshdave>
// The one thing about the roster grid that keeps going wrong: where the colour lands.
//
// It has twice been put on a span wrapped around the shift's letter — a tinted pill,
// padded and rounded, with the table showing through around it. On a screen that
// reads as a badge stuck in a box rather than as a rota, and the report every time
// has been "the colour area is bad", which is a hard complaint to turn back into a
// class name. So: assert that the cell's own button carries the fill, and that the
// letter inside carries no background of its own.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScheduleGrid } from "@reportly/shared";

import { ScheduleGridView } from "@/routes/shifts/schedule-grid.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

const SHIFT = {
  id: "s1",
  name: "Morning",
  code: "A",
  color: "blue" as const,
  startMinute: 360,
  endMinute: 840,
  status: "active" as const,
  runsOnDays: [0, 1, 2, 3, 4, 5, 6],
  companyId: "c1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function gridWith(state: "working" | "off", shiftId: string | null): ScheduleGrid {
  return {
    departmentId: "d1",
    departmentName: "IT",
    locationId: null,
    locationName: null,
    locationOptions: [],
    year: 2026,
    month: 8,
    schedule: {
      id: "sch1",
      companyId: "c1",
      departmentId: "d1",
      locationId: null,
      year: 2026,
      month: 8,
      status: "draft",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    days: ["2026-08-01"],
    shifts: [SHIFT],
    stateColors: { off: "slate", leave: "red-dark", holiday: "teal-dark" },
    members: [{ userId: "u1", name: "Banti Patel", avatarVersion: null, rank: "member" }],
    entries: [
      {
        id: "e1",
        scheduleId: "sch1",
        userId: "u1",
        date: "2026-08-01",
        shiftId,
        state,
        plannedShiftId: shiftId,
        plannedState: state,
        locationIds: [],
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    coverage: { uncovered: [], gaps: [] },
    pendingChanges: [],
  } as unknown as ScheduleGrid;
}

/** The span actually holding the code, rather than a wrapper with the same text. */
function codeSpan(cell: HTMLElement, text: string): HTMLElement {
  const found = [...cell.querySelectorAll("span")].find(
    (el) => el.textContent === text && el.querySelector("span") === null,
  );
  expect(found, `no span holding ${text}`).toBeTruthy();
  return found as HTMLElement;
}

function renderGrid(grid: ScheduleGrid) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ScheduleGridView
        grid={grid}
        view="actual"
        canManage={false}
        onChanged={() => {}}
        density="comfortable"
      />
    </QueryClientProvider>,
  );
  return screen.getByRole("button", { name: /Banti Patel, 2026-08-01/ });
}

describe("the roster cell", () => {
  it("paints the whole cell, not a badge inside it", () => {
    const cell = renderGrid(gridWith("working", "s1"));

    // The fill is on the button — the full width and height of the cell.
    expect(cell.className).toContain("bg-blue-100");
    expect(cell.className).toContain("h-full");
    expect(cell.className).toContain("w-full");

    // And the letter sits on it as plain text: no second background, no padding
    // ring, nothing that would leave the table showing through around it.
    // The innermost span: the outer ones are layout wrappers whose text is the same.
    const code = codeSpan(cell, "A");
    expect(code.className).not.toMatch(/bg-/);
    expect(code.className).not.toMatch(/rounded/);
  });

  it("paints a day off in its own colour too", () => {
    const cell = renderGrid(gridWith("off", null));
    expect(cell.className).toContain("bg-slate-100");
    expect(cell.textContent).toContain("W/O");
  });

  it("keeps W/O on one line", () => {
    // It used to break at the slash and stack "W/" above "O" in a narrow column.
    const cell = renderGrid(gridWith("off", null));
    const code = codeSpan(cell, "W/O");
    expect(code.className).toContain("whitespace-nowrap");
  });
});
