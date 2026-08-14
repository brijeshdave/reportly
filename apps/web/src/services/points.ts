// Author: Brijesh Dave <https://github.com/brijeshdave>
// The self-serve points calls: your ledger (one row per award) and the per-person
// summary, both over a chosen window and source, scoped server-side to your line.
import type {
  PointsLedgerResult,
  PointsSourceFilter,
  PointsSummaryResult,
  ReportRange,
} from "@reportly/shared";

import { http } from "@/services/http.js";

export interface PointsFilters {
  range: ReportRange;
  source: PointsSourceFilter;
  /** Only sent when `range` is `custom`. */
  from?: string;
  to?: string;
}

function query(filters: PointsFilters): Record<string, string | number | undefined> {
  return {
    range: filters.range,
    source: filters.source,
    from: filters.range === "custom" ? filters.from : undefined,
    to: filters.range === "custom" ? filters.to : undefined,
    // getTimezoneOffset() counts minutes west of UTC, so negate to match the server.
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
  };
}

export const fetchPointsLedger = (filters: PointsFilters) =>
  http.get<PointsLedgerResult>("/points/ledger", { query: query(filters) });

export const fetchPointsSummary = (filters: PointsFilters) =>
  http.get<PointsSummaryResult>("/points/summary", { query: query(filters) });
