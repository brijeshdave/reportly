// Author: Brijesh Dave <https://github.com/brijeshdave>
// Choosing several values in one filter, and choosing a second without losing the
// first.
//
// Reported straight from use: "if I select one thing and try to select another it
// do not work, don't show selected and feels like disabled or hanged". The value is
// stored as an array and the sidebar handed every control `String(value)` — which
// turns ["a","b"] into "a,b", matching no option, so nothing ever looked selected
// and each choice appeared to do nothing.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataTable } from "@/components/data-table/data-table.js";
import { FilterSidebar, type FilterDef } from "@/components/data-table/filter-sidebar.js";
import { initialListState } from "@/lib/list-query.js";
import type { Filter } from "@reportly/shared";

const defs: FilterDef[] = [
  {
    field: "action",
    label: "Action",
    kind: "multiselect",
    options: [
      { value: "user.create", label: "user.create" },
      { value: "user.delete", label: "user.delete" },
      { value: "company.update", label: "company.update" },
    ],
  },
  // Deliberately a second control over the *same* field: a person picker and a
  // free-text id box both drive `actorId` on the audit screen, and giving them one
  // React key made the sidebar render oddly.
  { field: "actorId", label: "Actor ID", kind: "text", op: "eq" },
  { field: "actorId", label: "Actor", kind: "combobox", options: [] },
];

/** Every filter the sidebar committed on Apply, in order. */
function openSidebar(filters: Filter[] = []) {
  const changed: Filter[] = [];
  render(
    <FilterSidebar
      open
      defs={defs}
      state={{ ...initialListState, filters }}
      onFilterChange={(filter) => changed.push(filter)}
      onFiltersClear={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return changed;
}

describe("a multi-select filter", () => {
  it("keeps the first choice when a second is made", () => {
    const changed = openSidebar();

    fireEvent.click(screen.getByLabelText("Action"));
    fireEvent.click(screen.getByRole("option", { name: "user.create" }));
    fireEvent.click(screen.getByRole("option", { name: "user.delete" }));
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(changed).toContainEqual({
      field: "action",
      op: "in",
      value: ["user.create", "user.delete"],
    });
  });

  it("shows what is already selected when the sidebar reopens", () => {
    // The half that looked "disabled": an array arrived stringified, matched no
    // option, and the control drew an empty box over a filter that was applied.
    openSidebar([{ field: "action", op: "in", value: ["user.create", "user.delete"] }]);

    fireEvent.click(screen.getByLabelText("Action"));
    expect(screen.getByRole("option", { name: "user.create" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "company.update" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("removes a value when it is chosen again, and drops the filter when empty", () => {
    const changed = openSidebar([{ field: "action", op: "in", value: ["user.create"] }]);

    fireEvent.click(screen.getByLabelText("Action"));
    fireEvent.click(screen.getByRole("option", { name: "user.create" }));
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(changed).toContainEqual({ field: "action", op: "in", value: "" });
  });

  it("draws both controls when two of them drive one field", () => {
    // Same React key for both meant one could vanish or refuse to update.
    openSidebar();
    expect(screen.getByLabelText("Actor ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Actor")).toBeInTheDocument();
  });
});

describe("a list the server refuses", () => {
  it("offers a way to clear the filter that broke it", () => {
    // Reported from production: a severity filter returned 500, and because filters
    // are remembered per person the page failed the same way on every visit —
    // signing out and back in did not help, since the filter outlives the session.
    // The only escape found was deleting a session-storage key in devtools.
    const onFiltersClear = vi.fn();
    render(
      <DataTable
        {...({
          state: { ...initialListState, filters: [{ field: "action", op: "eq", value: "x" }] },
          result: undefined,
          isLoading: false,
          isFetching: false,
          error: new Error("Something went wrong"),
          pageSize: 20,
          density: "comfortable",
          onPageChange: vi.fn(),
          onPageSizeChange: vi.fn(),
          onSortChange: vi.fn(),
          onFilterChange: vi.fn(),
          onFilterRemove: vi.fn(),
          onFiltersClear,
          onExport: undefined,
          refetch: vi.fn(),
        } as unknown as Parameters<typeof DataTable>[0])}
        columns={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onFiltersClear).toHaveBeenCalled();
  });
});
