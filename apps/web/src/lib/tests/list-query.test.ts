// Author: Brijesh Dave <https://github.com/brijeshdave>
// Every table maps its state onto the API's list query through these functions, so
// the param shape and the "return to page 1" rules are pinned here.
import { listQuerySchema } from "@reportly/shared";
import { describe, expect, it } from "vitest";

import {
  clearFilters,
  filterFor,
  initialListState,
  removeFilter,
  rowRange,
  setFilters,
  setPage,
  setPageSize,
  toQueryParams,
  toggleSort,
  upsertFilter,
  type ListState,
} from "@/lib/list-query.js";

const onPage = (page: number): ListState => ({ ...initialListState, page });

describe("toQueryParams", () => {
  it("omits everything the server can default", () => {
    expect(toQueryParams(initialListState)).toEqual({
      page: 1,
      pageSize: undefined,
      sortBy: undefined,
      sortDir: undefined,
      filters: undefined,
    });
  });

  it("sends sortDir only alongside a column", () => {
    const sorted = toggleSort(initialListState, "name");
    expect(toQueryParams(sorted)).toMatchObject({ sortBy: "name", sortDir: "asc" });
  });

  it("encodes filters as a json string the API can parse", () => {
    const state = setFilters(initialListState, [{ field: "name", op: "contains", value: "ac" }]);
    const params = toQueryParams(state);

    expect(params.filters).toBe('[{"field":"name","op":"contains","value":"ac"}]');
    // The round trip is what actually matters: the server must accept this.
    const parsed = listQuerySchema.parse(params);
    expect(parsed.filters).toEqual([{ field: "name", op: "contains", value: "ac" }]);
  });

  it("produces a query the server schema accepts in full", () => {
    const state = setPageSize(toggleSort(initialListState, "createdAt"), 50);
    expect(listQuerySchema.parse(toQueryParams(state))).toMatchObject({
      page: 1,
      pageSize: 50,
      sortBy: "createdAt",
      sortDir: "asc",
    });
  });
});

describe("paging", () => {
  it("never goes below the first page", () => {
    expect(setPage(initialListState, 0).page).toBe(1);
    expect(setPage(initialListState, -3).page).toBe(1);
  });

  it("resets to the first page when the page size changes", () => {
    expect(setPageSize(onPage(7), 100)).toMatchObject({ page: 1, pageSize: 100 });
  });
});

describe("toggleSort", () => {
  it("cycles unsorted -> asc -> desc -> unsorted", () => {
    const asc = toggleSort(initialListState, "name");
    expect(asc).toMatchObject({ sortBy: "name", sortDir: "asc" });

    const desc = toggleSort(asc, "name");
    expect(desc).toMatchObject({ sortBy: "name", sortDir: "desc" });

    const cleared = toggleSort(desc, "name");
    expect(cleared.sortBy).toBeUndefined();
  });

  it("starts a new column ascending regardless of the previous direction", () => {
    const desc = toggleSort(toggleSort(initialListState, "name"), "name");
    expect(toggleSort(desc, "email")).toMatchObject({ sortBy: "email", sortDir: "asc" });
  });

  it("returns to the first page on any sort change", () => {
    expect(toggleSort(onPage(4), "name").page).toBe(1);
  });
});

describe("filters", () => {
  const nameFilter = { field: "name", op: "contains", value: "ac" } as const;

  it("returns to the first page when a filter changes", () => {
    expect(setFilters(onPage(9), [nameFilter]).page).toBe(1);
    expect(clearFilters(onPage(9)).page).toBe(1);
  });

  it("replaces the existing filter on a field rather than duplicating it", () => {
    const first = upsertFilter(initialListState, nameFilter);
    const second = upsertFilter(first, { field: "name", op: "contains", value: "acme" });

    expect(second.filters).toHaveLength(1);
    expect(filterFor(second, "name")?.value).toBe("acme");
  });

  it("keeps filters on other fields", () => {
    const state = upsertFilter(upsertFilter(initialListState, nameFilter), {
      field: "status",
      op: "eq",
      value: "active",
    });
    expect(state.filters.map((filter) => filter.field)).toEqual(["name", "status"]);
  });

  it("drops a filter whose value has been emptied", () => {
    const state = upsertFilter(initialListState, nameFilter);
    expect(upsertFilter(state, { field: "name", op: "contains", value: "" }).filters).toEqual([]);
    expect(upsertFilter(state, { field: "name", op: "in", value: [] }).filters).toEqual([]);
  });

  it("removes a filter by field", () => {
    const state = upsertFilter(initialListState, nameFilter);
    expect(removeFilter(state, "name").filters).toEqual([]);
    expect(removeFilter(state, "unknown").filters).toHaveLength(1);
  });
});

describe("rowRange", () => {
  it("describes the rows actually on screen", () => {
    expect(rowRange(1, 20, 137)).toEqual({ from: 1, to: 20 });
    expect(rowRange(7, 20, 137)).toEqual({ from: 121, to: 137 });
  });

  it("collapses to zero for an empty result", () => {
    expect(rowRange(1, 20, 0)).toEqual({ from: 0, to: 0 });
  });
});
