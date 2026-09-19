// Author: Brijesh Dave <https://github.com/brijeshdave>
// Which columns a person has hidden, remembered against their account.
//
// Reported from use: "for all tables the selected columns to view is being reset on
// refresh. I want that to be preserevd for each user and each table." Filters, sort
// and page size were already kept; column visibility was plain component state in
// `DataTable`, seeded from the table's default and thrown away on unmount — so the
// one part of a table anybody deliberately curates was the one part that did not
// survive a refresh.
//
// Saved on the server rather than in the browser, which is the line this codebase
// already draws: the schedule grid's zoom is about the screen and stays local, and
// which columns you care about is about you. A plant machine is shared, so "for each
// user" has to mean the account.
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useListResource } from "@/hooks/use-list-resource.js";
import * as settings from "@/services/settings.js";

vi.mock("@/services/list.js", () => ({
  fetchList: vi.fn(async () => ({ data: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })),
  exportList: vi.fn(),
  exportFilename: vi.fn(() => "x.csv"),
}));

/** One client per test, so a cached preference cannot leak between them. */
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return { client, wrapper };
}

let saved: Record<string, string[]> | null;

beforeEach(() => {
  vi.useFakeTimers();
  saved = null;
  vi.spyOn(settings, "fetchMyPreferences").mockResolvedValue({
    theme: {} as never,
    tableDefaults: { pageSize: 20, density: "comfortable" } as never,
    tableColumns: {},
    toasts: {} as never,
  });
  vi.spyOn(settings, "saveMyTableColumns").mockImplementation(async (columns) => {
    saved = columns as Record<string, string[]>;
    return columns;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function mount(resource: string) {
  const { wrapper } = harness();
  return renderHook(() => useListResource({ resource, path: `/${resource}` }), { wrapper });
}

describe("a person's column choices", () => {
  it("reports 'not chosen' before they have chosen, so a table's own default can apply", async () => {
    const table = mount("journal");
    expect(table.result.current.hiddenColumns).toBeNull();
    // Null rather than an empty array on purpose: "hide nothing" is a real choice
    // and must be distinguishable from never having said anything, or a table's
    // default becomes impossible either to keep or to switch off.
    expect(table.result.current.hiddenColumns).not.toEqual([]);
  });

  it("saves the choice against the account, keyed by table", async () => {
    const table = mount("journal");
    act(() => table.result.current.onColumnsChange(["severityName", "points"]));
    // Shown at once, saved a moment later: the checkbox must not wait on a round
    // trip. Ticking four boxes should cost one request, not four.
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(saved).toEqual({ journal: ["severityName", "points"] });
  });

  it("keeps one table's choice out of another's", async () => {
    const journal = mount("journal");
    act(() => journal.result.current.onColumnsChange(["severityName"]));
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    // The setting holds every table at once, so writing one must not drop the rest.
    expect(saved).toEqual({ journal: ["severityName"] });
    expect(Object.keys(saved ?? {})).toHaveLength(1);
  });

  it("collapses a flurry of ticks into a single save", async () => {
    const table = mount("tasks");
    act(() => table.result.current.onColumnsChange(["a"]));
    act(() => table.result.current.onColumnsChange(["a", "b"]));
    act(() => table.result.current.onColumnsChange(["a", "b", "c"]));
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(settings.saveMyTableColumns).toHaveBeenCalledTimes(1);
    expect(saved).toEqual({ tasks: ["a", "b", "c"] });
  });
});
