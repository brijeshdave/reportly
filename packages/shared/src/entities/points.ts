// Author: Brijesh Dave <https://github.com/brijeshdave>
// The self-serve points views — a person's own points ledger and their team's, and a
// per-person summary. Both read the same source-aware points ledger the leaderboard
// does, over a chosen window, scoped to the caller's own reporting line (or the whole
// company for an analytics viewer). The report range presets are reused so the window
// controls read the same everywhere.
import { z } from "zod";

import { nameSchema } from "@/entities/common.js";
import { reportRangeSchema } from "@/entities/report-view.js";

/** Which awards the views count — everything, or just one source. */
export const POINTS_SOURCE_FILTERS = ["all", "journal", "routine", "service"] as const;
export type PointsSourceFilter = (typeof POINTS_SOURCE_FILTERS)[number];
export const pointsSourceFilterSchema = z.enum(POINTS_SOURCE_FILTERS);

export const POINTS_SOURCE_FILTER_LABELS: Record<PointsSourceFilter, string> = {
  all: "All sources",
  journal: "Journal",
  routine: "Routines",
  // Shown to everyone, even where the cartridges module is off: the filter then
  // finds nothing, which is a truthful empty answer. Hiding it per company would
  // mean the points screens knowing about a module they are otherwise free of.
  service: "Cartridges",
};

/** The window + source a points view is read over. Range presets resolve on the server. */
export const pointsQuerySchema = z.object({
  range: reportRangeSchema.default("this_fy"),
  /** Read only when `range` is `custom`. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  source: pointsSourceFilterSchema.default("all"),
  tzOffsetMinutes: z.coerce.number().int().min(-720).max(840).optional(),
});
export type PointsQuery = z.infer<typeof pointsQuerySchema>;

/** One award as it earned points — a row of the ledger. */
export const pointsLedgerRowSchema = z.object({
  id: z.string(),
  /** The day the points count for (YYYY-MM-DD). */
  date: z.string(),
  source: z.enum(["journal", "routine", "service"]),
  /** The journal entry's title, the routine's title, or the part and what was done to it. */
  detail: z.string(),
  /** Who earned them. */
  person: nameSchema,
  department: z.string().nullable(),
  /** Directly earned, or rolled up from the downline. */
  kind: z.enum(["direct", "rollup"]),
  points: z.number(),
});
export type PointsLedgerRow = z.infer<typeof pointsLedgerRowSchema>;

export const pointsLedgerResultSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  rows: z.array(pointsLedgerRowSchema),
  total: z.number(),
});
export type PointsLedgerResult = z.infer<typeof pointsLedgerResultSchema>;

/** One person's totals over the window — own, rolled-up team, and their sum. */
export const pointsSummaryRowSchema = z.object({
  userId: z.string(),
  name: nameSchema,
  own: z.number(),
  team: z.number(),
  total: z.number(),
});
export type PointsSummaryRow = z.infer<typeof pointsSummaryRowSchema>;

export const pointsSummaryResultSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  rows: z.array(pointsSummaryRowSchema),
  total: z.number(),
});
export type PointsSummaryResult = z.infer<typeof pointsSummaryResultSchema>;
