// Author: Brijesh Dave <https://github.com/brijeshdave>
// The self-serve points views. Both read the same ledger the leaderboard does, over a
// chosen window, and are scoped the same way: company-wide for an analytics viewer,
// otherwise the caller's own reporting line (so a plain Member sees only themselves).
// The ledger lists each award; the summary rolls them up per person.
import {
  ERROR_CODES,
  PERMISSIONS,
  can,
  type AuthContext,
  type PointsLedgerResult,
  type PointsLedgerRow,
  type PointsQuery,
  type PointsSummaryResult,
  type PointsSummaryRow,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { downlineUserIds } from "@/features/journal/hierarchy.js";
import * as repo from "@/features/points/repo.js";
import type { PointsLedgerRaw } from "@/features/points/repo.js";
import { resolveRange } from "@/features/reports/range.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The window and the beneficiaries a caller may see, shared by both views. */
async function scope(
  ctx: AuthContext,
  query: PointsQuery,
): Promise<{ companyId: string; from: Date; to: Date; visibleUserIds: string[] | null }> {
  if (!ctx.companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  const { from, to } = resolveRange(query, query.tzOffsetMinutes ?? 0);
  const companyWide = ctx.isSuperadmin || can(ctx, PERMISSIONS.ANALYTICS_VIEW);
  const visibleUserIds = companyWide ? null : [ctx.userId, ...(await downlineUserIds(ctx.userId))];
  return { companyId: ctx.companyId, from, to, visibleUserIds };
}

/**
 * What the row is *for*, in one line.
 *
 * A cartridge award names the part and the job; the compensating row a faulty
 * return writes says so in the same place, because a negative number on its own
 * reads as a mistake rather than a consequence.
 */
function detailOf(r: PointsLedgerRaw): string {
  if (r.source === "service") {
    const what = [r.serviceKindName, r.partIdentifier].filter(Boolean).join(" — ");
    if (!what) return "—";
    return r.reversesAwardId ? `${what} (reversed — came back faulty)` : what;
  }
  return r.routineTitle ?? r.journalTitle ?? "—";
}

/** Keep only the rows the source filter allows. */
function bySource(rows: PointsLedgerRaw[], source: PointsQuery["source"]): PointsLedgerRaw[] {
  return source === "all" ? rows : rows.filter((r) => r.source === source);
}

export async function ledger(ctx: AuthContext, query: PointsQuery): Promise<PointsLedgerResult> {
  const { companyId, from, to, visibleUserIds } = await scope(ctx, query);
  const raw = bySource(await repo.pointsLedger(companyId, from, to, visibleUserIds), query.source);
  const rows: PointsLedgerRow[] = raw.map((r) => ({
    id: r.id,
    date: r.earnedOn,
    source: r.source === "routine" ? "routine" : r.source === "service" ? "service" : "journal",
    detail: detailOf(r),
    person: r.userName,
    department: r.departmentName,
    kind: r.kind === "rollup" ? "rollup" : "direct",
    points: r.points,
  }));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    rows,
    total: round2(rows.reduce((s, r) => s + r.points, 0)),
  };
}

export async function summary(ctx: AuthContext, query: PointsQuery): Promise<PointsSummaryResult> {
  const { companyId, from, to, visibleUserIds } = await scope(ctx, query);
  const raw = bySource(await repo.pointsLedger(companyId, from, to, visibleUserIds), query.source);

  const people = new Map<string, { name: string; own: number; team: number }>();
  for (const r of raw) {
    const p = people.get(r.userId) ?? { name: r.userName, own: 0, team: 0 };
    if (r.kind === "rollup") p.team += r.points;
    else p.own += r.points;
    people.set(r.userId, p);
  }

  const rows: PointsSummaryRow[] = [...people]
    .map(([userId, p]) => ({
      userId,
      name: p.name,
      own: round2(p.own),
      team: round2(p.team),
      total: round2(p.own + p.team),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    rows,
    total: round2(rows.reduce((s, r) => s + r.total, 0)),
  };
}
