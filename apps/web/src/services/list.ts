// Author: Brijesh Dave <https://github.com/brijeshdave>
// Generic access to any endpoint that speaks the standard list query. Resource
// services call these rather than reimplementing pagination per resource.
import type { PaginatedResult } from "@reportly/shared";

import { toQueryParams, type ListState } from "@/lib/list-query.js";
import { download, http } from "@/services/http.js";

export type ExportFormat = "csv" | "json";

/** One page of `path`, with the navigation metadata the API computes for us. */
export function fetchList<T>(path: string, state: ListState): Promise<PaginatedResult<T>> {
  return http.get<PaginatedResult<T>>(path, { query: toQueryParams(state) });
}

/**
 * Download every row matching the current filters — not just the visible page,
 * which is why this re-sends the query without `page`/`pageSize`.
 */
export function exportList(
  path: string,
  state: ListState,
  format: ExportFormat,
  filename: string,
): Promise<void> {
  const { page: _page, pageSize: _pageSize, ...rest } = toQueryParams(state);
  return download(path, filename, { query: { ...rest, format } });
}

/** `users-2026-07-09.csv` — dated so repeated exports don't overwrite. */
export function exportFilename(resource: string, format: ExportFormat, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `${resource}-${date}.${format}`;
}
