// Author: Brijesh Dave <https://github.com/brijeshdave>
// Fills in the effective page size for a list request. Resolution order is the
// caller's own table setting -> the system default -> the registry default, so an
// omitted `pageSize` always yields the rows-per-page the user expects.
import { TABLE_DEFAULTS, type ListQuery, type ResolvedListQuery } from "@reportly/shared";

import { getEffectiveSetting } from "@/core/settings/service.js";

export async function resolveListQuery(
  query: ListQuery,
  userId?: string | null,
): Promise<ResolvedListQuery> {
  if (query.pageSize) return query as ResolvedListQuery;
  const defaults = await getEffectiveSetting(TABLE_DEFAULTS, { userId });
  return { ...query, pageSize: defaults.pageSize };
}
