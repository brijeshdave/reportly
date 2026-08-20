// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reliability and recurrence analytics. The business rules here are mostly about
// what NOT to claim: which numbers are undefined rather than zero, and which
// window a number is true of.
import {
  ANALYTICS_DEFAULT_WINDOW_DAYS,
  type AnalyticsWindow,
  type AssetReliability,
  type AssetReliabilityReport,
  ERROR_CODES,
  type RecurringIssue,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import {
  childAssets,
  downtimeFacts,
  getAsset,
  recurringIssues,
} from "@/features/analytics/repo.js";
import { scopeUnderAsset } from "@/features/journal/targets-repo.js";
import * as insightsRepo from "@/features/analytics/insights-repo.js";
import type { AuthContext } from "@reportly/shared";

const DAY_MS = 86_400_000;
const MINUTES_PER_HOUR = 60;

/**
 * Resolve the window an analytic is computed over.
 *
 * It is returned to the caller rather than merely used, because every number that
 * depends on it moves with it: MTBF over a week and MTBF over a year are both
 * correct and different. A figure whose window is invisible is a figure two people
 * will argue about.
 */
export function resolveWindow(query: { from?: string; to?: string }): AnalyticsWindow {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - ANALYTICS_DEFAULT_WINDOW_DAYS * DAY_MS);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Invalid analytics window");
  }
  if (from >= to) {
    // Not silently swapped: a caller who sent these the wrong way round has a bug,
    // and quietly "fixing" it would hand them plausible numbers for a window they
    // did not ask for.
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "`from` must be before `to`");
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    hours: (to.getTime() - from.getTime()) / 3_600_000,
  };
}

/**
 * Turn raw downtime facts into reliability figures.
 *
 * The nullable returns are the point of this function, and each is a refusal to
 * make something up:
 *
 * - **MTBF is null when nothing failed.** Not infinity, and emphatically not zero.
 *   An asset with no failures in the window has not proven itself reliable — it has
 *   not been measured. Zero would sort it as the worst thing in the plant; infinity
 *   would sort it as the best. Both are claims the data does not support.
 * - **MTTR is null when nothing closed.** The mean of no finished repairs is not
 *   zero minutes.
 * - **Availability is null when the window has no length**, which the window
 *   resolver already refuses, but the maths does not assume its caller.
 *
 * Operating time floors at zero: overlapping outages are counted per entry (two
 * things down at once is two failures), so total downtime can legitimately exceed
 * the window, and negative operating time is not a thing.
 */
export function reliabilityFrom(
  asset: { id: string; name: string },
  facts: {
    failures: number;
    openCount: number;
    totalDowntimeMinutes: number;
    mttrMinutes: number | null;
  },
  window: AnalyticsWindow,
): AssetReliability {
  const windowMinutes = window.hours * MINUTES_PER_HOUR;
  const operatingMinutes = Math.max(0, windowMinutes - facts.totalDowntimeMinutes);

  return {
    assetId: asset.id,
    assetName: asset.name,
    failures: facts.failures,
    openCount: facts.openCount,
    totalDowntimeMinutes: round(facts.totalDowntimeMinutes),
    operatingMinutes: round(operatingMinutes),
    mttrMinutes: facts.mttrMinutes === null ? null : round(facts.mttrMinutes),
    mtbfHours:
      facts.failures === 0 ? null : round(operatingMinutes / facts.failures / MINUTES_PER_HOUR),
    availabilityPct:
      windowMinutes === 0 ? null : round(Math.min(100, (operatingMinutes / windowMinutes) * 100)),
  };
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * One asset's reliability, plus each child's.
 *
 * Both the total and every child are computed over their **whole subtree** — the
 * asset, everything under it, and the devices standing at any of them — by reusing
 * `scopeUnderAsset`, the same walk the "issues under Line 3" roll-up uses. Reusing
 * it is not just tidiness: a second implementation of "what is under this asset"
 * would let the analytics and the report list disagree about the same line, and the
 * one people would believe is whichever they opened last.
 */
export async function assetReliability(
  ctx: AuthContext,
  assetId: string,
  companyId: string,
  query: { from?: string; to?: string },
): Promise<AssetReliabilityReport> {
  const window = resolveWindow(query);
  const asset = await getAsset(ctx, assetId, companyId);
  if (!asset) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Asset not found");

  const from = new Date(window.from);
  const to = new Date(window.to);

  const scope = await scopeUnderAsset(assetId, companyId);
  const total = reliabilityFrom(asset, await downtimeFacts(companyId, scope, from, to), window);

  const children = await childAssets(ctx, assetId, companyId);
  const childRows = await Promise.all(
    children.map(async (child) => {
      const childScope = await scopeUnderAsset(child.id, companyId);
      return reliabilityFrom(child, await downtimeFacts(companyId, childScope, from, to), window);
    }),
  );

  // Worst first — the thing costing the most time is the reason anyone opened this
  // page. Ties break on failure count, so "down once for a week" and "down 40 times
  // briefly" do not sort arbitrarily against each other.
  childRows.sort(
    (a, b) => b.totalDowntimeMinutes - a.totalDowntimeMinutes || b.failures - a.failures,
  );

  return { window, total, children: childRows };
}

/**
 * What keeps going wrong, worst first.
 *
 * `meanGapDays` is the span between first and last divided by the number of gaps
 * (count − 1), not by count: three occurrences have two gaps between them. The
 * off-by-one would understate every interval and make everything look more urgent
 * than it is.
 */
export async function recurring(
  companyId: string,
  query: { from?: string; to?: string; assetId?: string },
): Promise<{ window: AnalyticsWindow; items: RecurringIssue[] }> {
  const window = resolveWindow(query);
  const restrictTo = query.assetId ? await scopeUnderAsset(query.assetId, companyId) : undefined;

  const rows = await recurringIssues(
    companyId,
    new Date(window.from),
    new Date(window.to),
    restrictTo,
  );

  return {
    window,
    items: rows.map((r) => {
      const gaps = r.count - 1;
      const spanDays = (r.lastSeenAt.getTime() - r.firstSeenAt.getTime()) / DAY_MS;
      return {
        targetKind: r.targetKind as RecurringIssue["targetKind"],
        targetId: r.targetId,
        targetLabel: r.targetLabel,
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        count: r.count,
        firstSeenAt: r.firstSeenAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        meanGapDays: gaps > 0 ? round(spanDays / gaps) : null,
        latestReportId: r.latestReportId,
      };
    }),
  };
}

/**
 * Everything the Insights pages draw, in one call.
 *
 * The six aggregations run together rather than as six requests: they share a
 * window and a company, they are read as one picture, and staggering them would
 * make the page assemble itself on screen. `Promise.all` because none depends on
 * another's result.
 */
export async function insights(companyId: string, query: { from?: string; to?: string }) {
  const window = resolveWindow(query);
  const from = new Date(window.from);
  const to = new Date(window.to);

  const [
    issuesOverTime,
    issuesByCategory,
    downtimeByAsset,
    pointsByPerson,
    pointsByDepartment,
    entriesByStatus,
  ] = await Promise.all([
    insightsRepo.issuesOverTime(companyId, from, to),
    insightsRepo.issuesByCategory(companyId, from, to),
    insightsRepo.downtimeByAsset(companyId, from, to),
    insightsRepo.pointsByPerson(companyId, from, to),
    insightsRepo.pointsByDepartment(companyId, from, to),
    insightsRepo.entriesByStatus(companyId, from, to),
  ]);

  // The window travels with the figures. A chart that does not say what period it
  // covers invites the reader to assume the wrong one.
  return {
    window,
    issuesOverTime,
    issuesByCategory,
    downtimeByAsset,
    pointsByPerson,
    pointsByDepartment,
    entriesByStatus,
  };
}
