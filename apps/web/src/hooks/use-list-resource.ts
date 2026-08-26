// Author: Brijesh Dave <https://github.com/brijeshdave>
// Binds list state to a server-side list endpoint: one hook per table. Owns the
// query key, so changing a page or a filter refetches exactly that table.
import type { Filter, PageSize, PaginatedResult, TableDensity } from "@reportly/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  clearFilters,
  initialListState,
  removeFilter,
  setPage,
  setPageSize,
  toggleSort,
  upsertFilter,
  type ListState,
} from "@/lib/list-query.js";
import { preferencesQuery } from "@/lib/queries.js";
import { exportFilename, exportList, fetchList, type ExportFormat } from "@/services/list.js";

export interface UseListResourceOptions {
  /** Used for the query key, and as the exported file's base name. */
  resource: string;
  /** API path of the list endpoint, e.g. `/users`. */
  path: string;
  /** API path of the export endpoint; omit when the resource has none. */
  exportPath?: string;
  /** Overrides for the starting state, e.g. a default sort column. */
  initial?: Partial<ListState>;
  /** Set false to hold the request back — a call that can only 403 is not worth making. */
  enabled?: boolean;
}

export interface ListResource<T> {
  state: ListState;
  result: PaginatedResult<T> | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;

  /** The size actually in effect, once the user's default is known. */
  pageSize: number;
  density: TableDensity;

  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
  onSortChange: (column: string) => void;
  onFilterChange: (filter: Filter) => void;
  onFilterRemove: (field: string) => void;
  onFiltersClear: () => void;
  onExport: ((format: ExportFormat) => Promise<void>) | undefined;
}

/**
 * Where a table's filters and sorting are kept between visits.
 *
 * Session storage, not local: a filter is part of what somebody is doing right
 * now, and having last week's narrowing still applied on Monday would read as a
 * broken table. It clears with the tab, like the train of thought it belongs to.
 *
 * Keyed by resource, so two tables never inherit each other's filters. A caller
 * that wants its own slot (the journal, when a link names one author) puts that in
 * the resource key.
 */
function stateKey(resource: string): string {
  return `list-state:${resource}`;
}

function remembered(resource: string, initial?: Partial<ListState>): ListState {
  const fallback = { ...initialListState, ...initial };
  try {
    const raw = sessionStorage.getItem(stateKey(resource));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ListState>;
    // Merged onto the defaults rather than trusted whole: a stored shape from an
    // older version must not leave a table with no page size.
    return { ...fallback, ...parsed };
  } catch {
    // Private windows and blocked storage both throw. A table that cannot
    // remember still has to work.
    return fallback;
  }
}

function remember(resource: string, state: ListState): void {
  try {
    sessionStorage.setItem(stateKey(resource), JSON.stringify(state));
  } catch {
    // Nothing to do: the table works, it just forgets.
  }
}

export function useListResource<T>({
  resource,
  path,
  exportPath,
  initial,
  enabled = true,
}: UseListResourceOptions): ListResource<T> {
  const [state, setState] = useState<ListState>(() => remembered(resource, initial));

  // Keep it for the trip to a record and back. Filters and sorting lived in this
  // component's own state, so opening a row unmounted the table and threw them
  // away — every question had to be asked again after reading one answer.
  useEffect(() => {
    remember(resource, state);
  }, [resource, state]);
  const { data: preferences } = useQuery(preferencesQuery);

  const query = useQuery({
    queryKey: [resource, "list", state],
    queryFn: () => fetchList<T>(path, state),
    enabled,
    // Holding the previous page on screen while the next loads avoids a
    // full-table spinner on every page change.
    placeholderData: keepPreviousData,
  });

  const update = useCallback((next: (current: ListState) => ListState) => setState(next), []);

  return useMemo(
    () => ({
      state,
      result: query.data,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      error: query.error,
      refetch: () => void query.refetch(),

      // The server echoes the size it used; before the first response, fall back
      // to the user's stored preference.
      pageSize: query.data?.pageSize ?? state.pageSize ?? preferences?.tableDefaults.pageSize ?? 20,
      density: preferences?.tableDefaults.density ?? "comfortable",

      onPageChange: (page) => update((current) => setPage(current, page)),
      onPageSizeChange: (size) => update((current) => setPageSize(current, size)),
      onSortChange: (column) => update((current) => toggleSort(current, column)),
      onFilterChange: (filter) => update((current) => upsertFilter(current, filter)),
      onFilterRemove: (field) => update((current) => removeFilter(current, field)),
      onFiltersClear: () => update(clearFilters),
      onExport: exportPath
        ? (format) => exportList(exportPath, state, format, exportFilename(resource, format))
        : undefined,
    }),
    [state, query, preferences, update, exportPath, resource],
  );
}
