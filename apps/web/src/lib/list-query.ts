// Author: Brijesh Dave <https://github.com/brijeshdave>
// Client-side list state and its mapping onto the API's standard list query.
// Pure: no React, no fetch. Every table shares these transitions, so "changing a
// filter returns you to page 1" is decided once rather than per screen.
import type { Filter, PageSize, SortDir } from "@reportly/shared";

export interface ListState {
  page: number;
  /** Undefined means "whatever the server says my default is". */
  pageSize?: PageSize;
  sortBy?: string;
  sortDir: SortDir;
  filters: Filter[];
}

export const initialListState: ListState = {
  page: 1,
  sortDir: "asc",
  filters: [],
};

/** Query params for `GET`, matching `listQuerySchema`. Empty values are dropped. */
export function toQueryParams(state: ListState): Record<string, string | number | undefined> {
  return {
    page: state.page,
    pageSize: state.pageSize,
    sortBy: state.sortBy,
    // Only meaningful alongside a column; sending it alone would be noise.
    sortDir: state.sortBy ? state.sortDir : undefined,
    // The API accepts filters as a JSON-encoded string in the query string.
    filters: state.filters.length > 0 ? JSON.stringify(state.filters) : undefined,
  };
}

export function setPage(state: ListState, page: number): ListState {
  return { ...state, page: Math.max(1, page) };
}

/** Changing the page size invalidates the current offset. */
export function setPageSize(state: ListState, pageSize: PageSize): ListState {
  return { ...state, pageSize, page: 1 };
}

/**
 * Cycle a column: unsorted -> asc -> desc -> unsorted. Sorting by a new column
 * always starts ascending, and any sort change returns to the first page.
 */
export function toggleSort(state: ListState, column: string): ListState {
  if (state.sortBy !== column) return { ...state, sortBy: column, sortDir: "asc", page: 1 };
  if (state.sortDir === "asc") return { ...state, sortDir: "desc", page: 1 };
  return { ...state, sortBy: undefined, sortDir: "asc", page: 1 };
}

/** A narrowed result set makes the current page number meaningless. */
export function setFilters(state: ListState, filters: Filter[]): ListState {
  return { ...state, filters, page: 1 };
}

export function clearFilters(state: ListState): ListState {
  return setFilters(state, []);
}

/** Replace or append the filter on `field`; an empty value removes it. */
export function upsertFilter(state: ListState, filter: Filter): ListState {
  const isEmpty = filter.value === "" || (Array.isArray(filter.value) && filter.value.length === 0);
  const others = state.filters.filter((existing) => existing.field !== filter.field);
  return setFilters(state, isEmpty ? others : [...others, filter]);
}

export function removeFilter(state: ListState, field: string): ListState {
  return setFilters(
    state,
    state.filters.filter((filter) => filter.field !== field),
  );
}

export function filterFor(state: ListState, field: string): Filter | undefined {
  return state.filters.find((filter) => filter.field === field);
}

/** "1-20 of 137" — the range actually shown, given the page and total. */
export function rowRange(
  page: number,
  pageSize: number,
  total: number,
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from, to: Math.min(page * pageSize, total) };
}
