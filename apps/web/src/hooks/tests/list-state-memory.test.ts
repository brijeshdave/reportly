// Author: Brijesh Dave <https://github.com/brijeshdave>
// A table remembers its filters while you read one of its rows.
//
// Reported from use: "from any table when i apply filters and open any records and
// go back it clears everything and i have apply all filters and sorting again".
// The state lived in the list component's own `useState`, so opening a row
// unmounted the table and threw it away — every question had to be asked again
// after reading one answer.
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useListResource } from "@/hooks/use-list-resource.js";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

afterEach(() => {
  sessionStorage.clear();
});

/** Mount a table, as opening the page does. */
function mount(resource: string, initial?: Record<string, unknown>) {
  return renderHook(
    () => useListResource({ resource, path: `/${resource}`, initial: initial as never }),
    { wrapper },
  );
}

describe("a table's filters", () => {
  it("come back when the table is opened again", () => {
    const first = mount("devices");
    act(() => {
      first.result.current.onFilterChange({ field: "status", op: "eq", value: "active" });
      // It toggles rather than taking a direction: once for ascending, again for
      // descending — which is what clicking a column header does.
      first.result.current.onSortChange("name");
    });
    act(() => first.result.current.onSortChange("name"));
    // Reading a row unmounts the table.
    first.unmount();

    const second = mount("devices");
    expect(second.result.current.state.filters).toContainEqual({
      field: "status",
      op: "eq",
      value: "active",
    });
    expect(second.result.current.state.sortBy).toBe("name");
    expect(second.result.current.state.sortDir).toBe("desc");
  });

  it("does not leak between two different tables", () => {
    const devices = mount("devices");
    act(() => {
      devices.result.current.onFilterChange({ field: "status", op: "eq", value: "active" });
    });
    devices.unmount();

    const users = mount("users");
    expect(users.result.current.state.filters).toEqual([]);
  });

  it("wins over the page's defaults, which are only a starting point", () => {
    // The journal opens on its own week and team. Once somebody has widened that,
    // coming back from an entry must not narrow it again behind them.
    const first = mount("journal", { filters: [{ field: "team", op: "eq", value: "direct" }] });
    act(() => {
      first.result.current.onFilterChange({ field: "team", op: "eq", value: "downline" });
    });
    first.unmount();

    const second = mount("journal", { filters: [{ field: "team", op: "eq", value: "direct" }] });
    expect(second.result.current.state.filters).toContainEqual({
      field: "team",
      op: "eq",
      value: "downline",
    });
  });
});
