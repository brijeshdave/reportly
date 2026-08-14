// Author: Brijesh Dave <https://github.com/brijeshdave>
// Tests for the standard list query and paginated result helper.
import { describe, expect, it } from "vitest";

import { PAGE_SIZE_OPTIONS, listQuerySchema, toPaginatedResult } from "@/http/pagination.js";

describe("listQuerySchema", () => {
  it("applies defaults for an empty query and leaves pageSize unset", () => {
    const q = listQuerySchema.parse({});
    expect(q).toMatchObject({ page: 1, sortDir: "asc", filters: [] });
    // pageSize is filled in by the server from the caller's effective setting.
    expect(q.pageSize).toBeUndefined();
    expect(q.sortBy).toBeUndefined();
  });

  it("accepts only the offered page sizes", () => {
    for (const size of PAGE_SIZE_OPTIONS) {
      expect(listQuerySchema.safeParse({ pageSize: size }).success).toBe(true);
    }
    expect(listQuerySchema.safeParse({ pageSize: 7 }).success).toBe(false);
    expect(listQuerySchema.safeParse({ pageSize: 1000 }).success).toBe(false);
  });

  it("coerces string page/pageSize from the query string", () => {
    expect(listQuerySchema.parse({ page: "3", pageSize: "50" })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });

  it("rejects a bad sort direction", () => {
    expect(listQuerySchema.safeParse({ sortDir: "sideways" }).success).toBe(false);
  });

  it("parses filters from a JSON-encoded string", () => {
    const q = listQuerySchema.parse({
      filters: JSON.stringify([{ field: "status", op: "eq", value: "active" }]),
    });
    expect(q.filters).toEqual([{ field: "status", op: "eq", value: "active" }]);
  });

  it("rejects an unknown filter operator", () => {
    const result = listQuerySchema.safeParse({
      filters: [{ field: "name", op: "matches", value: "x" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("toPaginatedResult", () => {
  it("computes totals and forward navigation on the first page", () => {
    expect(toPaginatedResult([1, 2], 21, { page: 1, pageSize: 20 })).toMatchObject({
      total: 21,
      totalPages: 2,
      page: 1,
      pageSize: 20,
      firstPage: 1,
      lastPage: 2,
      previousPage: null,
      nextPage: 2,
      hasPrevious: false,
      hasNext: true,
    });
  });

  it("computes backward navigation on the last page", () => {
    expect(toPaginatedResult([1], 21, { page: 2, pageSize: 20 })).toMatchObject({
      previousPage: 1,
      nextPage: null,
      hasPrevious: true,
      hasNext: false,
      lastPage: 2,
    });
  });

  it("keeps lastPage at 1 when there are no rows", () => {
    expect(toPaginatedResult([], 0, { page: 1, pageSize: 20 })).toMatchObject({
      total: 0,
      totalPages: 0,
      lastPage: 1,
      hasNext: false,
      hasPrevious: false,
    });
  });
});
