// Author: Brijesh Dave <https://github.com/brijeshdave>
// Loads the choices for an assignment picker from a paginated list endpoint.
// Pickers need every row, not a page, so this walks the pages the API reports.
import type { PaginatedResult } from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";

import { http } from "@/services/http.js";

/** The largest page the API will serve; see PAGE_SIZE_OPTIONS. */
const MAX_PAGE_SIZE = 100;
/** A guard against walking forever if the server keeps claiming another page. */
const MAX_PAGES = 50;

async function fetchAll<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;

  for (let visited = 0; visited < MAX_PAGES; visited += 1) {
    const result = await http.get<PaginatedResult<T> | T[]>(path, {
      query: { page, pageSize: MAX_PAGE_SIZE },
    });

    // A few endpoints return an already-complete, access-scoped array rather
    // than a page (locations belong to one company, so there is never a page 2).
    if (Array.isArray(result)) return result;

    rows.push(...result.data);
    if (!result.hasNext || result.nextPage === null) break;
    page = result.nextPage;
  }

  return rows;
}

/** Every row of `path`, cached under `resource`. Used to populate pickers. */
export function useOptions<T>(resource: string, path: string, enabled = true) {
  return useQuery({
    queryKey: [resource, "options"],
    queryFn: () => fetchAll<T>(path),
    enabled,
    staleTime: 60_000,
  });
}
