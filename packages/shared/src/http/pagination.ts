// Author: Brijesh Dave <https://github.com/brijeshdave>
// The one standard list query (pagination + sort + filter) and paginated result
// shape, reused by every server-side list endpoint and its web caller.
import { z } from "zod";

/**
 * Supported filter operators. `in`/`nin` take arrays; `between` takes a two-element
 * `[from, to]` array where either bound may be an empty string for an open end (the
 * date-range filter uses this); the rest take scalars.
 */
export const FILTER_OPS = [
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "nin",
  "between",
  "contains",
  "startsWith",
  "endsWith",
] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

export const filterSchema = z.object({
  field: z.string().min(1),
  op: z.enum(FILTER_OPS),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean()])),
  ]),
});

export type Filter = z.infer<typeof filterSchema>;

export const sortDirSchema = z.enum(["asc", "desc"]);
export type SortDir = z.infer<typeof sortDirSchema>;

/**
 * `filters` arrives either as a real array (JSON body) or a JSON-encoded string
 * (query string); normalize both to an array before validation.
 */
const filtersInput = z.preprocess((raw) => {
  if (typeof raw === "string") {
    if (raw.trim() === "") return [];
    try {
      return JSON.parse(raw);
    } catch {
      return raw; // let the array validator surface a clear error
    }
  }
  return raw ?? [];
}, z.array(filterSchema).default([]));

/** The rows-per-page choices offered everywhere: table pickers, settings, API. */
export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 20;

export const pageSizeSchema = z.coerce
  .number()
  .int()
  .refine((value): value is PageSize => (PAGE_SIZE_OPTIONS as readonly number[]).includes(value), {
    message: `pageSize must be one of ${PAGE_SIZE_OPTIONS.join(", ")}`,
  });

/**
 * `pageSize` is optional on the wire: when omitted the API applies the caller's
 * effective default (their own setting, else the system default).
 */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: pageSizeSchema.optional(),
  sortBy: z.string().min(1).optional(),
  sortDir: sortDirSchema.default("asc"),
  filters: filtersInput,
});

export type ListQuery = z.infer<typeof listQuerySchema>;

/** A list query after the server has filled in the effective page size. */
export type ResolvedListQuery = ListQuery & { pageSize: number };

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Navigation helpers so clients never recompute page maths. */
  firstPage: number;
  lastPage: number;
  previousPage: number | null;
  nextPage: number | null;
  hasPrevious: boolean;
  hasNext: boolean;
}

/** Build a Zod schema for a paginated response wrapping `item`. */
export function paginatedResult<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
    firstPage: z.number().int(),
    lastPage: z.number().int(),
    previousPage: z.number().int().nullable(),
    nextPage: z.number().int().nullable(),
    hasPrevious: z.boolean(),
    hasNext: z.boolean(),
  });
}

/** Derive totals and navigation metadata into a `PaginatedResult`. */
export function toPaginatedResult<T>(
  data: T[],
  total: number,
  query: Pick<ResolvedListQuery, "page" | "pageSize">,
): PaginatedResult<T> {
  const { page, pageSize } = query;
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  const lastPage = Math.max(totalPages, 1);
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return {
    data,
    page,
    pageSize,
    total,
    totalPages,
    firstPage: 1,
    lastPage,
    previousPage: hasPrevious ? page - 1 : null,
    nextPage: hasNext ? page + 1 : null,
    hasPrevious,
    hasNext,
  };
}
