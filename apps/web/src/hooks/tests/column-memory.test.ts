// Author: Brijesh Dave <https://github.com/brijeshdave>
// How a table opens: the columns someone hides, the sort and filters they leave on
// it, and what an administrator has set for everyone who has not chosen.
//
// Reported from use: "for all tables the selected columns to view is being reset on
// refresh. I want that to be preserevd for each user and each table", and then
// "you can allow me to set this for all users in settings… If user do not have
// custom preferances it should follow what I have set in global settings for that
// table. Also same for the filters and sorting for all tables."
//
// Saved on the server rather than in the browser, which is the line this codebase
// already draws: the schedule grid's zoom is about the screen and stays local, and
// which columns you care about is about you. A plant machine is shared, so "for each
// user" has to mean the account.
//
// The part worth a test of its own is the inheritance: it is **per table**, not per
// setting. Every other user-overridable setting resolves to one value, and doing
// that here would mean somebody who arranged the journal silently opted out of every
// default an administrator set for every other table afterwards.
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useListResource } from "@/hooks/use-list-resource.js";
import { preferencesQuery } from "@/lib/queries.js";
import * as settings from "@/services/settings.js";
import type { MyPreferences } from "@/services/settings.js";

vi.mock("@/services/list.js", () => ({
  fetchList: vi.fn(async () => ({ data: [], page: 1, pageSize: 20, total: 0, totalPages: 0 })),
  exportList: vi.fn(),
  exportFilename: vi.fn(() => "x.csv"),
}));

/**
 * One client per test, so a cached preference cannot leak between them.
 *
 * The preferences are seeded into the cache rather than mocked at the service:
 * `preferencesQuery` captures `fetchMyPreferences` when the module loads, so a spy
 * installed afterwards is never the function the query calls. Seeding the cache is
 * also closer to what the hook actually sees.
 */
function harness(prefs: MyPreferences) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(preferencesQuery.queryKey, prefs);
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return { client, wrapper };
}

let saved: MyPreferences["tableViews"] | null;
let savedOrg: MyPreferences["tableViews"] | null;

/** The preferences this test's tables see: what the person set, and what the org did. */
function preferences(
  mine: MyPreferences["tableViews"] = {},
  org: MyPreferences["tableViews"] = {},
): MyPreferences {
  return {
    theme: {} as never,
    tableDefaults: { pageSize: 20, density: "comfortable" } as never,
    tableColumns: {},
    tableViews: mine,
    orgTableViews: org,
    toasts: {} as never,
  };
}

/** What every test starts from, until one says otherwise. */
let prefs: MyPreferences;

beforeEach(() => {
  vi.useFakeTimers();
  saved = null;
  savedOrg = null;
  prefs = preferences();
  vi.spyOn(settings, "saveMyTableViews").mockImplementation(async (views) => {
    saved = views;
    return views;
  });
  vi.spyOn(settings, "saveOrgTableViews").mockImplementation(async (views) => {
    savedOrg = views;
    return views;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function mount(resource: string) {
  const { wrapper } = harness(prefs);
  return renderHook(() => useListResource({ resource, path: `/${resource}` }), { wrapper });
}

/** Let the preferences query resolve, and any debounced save fire. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
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
    await settle();
    act(() => table.result.current.onColumnsChange(["severityName", "points"]));
    // Shown at once, saved a moment later: the checkbox must not wait on a round
    // trip. Ticking four boxes should cost one request, not four.
    await settle();
    expect(saved).toEqual({ journal: { hidden: ["severityName", "points"] } });
  });

  it("collapses a flurry of ticks into a single save", async () => {
    const table = mount("tasks");
    await settle();
    act(() => table.result.current.onColumnsChange(["a"]));
    act(() => table.result.current.onColumnsChange(["a", "b"]));
    act(() => table.result.current.onColumnsChange(["a", "b", "c"]));
    await settle();

    expect(settings.saveMyTableViews).toHaveBeenCalledTimes(1);
    expect(saved).toEqual({ tasks: { hidden: ["a", "b", "c"] } });
  });

  it("keeps sorting, so a table opens the way it was left", async () => {
    const table = mount("tasks");
    await settle();
    act(() => table.result.current.onSortChange("dueAt"));
    await settle();
    expect(saved?.tasks?.sortBy).toBe("dueAt");
  });
});

describe("the organisation's default", () => {
  it("applies to a table the person has not arranged", async () => {
    prefs = preferences({}, { journal: { hidden: ["severityName"], sortBy: "reportDate" } });
    const table = mount("journal");
    await settle();
    expect(table.result.current.hiddenColumns).toEqual(["severityName"]);
    expect(table.result.current.state.sortBy).toBe("reportDate");
  });

  it("keeps applying to the other tables when somebody arranges one", async () => {
    // The whole point of merging a table at a time. Resolved as one value — the way
    // every other user-overridable setting works — this person would have opted out
    // of the tasks default by touching the journal.
    prefs = preferences(
      { journal: { hidden: ["title"] } },
      { journal: { hidden: ["severityName"] }, tasks: { hidden: ["maxPoints"] } },
    );
    const journal = mount("journal");
    const tasks = mount("tasks");
    await settle();

    expect(journal.result.current.hiddenColumns).toEqual(["title"]);
    expect(tasks.result.current.hiddenColumns).toEqual(["maxPoints"]);
  });

  it("is written for one table without disturbing the others", async () => {
    prefs = preferences({}, { tasks: { hidden: ["maxPoints"] } });
    const journal = mount("journal");
    await settle();
    act(() => journal.result.current.onColumnsChange(["title"]));
    await settle();
    await act(async () => {
      await journal.result.current.saveAsOrgDefault();
    });

    expect(savedOrg?.tasks).toEqual({ hidden: ["maxPoints"] });
    expect(savedOrg?.journal?.hidden).toEqual(["title"]);
  });

  it("comes back when somebody resets their own arrangement", async () => {
    prefs = preferences(
      { journal: { hidden: ["title"] } },
      { journal: { hidden: ["severityName"] } },
    );
    const journal = mount("journal");
    await settle();
    expect(journal.result.current.hasOwnView).toBe(true);

    await act(async () => {
      await journal.result.current.resetToOrgDefault();
    });
    // Their own entry is gone from what was saved, so the organisation's applies
    // again — a reset that left the row behind would look identical to a failure.
    expect(saved).toEqual({});
  });
});
