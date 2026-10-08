// Author: Brijesh Dave <https://github.com/brijeshdave>
// Applies the shared standard list query (pagination + sort + filter) to a Drizzle
// query. Repositories pass a whitelist of filter/sort columns and the parsed
// query; this returns the WHERE/ORDER/LIMIT/OFFSET parts to fold into a select.
import type { Filter, ResolvedListQuery } from "@reportly/shared";
import {
  type AnyColumn,
  type SQL,
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";

export interface ListConfig {
  /** Field name -> column, whitelisting what can be sorted/filtered. */
  columns: Record<string, AnyColumn>;
  /** Column to sort by when the query omits sortBy. */
  defaultSort: AnyColumn;
  /**
   * Ordering expressions for fields whose stored value does not sort the way a
   * reader means it to — a status held as text is alphabetical, when what the word
   * describes is a sequence. Filtering still uses the real column; only ORDER BY
   * is rewritten, so a filter on the field keeps comparing the value people see.
   */
  sortAs?: Record<string, SQL>;
  /** Field name to sort by when the query omits sortBy; wins over `defaultSort`. */
  defaultSortBy?: string;
  /**
   * A second, stable ordering applied after the first.
   *
   * Worth setting wherever the primary sort has few distinct values: ordering a
   * register of three hundred cartridges by four statuses leaves the order within
   * each one up to the database, so rows move between pages as you page through.
   */
  tiebreak?: AnyColumn;
}

/** `""`/`null`/`undefined` mean "no bound"; used by the open-ended `between`. */
function isBlank(value: unknown): boolean {
  return value === "" || value === null || value === undefined;
}

/**
 * A timestamp column wants a `Date`, not the ISO string that arrives over the
 * wire — drizzle calls `.toISOString()` on the bound value, which a string does
 * not have. So coerce for date columns (a date-range filter is the common case);
 * every other column takes the value as-is.
 */
function coerce(column: AnyColumn, value: unknown): unknown {
  if (column.dataType === "date" && typeof value === "string" && value !== "") {
    return new Date(value);
  }
  return value;
}

function condition(column: AnyColumn, filter: Filter): SQL | undefined {
  const v = coerce(column, filter.value);
  const arr = Array.isArray(filter.value) ? filter.value.map((item) => coerce(column, item)) : [v];
  switch (filter.op) {
    case "eq":
      return eq(column, v);
    case "ne":
      return ne(column, v);
    case "lt":
      return lt(column, v);
    case "lte":
      return lte(column, v);
    case "gt":
      return gt(column, v);
    case "gte":
      return gte(column, v);
    case "in":
      return inArray(column, arr);
    case "nin":
      return notInArray(column, arr);
    case "between": {
      // `[from, to]`, either bound optional. A date range sends both; "since X"
      // sends only `from`, "until Y" only `to`. Both blank means no constraint.
      const raw = Array.isArray(filter.value) ? filter.value : [filter.value, undefined];
      const from = coerce(column, raw[0]);
      const to = coerce(column, raw[1]);
      const parts: SQL[] = [];
      if (!isBlank(raw[0])) parts.push(gte(column, from));
      if (!isBlank(raw[1])) parts.push(lte(column, to));
      return parts.length > 0 ? and(...parts) : undefined;
    }
    case "contains":
      return ilike(column, `%${String(v)}%`);
    case "startsWith":
      return ilike(column, `${String(v)}%`);
    case "endsWith":
      return ilike(column, `%${String(v)}`);
  }
}

export interface ListParts {
  where: SQL | undefined;
  orderBy: SQL;
  limit: number;
  offset: number;
}

export function buildListParts(config: ListConfig, query: ResolvedListQuery): ListParts {
  const conditions = query.filters
    .map((f) => {
      const column = config.columns[f.field];
      return column ? condition(column, f) : undefined;
    })
    .filter((c): c is SQL => c !== undefined);

  // The field being sorted on, whether it was asked for or defaulted to. Held as a
  // name rather than a column so `sortAs` can be consulted for it.
  const field = query.sortBy && config.columns[query.sortBy] ? query.sortBy : config.defaultSortBy;
  const target: AnyColumn | SQL =
    (field ? (config.sortAs?.[field] ?? config.columns[field]) : undefined) ?? config.defaultSort;

  const primary = query.sortDir === "desc" ? desc(target) : asc(target);
  // Composed into one expression rather than returned as a list: every caller
  // passes this straight to `.orderBy()`, and widening it to an array would mean
  // touching all of them to spread it.
  const orderBy =
    config.tiebreak && target !== config.tiebreak
      ? sql`${primary}, ${asc(config.tiebreak)}`
      : primary;

  return {
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  };
}
