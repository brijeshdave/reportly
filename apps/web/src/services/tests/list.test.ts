// Author: Brijesh Dave <https://github.com/brijeshdave>
// An export must cover every row matching the filters, not just the page on
// screen — the easiest way to get this wrong is to forward the pagination params.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialListState, setPage, setPageSize, toggleSort } from "@/lib/list-query.js";
import { exportFilename, exportList, fetchList } from "@/services/list.js";

let requestedUrl = "";

beforeEach(() => {
  requestedUrl = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requestedUrl = String(url);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  // download() reaches for object URLs and an anchor click; jsdom has neither.
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const params = () => new URL(requestedUrl, "http://localhost").searchParams;

describe("fetchList", () => {
  it("sends the whole list query", async () => {
    const state = setPageSize(toggleSort(setPage(initialListState, 3), "name"), 50);
    await fetchList("/users", state);

    expect(requestedUrl).toContain("/api/v1/users");
    expect(params().get("pageSize")).toBe("50");
    expect(params().get("sortBy")).toBe("name");
  });
});

describe("exportList", () => {
  it("keeps the filters and sort but drops the pagination", async () => {
    const state = {
      ...setPage(initialListState, 4),
      pageSize: 50 as const,
      sortBy: "name",
      sortDir: "desc" as const,
      filters: [{ field: "status", op: "eq" as const, value: "active" }],
    };

    await exportList("/users/export", state, "csv", "users.csv");

    expect(params().get("page")).toBeNull();
    expect(params().get("pageSize")).toBeNull();
    expect(params().get("sortBy")).toBe("name");
    expect(params().get("format")).toBe("csv");
    expect(params().get("filters")).toBe('[{"field":"status","op":"eq","value":"active"}]');
  });
});

describe("exportFilename", () => {
  it("dates the file so repeated exports don't overwrite", () => {
    expect(exportFilename("users", "csv", new Date("2026-07-09T10:00:00Z"))).toBe(
      "users-2026-07-09.csv",
    );
    expect(exportFilename("audit-events", "json", new Date("2026-01-02T00:00:00Z"))).toBe(
      "audit-events-2026-01-02.json",
    );
  });
});
