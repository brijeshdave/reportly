// Author: Brijesh Dave <https://github.com/brijeshdave>
// Binds list state to a server-side list endpoint: one hook per table. Owns the
// query key, so changing a page or a filter refetches exactly that table.
import { PERMISSIONS, can } from "@reportly/shared";
import type {
  Filter,
  PageSize,
  PaginatedResult,
  TableDensity,
  TableView,
  TableViews,
} from "@reportly/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { preferencesQuery, sessionQuery } from "@/lib/queries.js";
import { saveMyTableViews, saveOrgTableViews, type MyPreferences } from "@/services/settings.js";
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

  /**
   * The columns this person has hidden on this table, or `null` when they have
   * never chosen — which is not the same as choosing to hide nothing, and is why
   * the table's own default can still apply.
   */
  hiddenColumns: string[] | null;
  /** Remember a new choice. Saved against the account, so it survives a refresh,
   *  a new tab and a different machine. */
  onColumnsChange: (hidden: string[]) => void;

  /**
   * Make how this table looks right now the default for everyone who has not
   * arranged it themselves. Needs `settings:manage`; the toolbar only offers it to
   * somebody who holds that.
   */
  saveAsOrgDefault: () => Promise<void>;
  /** Drop this person's own arrangement and follow the organisation's again. */
  resetToOrgDefault: () => Promise<void>;
  /** True when this person has arranged this table themselves. */
  hasOwnView: boolean;
  /** Whether this person may set the default everyone else gets. */
  maySetOrgDefault: boolean;

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

/** Whether this session has already been on this table. */
function hasMemory(resource: string): boolean {
  try {
    return sessionStorage.getItem(stateKey(resource)) !== null;
  } catch {
    return false;
  }
}

/** Drop this session's memory of a table, so a saved view applies again. */
function forget(resource: string): void {
  try {
    sessionStorage.removeItem(stateKey(resource));
  } catch {
    // Nothing to do.
  }
}

function remember(resource: string, state: ListState): void {
  try {
    sessionStorage.setItem(stateKey(resource), JSON.stringify(state));
  } catch {
    // Nothing to do: the table works, it just forgets.
  }
}

/**
 * How a table opens, for somebody who has not arranged it themselves.
 *
 * A table at a time: a person who chose the journal's columns has said nothing
 * about tasks, so their record must not shadow the organisation's answer for every
 * other table. Resolving the whole setting as one value — which is what every other
 * user-overridable setting does — would opt them out of every default set later.
 */
function viewFor(tableKey: string, mine: TableViews, org: TableViews): TableView | undefined {
  return mine[tableKey] ?? org[tableKey];
}

/** The part of a view that is list state, as overrides onto the table's own initial. */
function stateFromView(view: TableView | undefined): Partial<ListState> {
  if (!view) return {};
  const next: Partial<ListState> = {};
  if (view.sortBy) next.sortBy = view.sortBy;
  if (view.sortDir) next.sortDir = view.sortDir;
  if (view.filters) next.filters = view.filters;
  return next;
}

export function useListResource<T>({
  resource,
  path,
  exportPath,
  initial,
  enabled = true,
}: UseListResourceOptions): ListResource<T> {
  const [state, setState] = useState<ListState>(() => remembered(resource, initial));

  // Whether this session had already been on this table when it was opened, noted
  // during render because the effect that writes the memory runs first — asked
  // afterwards, every table looks like one this session has already visited, and a
  // saved view would never be applied at all.
  const visited = useRef<Record<string, boolean>>({});
  visited.current[resource] ??= hasMemory(resource);

  // A different resource is a different memory slot. The slot was read once, at
  // mount, so a page whose resource settles a beat later — a linked view that has to
  // wait for the session to know who "me" is — kept the slot it started with and
  // never applied the view. Switching here, during render, is React's pattern for
  // state that follows a prop, and avoids a frame showing the wrong filters.
  const [slot, setSlot] = useState(resource);
  if (slot !== resource) {
    setSlot(resource);
    setState(remembered(resource, initial));
  }

  // Keep it for the trip to a record and back. Filters and sorting lived in this
  // component's own state, so opening a row unmounted the table and threw them
  // away — every question had to be asked again after reading one answer.
  useEffect(() => {
    remember(resource, state);
  }, [resource, state]);
  const { data: preferences } = useQuery(preferencesQuery);

  // Columns belong to the table, not to a particular view of it. A link that opens
  // the journal on one person — `journal:author:<id>` — keeps its own filters so it
  // neither inherits nor overwrites the team view's, but it is still the journal,
  // and the columns somebody chose for the journal must come with it. Keying them
  // by the full resource made every such link open on the defaults.
  const tableKey = resource.split(":")[0]!;

  // The same permission that governs every other installation setting. Read here
  // rather than in the table component, which would otherwise need a query client
  // for one menu item.
  const { data: session } = useQuery(sessionQuery);
  const maySetOrgDefault = session
    ? can(
        { permissions: session.permissions, isSuperadmin: session.isSuperadmin },
        PERMISSIONS.SETTINGS_MANAGE,
      )
    : false;

  const mine = preferences?.tableViews ?? {};
  const org = preferences?.orgTableViews ?? {};
  const view = viewFor(tableKey, mine, org);

  // Apply the saved view once the preferences arrive, unless this session has
  // already been on this table — what somebody did a moment ago beats what they
  // saved last week, or the table would snap back every time they came back from
  // reading a row. A named view (`journal:view:mine-waiting`) carries its own
  // filters in `initial`; those win too, because following a link that says
  // "waiting for review" and landing on last month's filter is not the link working.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!preferences || applied.current === resource) return;
    applied.current = resource;
    if (visited.current[resource]) return;
    const overrides = stateFromView(view);
    if (Object.keys(overrides).length === 0) return;
    setState((current) => ({ ...current, ...overrides, ...initial, page: 1 }));
    // `initial` is deliberately read without being a dependency: it is a fresh
    // object every render, and this is a once-per-resource effect guarded by the
    // ref above rather than one that should re-run when its caller re-renders.
  }, [preferences, resource, view, initial]);

  const query = useQuery({
    queryKey: [resource, "list", state],
    queryFn: () => fetchList<T>(path, state),
    enabled,
    // Holding the previous page on screen while the next loads avoids a
    // full-table spinner on every page change.
    placeholderData: keepPreviousData,
  });

  const update = useCallback((next: (current: ListState) => ListState) => setState(next), []);

  // How this person has arranged their tables, kept on the account rather than in
  // the browser: the same person wants the same layout on the plant machine and on
  // their laptop, and a shared machine must not hand one person's to the next.
  // Written debounced — the Columns menu is a row of checkboxes, and somebody
  // ticking four of them should cost one request, not four.
  const queryClient = useQueryClient();
  const setCached = useCallback(
    (views: TableViews) => {
      queryClient.setQueryData(preferencesQuery.queryKey, (current: MyPreferences | undefined) =>
        current ? { ...current, tableViews: views } : current,
      );
    },
    [queryClient],
  );

  const saveViews = useMutation({
    mutationFn: (all: TableViews) => saveMyTableViews(all),
    onSuccess: setCached,
  });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Merge a change into this person's own entry for this table, and save it. */
  const rememberView = useCallback(
    (patch: TableView) => {
      const all = { ...mine, [tableKey]: { ...mine[tableKey], ...patch } };
      // Shown immediately, saved shortly: the checkbox must not wait on a round
      // trip, and a failed save leaves the table working and simply forgetful.
      setCached(all);
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => saveViews.mutate(all), 500);
    },
    [mine, tableKey, setCached, saveViews],
  );

  const onColumnsChange = useCallback(
    (hidden: string[]) => rememberView({ hidden }),
    [rememberView],
  );

  // Sorting and filters are remembered too — asked for from use, and a reversal of
  // why they lived in session storage ("a filter is part of what somebody is doing
  // right now"). Both are true, which is why the session slot still exists: it keeps
  // a named view's filters apart within a visit, while this is the shape the table
  // opens in tomorrow.
  const rememberQuery = useCallback(
    (next: ListState) => {
      rememberView({ sortBy: next.sortBy ?? null, sortDir: next.sortDir, filters: next.filters });
    },
    [rememberView],
  );

  const saveOrg = useMutation({
    mutationFn: (all: TableViews) => saveOrgTableViews(all),
    onSuccess: (saved) => {
      queryClient.setQueryData(preferencesQuery.queryKey, (current: MyPreferences | undefined) =>
        current ? { ...current, orgTableViews: saved } : current,
      );
    },
  });

  const saveAsOrgDefault = useCallback(async () => {
    const entry: TableView = {
      hidden: view?.hidden ?? [],
      sortBy: state.sortBy ?? null,
      sortDir: state.sortDir,
      filters: state.filters,
    };
    await saveOrg.mutateAsync({ ...org, [tableKey]: entry });
  }, [org, saveOrg, state, tableKey, view]);

  const resetToOrgDefault = useCallback(async () => {
    const all = { ...mine };
    delete all[tableKey];
    setCached(all);
    await saveViews.mutateAsync(all);
    // Back to what everyone gets, right away rather than on the next visit: the
    // person just asked to see the default, and leaving their own filters on screen
    // would read as the reset having failed.
    forget(resource);
    setState({ ...initialListState, ...initial, ...stateFromView(org[tableKey]), page: 1 });
  }, [mine, tableKey, setCached, saveViews, resource, initial, org]);

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
      // Three fallbacks deep on purpose. `tableColumns` is where column choices
      // were kept before a view held all three parts together; a person who chose
      // columns under the old setting keeps them rather than being handed the
      // defaults back by an upgrade. Null still means "never chosen", which is not
      // the same as choosing to hide nothing, and is what lets a table's own
      // default apply.
      hiddenColumns: view?.hidden ?? preferences?.tableColumns?.[tableKey] ?? null,
      onColumnsChange,
      saveAsOrgDefault,
      resetToOrgDefault,
      hasOwnView: Boolean(mine[tableKey]),
      maySetOrgDefault,

      onPageChange: (page) => update((current) => setPage(current, page)),
      onPageSizeChange: (size) => update((current) => setPageSize(current, size)),
      // Sorting and filtering are remembered against the account as well as in the
      // session, so the table opens tomorrow the way it was left today.
      onSortChange: (column) =>
        update((current) => {
          const next = toggleSort(current, column);
          rememberQuery(next);
          return next;
        }),
      onFilterChange: (filter) =>
        update((current) => {
          const next = upsertFilter(current, filter);
          rememberQuery(next);
          return next;
        }),
      onFilterRemove: (field) =>
        update((current) => {
          const next = removeFilter(current, field);
          rememberQuery(next);
          return next;
        }),
      onFiltersClear: () =>
        update((current) => {
          const next = clearFilters(current);
          rememberQuery(next);
          return next;
        }),
      onExport: exportPath
        ? (format) => exportList(exportPath, state, format, exportFilename(resource, format))
        : undefined,
    }),
    [
      state,
      query,
      preferences,
      update,
      exportPath,
      resource,
      onColumnsChange,
      rememberQuery,
      maySetOrgDefault,
      saveAsOrgDefault,
      resetToOrgDefault,
      mine,
      tableKey,
      view,
    ],
  );
}
