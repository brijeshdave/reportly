// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reports service — running a report (gather rows, group, subtotal) and managing the
// saved report views (list/get/create/update/delete/clone), with the system-view
// and access rules enforced here rather than in the routes.
import { eq } from "drizzle-orm";
import {
  type AuthContext,
  type CreateReportView,
  type ReportDefinition,
  type ReportGroup,
  type ReportGrouping,
  type ReportResult,
  type ReportRow,
  type ReportTotals,
  type ReportView,
  type LeaderboardQuery,
  type LeaderboardResult,
  type RunReport,
  type UpdateReportView,
  ALL_REPORT_COLUMN_LABELS,
  DOWNTIME_COLUMNS,
  LEADERBOARD_COLUMNS,
  MAX_CUSTOM_RANGE_DAYS,
  PERMISSIONS,
  RELIABILITY_COLUMNS,
  RELIABILITY_DEVICE_COLUMNS,
  RELIABILITY_MONTHLY_COLUMNS,
  REPORT_COLUMNS,
  ROUTINE_COMPLIANCE_COLUMNS,
  ROUTINE_LOG_COLUMNS,
  SHIFT_ATTENDANCE_COLUMNS,
  SHIFT_CHANGE_COLUMNS,
  SHIFT_COVERAGE_COLUMNS,
  SHIFT_ROSTER_COLUMNS,
  ERROR_CODES,
  can,
  isOnTime,
  occurrenceDates,
  shiftDurationMinutes,
  formatDate,
  formatDateTime,
  formatDurationMinutes,
  reportDefinitionSchema,
  PARTS_MODULE,
  PART_CONSUMPTION_COLUMNS,
  PART_FAILURE_COLUMNS,
  PART_HEALTH_COLUMNS,
  PART_REGISTER_COLUMNS,
  PART_WORKLOAD_COLUMNS,
  PART_SERVICE_COLUMNS,
  PART_STATUS_LABELS,
  PRINTER_HEALTH_COLUMNS,
  isPartSource,
  meanPages,
  sourceSupportsPerson,
  pagesFor,
  yieldPercent,
  type PartStatus,
  REPORT_VIEW_PERMISSION,
  type ReportSource,
} from "@reportly/shared";
import type { AssetReliability } from "@reportly/shared";

import { withLocationsNullable } from "@/core/db/scoped.js";
import { getEffectiveSetting } from "@/core/settings/service.js";
import * as partsRepo from "@/features/reports/parts-repo.js";
import { db } from "@/core/db/index.js";
import { companies, journalEntries } from "@/core/db/schema.js";
import { AppError } from "@/core/errors.js";
import type { JournalEntryRowRaw } from "@/features/journal/repo.js";
import { downlineUserIds } from "@/features/journal/hierarchy.js";
import { changesForReport } from "@/features/shifts/change-log-repo.js";
import { entriesInWindow } from "@/features/shifts/schedule-repo.js";
import { listShifts } from "@/features/shifts/repo.js";
import { departmentsForUser, getDepartment } from "@/features/departments/repo.js";
import { allRoutines, assigneesFor, managedBy } from "@/features/routines/repo.js";
import type { RoutineRow } from "@/features/routines/repo.js";
import { completionsForRoutines } from "@/features/routines/completion-repo.js";
import { assetReliability, reliabilityFrom, resolveWindow } from "@/features/analytics/service.js";
import { downtimeFacts } from "@/features/analytics/repo.js";
import { avatarVersions } from "@/features/avatars/repo.js";

import { financialYearWindow, monthBuckets, resolveRange } from "./range.js";
import * as repo from "./repo.js";

type EnrichedRow = JournalEntryRowRaw & { points: number | null; assetLabels: string[] };

const EMPTY_TOTALS: ReportTotals = { count: 0, durationMinutes: 0, downtimeMinutes: 0, points: 0 };

/** What each source producer returns; `runReport` wraps it in the shared meta. */
interface SourceResult {
  groups: ReportGroup[];
  totals: ReportTotals;
  columns: readonly string[];
  assetName: string | null;
}

// --- running a report ---

/**
 * Run a report and return its grouped result. A `viewId` loads a saved definition;
 * an inline `definition` overrides it. The source decides where the rows come from —
 * the journal, downtime entries, or the reliability roll-up — and every one is
 * gathered under the caller's own scope, so a report never widens what they may see.
 */
/**
 * The permission for *this* report, checked once the definition is known.
 *
 * It cannot be a route guard: which report is being run arrives in the body, and a
 * saved view names its own source. So the route authenticates and this decides —
 * the same place the definition is resolved, so the two can never disagree about
 * which report is being answered.
 */
/**
 * The report a saved view runs. Stored inside its definition json, so it is read
 * defensively: a view written before a source existed, or by hand, must not throw
 * its way through a list.
 */
function sourceOfView(view: { definition: unknown }): string | null {
  const def = view.definition as { source?: unknown } | null;
  return typeof def?.source === "string" ? def.source : null;
}

/** Whether the caller holds this report's key. The soft form, for filtering lists. */
export function mayReadSource(ctx: AuthContext, source: string | null): boolean {
  if (source === null) return false;
  const key = REPORT_VIEW_PERMISSION[source as ReportSource];
  return key !== undefined && can(ctx, key);
}

export function assertMayRead(ctx: AuthContext, source: ReportSource): void {
  if (!mayReadSource(ctx, source)) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "Insufficient permissions");
  }
}

export async function runReport(
  ctx: AuthContext,
  run: RunReport,
  tzOffsetMinutes: number,
): Promise<ReportResult> {
  const { definition, view } = await resolveDefinition(ctx, run);
  assertMayRead(ctx, definition.source);
  // A custom range is capped by source — a month for the detail sources, a year for
  // reliability. The named presets are never capped.
  const { from, to } = resolveRange(
    definition,
    tzOffsetMinutes,
    new Date(),
    MAX_CUSTOM_RANGE_DAYS[definition.source],
  );

  const source =
    definition.source === "downtime"
      ? await runDowntime(ctx, definition, from, to, tzOffsetMinutes)
      : definition.source === "reliability"
        ? await runReliability(ctx, definition, from, to, tzOffsetMinutes)
        : definition.source === "leaderboard"
          ? await runLeaderboard(ctx, definition, from, to)
          : definition.source === "shift_changes"
            ? await runShiftChanges(ctx, definition, from, to)
            : definition.source === "shift_roster"
              ? await runShiftRoster(ctx, definition, from, to)
              : definition.source === "shift_coverage"
                ? await runShiftCoverage(ctx, definition, from, to)
                : definition.source === "shift_attendance"
                  ? await runShiftAttendance(ctx, definition, from, to)
                  : definition.source === "routine_log"
                    ? await runRoutineLog(ctx, from, to)
                    : definition.source === "routine_compliance"
                      ? await runRoutineCompliance(ctx, from, to)
                      : isPartSource(definition.source)
                        ? await runCartridges(ctx, definition, from, to)
                        : await runJournal(ctx, definition, from, to, tzOffsetMinutes);

  const companyName = ctx.companyId ? await companyNameOf(ctx.companyId) : null;

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      from: from.toISOString(),
      to: to.toISOString(),
      // The window is [from, to); the last day actually in it is to − 1ms.
      toInclusive: new Date(to.getTime() - 1).toISOString(),
      range: definition.range,
      source: definition.source,
      grouping: definition.grouping,
      columns: [...source.columns],
      columnLabels: source.columns.map((c) => ALL_REPORT_COLUMN_LABELS[c] ?? c),
      viewId: view?.id ?? null,
      viewName: view?.name ?? null,
      companyName,
      assetName: source.assetName,
    },
    groups: source.groups,
    totals: source.totals,
  };
}

// --- journal source ---

async function runJournal(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
  tz: number,
): Promise<SourceResult> {
  const visibleAuthorIds = ctx.isSuperadmin
    ? null
    : [ctx.userId, ...(await downlineUserIds(ctx.userId))];

  const rawRows = await repo.reportRows(
    definition,
    from,
    to,
    ctx.userId,
    visibleAuthorIds,
    ctx.companyId,
    withLocationsNullable(ctx, journalEntries.locationId),
  );

  const ids = rawRows.map((r) => r.id);
  const [points, assetLabels] = await Promise.all([
    repo.pointsByReport(ids),
    repo.assetLabelsByReport(ids),
  ]);
  const enriched: EnrichedRow[] = rawRows.map((r) => ({
    ...r,
    points: points.get(r.id) ?? null,
    assetLabels: assetLabels.get(r.id) ?? [],
  }));

  const columns = definition.columns.length > 0 ? definition.columns : [...REPORT_COLUMNS];
  return {
    groups: groupJournal(enriched, definition.grouping, tz),
    totals: journalTotals(enriched),
    columns,
    assetName: null,
  };
}

// --- downtime source ---

async function runDowntime(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
  tz: number,
): Promise<SourceResult> {
  const visibleAuthorIds = ctx.isSuperadmin
    ? null
    : [ctx.userId, ...(await downlineUserIds(ctx.userId))];
  const scopeTargetIds = definition.assetId
    ? await repo.assetSubtreeTargetIds(definition.assetId, ctx.companyId)
    : null;

  const rows = await repo.downtimeRows(
    from,
    to,
    ctx.userId,
    visibleAuthorIds,
    ctx.companyId,
    withLocationsNullable(ctx, journalEntries.locationId),
    scopeTargetIds,
  );

  const assetName = definition.assetId
    ? await repo.assetNameOf(definition.assetId, ctx.companyId)
    : null;

  return {
    groups: groupDowntime(rows, definition.grouping, tz),
    totals: downtimeTotals(rows),
    columns: DOWNTIME_COLUMNS,
    assetName,
  };
}

// --- reliability source ---

async function runReliability(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
  tz: number,
): Promise<SourceResult> {
  if (!ctx.companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  if (definition.monthly) return runReliabilityMonthly(ctx, definition, from, to, tz);
  if (definition.byDevice) return runReliabilityByDevice(ctx, definition, from, to);

  const window = { from: from.toISOString(), to: to.toISOString() };

  let items: AssetReliability[];
  let assetName: string | null = null;
  if (definition.assetId) {
    // One asset: itself (its whole subtree) plus each child broken out.
    const report = await assetReliability(ctx, definition.assetId, ctx.companyId, window);
    assetName = report.total.assetName;
    items = [report.total, ...report.children];
  } else {
    // Whole company: one row per root asset (each its own subtree total).
    const roots = await repo.rootAssets(ctx, ctx.companyId);
    items = [];
    for (const root of roots) {
      const report = await assetReliability(ctx, root.id, ctx.companyId, window);
      items.push(report.total);
    }
  }

  const rows: ReportRow[] = items.map((a) => ({
    id: a.assetId,
    reportId: null,
    cells: reliabilityCells(a),
  }));
  const totals: ReportTotals = { ...EMPTY_TOTALS, count: rows.length };
  return {
    groups: [
      { key: null, label: assetName ? `${assetName} — breakdown` : "All assets", rows, totals },
    ],
    totals,
    columns: RELIABILITY_COLUMNS,
    assetName,
  };
}

/**
 * Reliability month by month for one asset (its subtree) — the trend view. One row
 * per calendar month in the window (capped at a year by the range cap and the bucket
 * cap). No asset chosen falls back to the first root, so the report always shows
 * something.
 */
async function runReliabilityMonthly(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
  tz: number,
): Promise<SourceResult> {
  let assetId = definition.assetId ?? null;
  // No initialiser: both branches below assign it, so TypeScript's definite
  // assignment check is the thing proving it is set, rather than a `null` that
  // is always overwritten.
  let assetName: string | null;
  if (assetId) {
    assetName = await repo.assetNameOf(assetId, ctx.companyId!);
  } else {
    const [firstRoot] = await repo.rootAssets(ctx, ctx.companyId!);
    assetId = firstRoot?.id ?? null;
    assetName = firstRoot?.name ?? null;
  }

  const rows: ReportRow[] = [];
  if (assetId) {
    for (const bucket of monthBuckets(from, to, tz)) {
      const report = await assetReliability(ctx, assetId, ctx.companyId!, {
        from: bucket.from.toISOString(),
        to: bucket.to.toISOString(),
      });
      rows.push({
        id: bucket.key,
        reportId: null,
        cells: { ...reliabilityCells(report.total), month: bucket.label },
      });
    }
  }
  const totals: ReportTotals = { ...EMPTY_TOTALS, count: rows.length };
  return {
    groups: [
      { key: null, label: assetName ? `${assetName} — by month` : "By month", rows, totals },
    ],
    totals,
    columns: RELIABILITY_MONTHLY_COLUMNS,
    assetName,
  };
}

/**
 * Reliability per device — which machine is failing, not which line. One row per
 * device under the chosen asset (or every device in the company), each computed from
 * the downtime targeted at that device over the window. Reuses the analytics
 * building blocks so a device's figures here match what the asset roll-up folds in.
 */
async function runReliabilityByDevice(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
): Promise<SourceResult> {
  const window = resolveWindow({ from: from.toISOString(), to: to.toISOString() });
  const assetName = definition.assetId
    ? await repo.assetNameOf(definition.assetId, ctx.companyId!)
    : null;
  const devices = await repo.devicesForReliability(ctx, ctx.companyId!, definition.assetId ?? null);

  const rows: ReportRow[] = [];
  for (const device of devices) {
    const facts = await downtimeFacts(
      ctx.companyId!,
      { assetIds: [], deviceIds: [device.id] },
      from,
      to,
    );
    const rel = reliabilityFrom({ id: device.id, name: device.name }, facts, window);
    // reliabilityCells keys the name under "asset"; the device columns read "device".
    rows.push({
      id: device.id,
      reportId: null,
      cells: { ...reliabilityCells(rel), device: device.name },
    });
  }
  const totals: ReportTotals = { ...EMPTY_TOTALS, count: rows.length };
  return {
    groups: [
      { key: null, label: assetName ? `${assetName} — by device` : "Every device", rows, totals },
    ],
    totals,
    columns: RELIABILITY_DEVICE_COLUMNS,
    assetName,
  };
}

// --- leaderboard source ---

/**
 * A performance leaderboard: people ranked by the points they earned in the window,
 * from the same ledger `pointsFor` reads (so a total matches "my points"). Each
 * person's total is their own points plus the decaying rollup from their downline.
 *
 * Who appears is by permission: a holder of `analytics:view` (the company-wide
 * aggregate grant, which Managers have) sees everyone; anyone else with `reports:view`
 * sees only their own reporting line, so the blind-upward rule is not widened for
 * roles that were never given the company view. Grouped "by department" attributes
 * points to the department the entry was filed under, and ranks within each.
 */
async function runLeaderboard(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
): Promise<SourceResult> {
  if (!ctx.companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  const companyWide = ctx.isSuperadmin || can(ctx, PERMISSIONS.ANALYTICS_VIEW);
  const visibleUserIds = companyWide ? null : [ctx.userId, ...(await downlineUserIds(ctx.userId))];

  const raw = await repo.leaderboardRows(ctx, ctx.companyId, from, to, visibleUserIds);
  const byDept = definition.grouping === "department";

  // Collapse the (person, department) rows to the level we rank at.
  type Tally = { userId: string; name: string; own: number; team: number };
  const buckets = new Map<
    string,
    { key: string | null; label: string; people: Map<string, Tally> }
  >();
  for (const r of raw) {
    const groupKey = byDept ? r.departmentId : null;
    const groupLabel = byDept ? (r.departmentName ?? "No department") : "Leaderboard";
    const bucketKey = groupKey ?? `∅:${groupLabel}`;
    const bucket = buckets.get(bucketKey) ?? {
      key: groupKey,
      label: groupLabel,
      people: new Map(),
    };
    const person = bucket.people.get(r.userId) ?? {
      userId: r.userId,
      name: r.name,
      own: 0,
      team: 0,
    };
    person.own += r.own;
    person.team += r.team;
    bucket.people.set(r.userId, person);
    buckets.set(bucketKey, bucket);
  }

  const groups: ReportGroup[] = [...buckets.values()].map((b) => {
    const ranked = [...b.people.values()]
      .map((p) => ({ ...p, total: round2(p.own + p.team) }))
      .sort((a, b2) => b2.total - a.total || a.name.localeCompare(b2.name));
    // Standard competition ranking: equal totals share a rank.
    let lastTotal = Number.NaN;
    let lastRank = 0;
    const rows: ReportRow[] = ranked.map((p, i) => {
      const rank = p.total === lastTotal ? lastRank : i + 1;
      lastTotal = p.total;
      lastRank = rank;
      return {
        id: p.userId,
        reportId: null,
        cells: {
          rank: String(rank),
          person: p.name,
          points: String(round2(p.total)),
          own: String(round2(p.own)),
          team: String(round2(p.team)),
        },
      };
    });
    const points = round2(ranked.reduce((s, p) => s + p.total, 0));
    return {
      key: b.key,
      label: b.label,
      rows,
      totals: { ...EMPTY_TOTALS, count: rows.length, points },
    };
  });
  groups.sort((a, b) => a.label.localeCompare(b.label));

  const totalPeople = new Set(raw.map((r) => r.userId)).size;
  const totalPoints = round2(raw.reduce((s, r) => s + r.own + r.team, 0));
  return {
    groups,
    totals: { ...EMPTY_TOTALS, count: totalPeople, points: totalPoints },
    columns: LEADERBOARD_COLUMNS,
    assetName: null,
  };
}

// --- shift-schedule sources (scoped to one department) ---

/**
 * A reader may see a department's schedule reports if they belong to it, or hold
 * shifts:manage (a scheduler, company-wide) — matching the calendar's own read scope.
 */
async function assertDepartmentReadable(ctx: AuthContext, departmentId: string): Promise<void> {
  if (ctx.isSuperadmin || can(ctx, PERMISSIONS.SHIFTS_MANAGE)) return;
  const mine = await departmentsForUser(ctx.userId);
  if (!mine.some((d) => d.departmentId === departmentId)) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You are not in this department");
  }
}

/** The shift-change history: one row per logged change to a department's schedule. */
async function runShiftChanges(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
): Promise<SourceResult> {
  if (!ctx.companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  const departmentId = definition.departmentId;
  if (!departmentId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a department for this report");
  }
  await assertDepartmentReadable(ctx, departmentId);

  const dept = await getDepartment(departmentId, ctx.companyId);
  const changes = await changesForReport(ctx, ctx.companyId, departmentId, from, to);
  const rows: ReportRow[] = changes.map((c, i) => ({
    id: String(i),
    reportId: null,
    cells: {
      date: c.date ? formatDate(`${c.date}T00:00:00`) : "—",
      person: c.subjectName ?? "—",
      change: c.fromLabel && c.toLabel ? `${c.fromLabel} → ${c.toLabel}` : "—",
      action: c.action,
      actor: c.actorName ?? "—",
    },
  }));
  return {
    groups: [
      {
        key: null,
        label: dept?.name ?? "Shift changes",
        rows,
        totals: { ...EMPTY_TOTALS, count: rows.length },
      },
    ],
    totals: { ...EMPTY_TOTALS, count: rows.length },
    columns: SHIFT_CHANGE_COLUMNS,
    assetName: null,
  };
}

/** Resolve the company + department + read scope shared by every shift source. */
async function shiftReportScope(
  ctx: AuthContext,
  definition: ReportDefinition,
): Promise<{ companyId: string; departmentId: string; departmentName: string }> {
  if (!ctx.companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  const departmentId = definition.departmentId;
  if (!departmentId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a department for this report");
  }
  await assertDepartmentReadable(ctx, departmentId);
  const dept = await getDepartment(departmentId, ctx.companyId);
  return { companyId: ctx.companyId, departmentId, departmentName: dept?.name ?? "Schedule" };
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** The roster: one row per working assignment in the window — who works which shift when. */
async function runShiftRoster(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
): Promise<SourceResult> {
  const { companyId, departmentId, departmentName } = await shiftReportScope(ctx, definition);
  const entries = await entriesInWindow(ctx, companyId, departmentId, dayOf(from), dayOf(to));
  const rows: ReportRow[] = entries
    .filter((e) => e.state === "working" && e.shiftId)
    .map((e, i) => ({
      id: String(i),
      reportId: null,
      cells: {
        date: formatDate(`${e.date}T00:00:00`),
        person: e.userName,
        shift: e.shiftName ?? "—",
        hours:
          e.startMinute !== null && e.endMinute !== null
            ? String(shiftDurationMinutes(e.startMinute, e.endMinute) / 60)
            : "—",
      },
    }));
  return {
    groups: [
      { key: null, label: departmentName, rows, totals: { ...EMPTY_TOTALS, count: rows.length } },
    ],
    totals: { ...EMPTY_TOTALS, count: rows.length },
    columns: SHIFT_ROSTER_COLUMNS,
    assetName: null,
  };
}

/** Coverage: one row per (scheduled day, active shift) — how many are on it, and gaps. */
async function runShiftCoverage(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
): Promise<SourceResult> {
  const { companyId, departmentId, departmentName } = await shiftReportScope(ctx, definition);
  const entries = await entriesInWindow(ctx, companyId, departmentId, dayOf(from), dayOf(to));
  const activeShifts = (await listShifts(companyId)).filter((s) => s.status === "active");

  // date -> shiftId -> count of working assignments; and the days actually scheduled.
  const worked = new Map<string, Map<string, number>>();
  const days = new Set<string>();
  for (const e of entries) {
    days.add(e.date);
    if (e.state === "working" && e.shiftId) {
      const byShift = worked.get(e.date) ?? new Map<string, number>();
      byShift.set(e.shiftId, (byShift.get(e.shiftId) ?? 0) + 1);
      worked.set(e.date, byShift);
    }
  }

  const rows: ReportRow[] = [];
  for (const date of [...days].sort()) {
    for (const shift of activeShifts) {
      const assigned = worked.get(date)?.get(shift.id) ?? 0;
      rows.push({
        id: `${date}:${shift.id}`,
        reportId: null,
        cells: {
          date: formatDate(`${date}T00:00:00`),
          shift: shift.name,
          assigned: String(assigned),
          status: assigned > 0 ? "Covered" : "Uncovered",
        },
      });
    }
  }
  return {
    groups: [
      { key: null, label: departmentName, rows, totals: { ...EMPTY_TOTALS, count: rows.length } },
    ],
    totals: { ...EMPTY_TOTALS, count: rows.length },
    columns: SHIFT_COVERAGE_COLUMNS,
    assetName: null,
  };
}

/** Attendance: one row per person — working days, offs, leaves, holidays, and doubles. */
async function runShiftAttendance(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
): Promise<SourceResult> {
  const { companyId, departmentId, departmentName } = await shiftReportScope(ctx, definition);
  const entries = await entriesInWindow(ctx, companyId, departmentId, dayOf(from), dayOf(to));

  type Tally = {
    name: string;
    working: number;
    off: number;
    leave: number;
    holiday: number;
    workByDay: Map<string, number>;
  };
  const people = new Map<string, Tally>();
  for (const e of entries) {
    const t = people.get(e.userId) ?? {
      name: e.userName,
      working: 0,
      off: 0,
      leave: 0,
      holiday: 0,
      workByDay: new Map(),
    };
    if (e.state === "working") {
      t.working += 1;
      t.workByDay.set(e.date, (t.workByDay.get(e.date) ?? 0) + 1);
    } else if (e.state === "off") t.off += 1;
    else if (e.state === "leave") t.leave += 1;
    else if (e.state === "holiday") t.holiday += 1;
    people.set(e.userId, t);
  }

  const rows: ReportRow[] = [...people.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t, i) => ({
      id: String(i),
      reportId: null,
      cells: {
        person: t.name,
        working: String(t.working),
        off: String(t.off),
        leave: String(t.leave),
        holiday: String(t.holiday),
        doubles: String([...t.workByDay.values()].filter((n) => n >= 2).length),
      },
    }));
  return {
    groups: [
      { key: null, label: departmentName, rows, totals: { ...EMPTY_TOTALS, count: rows.length } },
    ],
    totals: { ...EMPTY_TOTALS, count: rows.length },
    columns: SHIFT_ATTENDANCE_COLUMNS,
    assetName: null,
  };
}

// --- routine sources (the caller's own team routines) ---

/** The routines the caller manages (or all, for a superadmin) — the routine reports' scope. */
async function managedRoutines(ctx: AuthContext): Promise<RoutineRow[]> {
  if (!ctx.companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  return ctx.isSuperadmin ? allRoutines(ctx.companyId) : managedBy(ctx.companyId, ctx.userId);
}

/** The routine log: one row per completion in the window. */
async function runRoutineLog(ctx: AuthContext, from: Date, to: Date): Promise<SourceResult> {
  const routines = await managedRoutines(ctx);
  const titleOf = new Map(routines.map((r) => [r.id, r.title]));
  const comps = await completionsForRoutines(
    routines.map((r) => r.id),
    dayOf(from),
    dayOf(to),
    ctx,
  );
  const rows: ReportRow[] = comps.map((c, i) => ({
    id: String(i),
    reportId: null,
    cells: {
      date: formatDate(`${c.occurrenceDate}T00:00:00`),
      routine: titleOf.get(c.routineId) ?? "—",
      person: c.userName,
      status: c.status === "completed" ? "Done" : "In progress",
      started: c.startedAt ? formatDateTime(c.startedAt) : "—",
      finished: c.finishedAt ? formatDateTime(c.finishedAt) : "—",
    },
  }));
  return {
    groups: [
      { key: null, label: "Routine log", rows, totals: { ...EMPTY_TOTALS, count: rows.length } },
    ],
    totals: { ...EMPTY_TOTALS, count: rows.length },
    columns: ROUTINE_LOG_COLUMNS,
    assetName: null,
  };
}

/** Routine compliance: per person, how many occurrences were due, completed, and missed. */
async function runRoutineCompliance(ctx: AuthContext, from: Date, to: Date): Promise<SourceResult> {
  const routines = (await managedRoutines(ctx)).filter((r) => r.status === "active");
  const [fromDate, toDate] = [dayOf(from), dayOf(to)];
  const assigneeRows = await assigneesFor(
    routines.map((r) => r.id),
    ctx,
  );
  const assigneesByRoutine = new Map<string, { userId: string; name: string }[]>();
  for (const a of assigneeRows) {
    assigneesByRoutine.set(a.routineId, [...(assigneesByRoutine.get(a.routineId) ?? []), a]);
  }
  const comps = await completionsForRoutines(
    routines.map((r) => r.id),
    fromDate,
    toDate,
    ctx,
  );
  // routineId|date|userId -> completed on time?
  const completedByKey = new Map<string, boolean>();
  for (const c of comps) {
    if (c.status === "completed") {
      completedByKey.set(
        `${c.routineId}|${c.occurrenceDate}|${c.userId}`,
        isOnTime(c.occurrenceDate, c.finishedAt),
      );
    }
  }

  type Tally = { name: string; due: number; completed: number; onTime: number };
  const people = new Map<string, Tally>();
  for (const r of routines) {
    const dates = occurrenceDates(
      {
        cadence: r.cadence as "daily",
        anchorWeekday: r.anchorWeekday,
        anchorDay: r.anchorDay,
        anchorMonthOfQuarter: r.anchorMonthOfQuarter,
        startDate: r.startDate,
      },
      fromDate,
      toDate,
    );
    for (const a of assigneesByRoutine.get(r.id) ?? []) {
      const t = people.get(a.userId) ?? { name: a.name, due: 0, completed: 0, onTime: 0 };
      for (const date of dates) {
        t.due += 1;
        const onTime = completedByKey.get(`${r.id}|${date}|${a.userId}`);
        if (onTime !== undefined) {
          t.completed += 1;
          if (onTime) t.onTime += 1;
        }
      }
      people.set(a.userId, t);
    }
  }

  const rows: ReportRow[] = [...people.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t, i) => ({
      id: String(i),
      reportId: null,
      cells: {
        person: t.name,
        due: String(t.due),
        completed: String(t.completed),
        missed: String(t.due - t.completed),
        onTime: t.completed > 0 ? `${Math.round((t.onTime / t.completed) * 100)}%` : "—",
      },
    }));
  return {
    groups: [
      {
        key: null,
        label: "Routine compliance",
        rows,
        totals: { ...EMPTY_TOTALS, count: rows.length },
      },
    ],
    totals: { ...EMPTY_TOTALS, count: rows.length },
    columns: ROUTINE_COMPLIANCE_COLUMNS,
    assetName: null,
  };
}

/* --------------------------- cartridge reports ----------------------------- */

/**
 * The five cartridge reports.
 *
 * Gated on the company's own module switch rather than a permission: a company
 * that does not refill cartridges has no cartridge reports, and an empty table
 * titled "Cartridge health" is a worse answer than a refusal that says the module
 * is off. Read through the settings registry, never by importing `features/parts`
 * — that module has to stay removable.
 */
async function runCartridges(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
): Promise<SourceResult> {
  const source = definition.source;
  // Only where it means something. The register and the health reports have no
  // person to narrow by, and `sourceSupportsPerson` is what the picker consults
  // too — so a filter that would change nothing is never offered.
  const people = sourceSupportsPerson(source) ? definition.filters.personId : undefined;
  if (!ctx.companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  const settings = await getEffectiveSetting(PARTS_MODULE, { companyId: ctx.companyId });
  if (!settings.enabled) {
    throw new AppError(
      404,
      ERROR_CODES.NOT_FOUND,
      "This company does not use the cartridges module",
    );
  }

  if (source === "part_register") return runPartRegister(ctx, ctx.companyId);
  if (source === "part_services") return runPartServices(ctx, ctx.companyId, from, to, people);
  if (source === "part_consumption")
    return runPartConsumption(ctx, ctx.companyId, from, to, people);
  if (source === "printer_health") return runPrinterHealth(ctx, ctx.companyId, from, to);
  if (source === "part_failures") return runPartFailures(ctx, ctx.companyId, from, to, people);
  if (source === "part_workload") return runPartWorkload(ctx, ctx.companyId, from, to, people);
  return runPartHealth(ctx, ctx.companyId, from, to);
}

/** Every cartridge and where it stands. No window: a register is a now, not a span. */
async function runPartRegister(ctx: AuthContext, companyId: string): Promise<SourceResult> {
  const parts = await partsRepo.registerRows(ctx, companyId);
  const rows: ReportRow[] = parts.map((part) => ({
    id: part.id,
    reportId: null,
    cells: {
      cartridge: part.identifier,
      model: part.modelName,
      partStatus: PART_STATUS_LABELS[part.status as PartStatus] ?? part.status,
      where: part.deviceName ?? part.locationName ?? "—",
      cycles:
        part.cycleLimit !== null && part.cycleCount >= part.cycleLimit
          ? `${part.cycleCount} (over limit)`
          : String(part.cycleCount),
    },
  }));
  return oneGroup("Cartridge register", rows, PART_REGISTER_COLUMNS);
}

/** What was refilled or repaired, by whom, and what it paid. */
async function runPartServices(
  ctx: AuthContext,
  companyId: string,
  from: Date,
  to: Date,
  people?: string[],
): Promise<SourceResult> {
  const services = await partsRepo.serviceRows(ctx, companyId, from, to, people);
  const used = await partsRepo.consumptionsForServices(services.map((service) => service.id));

  const rows: ReportRow[] = services.map((service) => ({
    id: service.id,
    reportId: null,
    cells: {
      date: formatDate(service.performedAt.toISOString()),
      cartridge: service.identifier,
      serviceKind: service.serviceKindName,
      person: service.personName ?? "—",
      used:
        (used.get(service.id) ?? [])
          .map((line) => `${line.name} ${line.quantity}${line.unit}`)
          .join(", ") || "—",
      // A reversal is shown, not netted away. The ledger keeps both entries and
      // so does this.
      points: service.pointsReversedAt ? `${service.points} (reversed)` : String(service.points),
    },
  }));
  return oneGroup("Services", rows, PART_SERVICE_COLUMNS);
}

/** How much of each consumable went. A usage total, never a stock level. */
async function runPartConsumption(
  ctx: AuthContext,
  companyId: string,
  from: Date,
  to: Date,
  people?: string[],
): Promise<SourceResult> {
  const totals = await partsRepo.consumptionTotals(ctx, companyId, from, to, people);
  const rows: ReportRow[] = totals.map((total, index) => ({
    id: String(index),
    reportId: null,
    cells: {
      consumable: total.name,
      unit: total.unit,
      quantity: String(Math.round(total.quantity * 100) / 100),
      jobs: String(total.jobs),
    },
  }));
  return oneGroup("Consumable usage", rows, PART_CONSUMPTION_COLUMNS);
}

/** Mean of the tours that were measured, ignoring those that were not. */
function tourStats(tours: partsRepo.TourRow[]) {
  const failures = tours.filter((tour) => tour.outcome === "faulty").length;
  const mean = meanPages(tours);
  return { tours: tours.length, failures, mean };
}

/**
 * Worst first, because a report meant to surface trouble should not ask the
 * reader to sort it. A cartridge is called out when it fails more often than it
 * works, or yields under half what its model is rated for.
 */
async function runPartHealth(
  ctx: AuthContext,
  companyId: string,
  from: Date,
  to: Date,
): Promise<SourceResult> {
  const tours = await partsRepo.finishedTours(ctx, companyId, from, to);
  const byPart = new Map<string, partsRepo.TourRow[]>();
  for (const tour of tours) {
    byPart.set(tour.partId, [...(byPart.get(tour.partId) ?? []), tour]);
  }

  const rows = [...byPart.values()]
    .map((group) => {
      const first = group[0]!;
      const { tours: count, failures, mean } = tourStats(group);
      const percent = yieldPercent(mean, first.ratedPageYield);
      const verdict =
        failures > count / 2
          ? "Fails more often than it works"
          : percent !== null && percent < 50
            ? `Yields ${percent}% of rated`
            : failures > 0
              ? "Has failed"
              : "Healthy";
      return { first, count, failures, mean, percent, verdict };
    })
    // Failures first, then the poorest yield: the order somebody scanning for
    // something to retire actually wants.
    .sort((a, b) => b.failures - a.failures || (a.percent ?? 999) - (b.percent ?? 999))
    .map((entry): ReportRow => ({
      id: entry.first.partId,
      reportId: null,
      cells: {
        cartridge: entry.first.identifier,
        model: entry.first.modelName,
        tours: String(entry.count),
        failures: String(entry.failures),
        meanPages: entry.mean === null ? "—" : entry.mean.toLocaleString(),
        ratedPages: entry.first.ratedPageYield?.toLocaleString() ?? "—",
        verdict: entry.verdict,
      },
    }));
  return oneGroup("Cartridge health", rows, PART_HEALTH_COLUMNS);
}

/**
 * The same evidence grouped by machine.
 *
 * A cartridge failing repeatedly is a cartridge problem; three DIFFERENT
 * cartridges failing in one printer is a printer problem, and only this grouping
 * shows the difference.
 */
async function runPrinterHealth(
  ctx: AuthContext,
  companyId: string,
  from: Date,
  to: Date,
): Promise<SourceResult> {
  const tours = await partsRepo.finishedTours(ctx, companyId, from, to);
  const byDevice = new Map<string, partsRepo.TourRow[]>();
  for (const tour of tours) {
    byDevice.set(tour.deviceId, [...(byDevice.get(tour.deviceId) ?? []), tour]);
  }

  const rows = [...byDevice.values()]
    .map((group) => {
      const first = group[0]!;
      const { tours: count, failures, mean } = tourStats(group);
      // Distinct cartridges that failed here. One bad cartridge returning again
      // and again is not evidence against the printer; several are.
      const distinctFailed = new Set(
        group.filter((tour) => tour.outcome === "faulty").map((tour) => tour.partId),
      ).size;
      const distinctParts = new Set(group.map((tour) => tour.partId)).size;
      const verdict =
        distinctFailed > 1
          ? `${distinctFailed} different cartridges failed here`
          : failures > 0
            ? "One cartridge failed here"
            : "Healthy";
      return { first, count, failures, distinctFailed, distinctParts, mean, verdict };
    })
    .sort((a, b) => b.distinctFailed - a.distinctFailed || b.failures - a.failures)
    .map((entry): ReportRow => ({
      id: entry.first.deviceId,
      reportId: null,
      cells: {
        printer: entry.first.deviceName,
        printerType: entry.first.deviceTypeName ?? "—",
        tours: String(entry.count),
        failures: String(entry.failures),
        cartridges: String(entry.distinctParts),
        meanPages: entry.mean === null ? "—" : entry.mean.toLocaleString(),
        verdict: entry.verdict,
      },
    }));
  return oneGroup("Printer health", rows, PRINTER_HEALTH_COLUMNS);
}

/**
 * What failed, and after whose work.
 *
 * The report that answers "did the refills hold up". Every other cartridge
 * report either aggregates or stops at the service; this one puts the failure
 * next to the job that preceded it and names both people — the one who serviced
 * it and the one who took it out.
 */
async function runPartFailures(
  ctx: AuthContext,
  companyId: string,
  from: Date,
  to: Date,
  people?: string[],
): Promise<SourceResult> {
  const all = await partsRepo.failureRows(ctx, companyId, from, to);
  // Narrowed on WHOSE service preceded the failure, which is the question the
  // picker is asking on this report — not who happened to take it out.
  const failures = people?.length
    ? all.filter((row) => row.servicedById !== null && people.includes(row.servicedById))
    : all;
  const rows: ReportRow[] = failures.map((failure) => {
    const count = pagesFor(failure);
    const removedAt = failure.removedAt ?? failure.installedAt;
    const days = Math.max(
      0,
      Math.round((removedAt.getTime() - failure.installedAt.getTime()) / (24 * 60 * 60 * 1000)),
    );
    return {
      id: failure.placementId,
      reportId: null,
      cells: {
        date: formatDate(removedAt.toISOString()),
        cartridge: failure.identifier,
        printer: failure.deviceName,
        lastedDays: days === 1 ? "1 day" : `${days} days`,
        pages: count.pages === null ? "—" : count.pages.toLocaleString(),
        // A cartridge that failed with no service before it is not somebody's
        // work gone wrong — it arrived broken, and saying so beats a blank.
        serviceKind: failure.serviceKindName ?? "never serviced",
        servicedBy: failure.servicedByName ?? "—",
        removedBy: failure.removedByName ?? "—",
        reversed: failure.pointsReversedAt ? "reversed" : "kept",
      },
    };
  });
  return oneGroup("Failures", rows, PART_FAILURE_COLUMNS);
}

/**
 * Who did how much cartridge work, and how much of it came back.
 *
 * Twelve refills is not a fact about anybody until you know whether they held
 * up: the same number with three returns and with none describe two different
 * technicians. So the count and the comeback sit in one row, and the report is
 * sorted by what came back rather than by volume — a busy person is not the
 * finding, a pattern of returns is.
 *
 * `cameBack` counts a service followed by a faulty return WHETHER OR NOT the
 * points were reversed. The reversal only fires inside the company's window; a
 * cartridge that failed a month later still failed, and hiding that because
 * nobody was docked for it would make the column agree with the ledger instead
 * of with what happened.
 */
async function runPartWorkload(
  ctx: AuthContext,
  companyId: string,
  from: Date,
  to: Date,
  people?: string[],
): Promise<SourceResult> {
  const [services, failures] = await Promise.all([
    partsRepo.serviceRows(ctx, companyId, from, to, people),
    partsRepo.failureRows(ctx, companyId, from, to),
  ]);
  const used = await partsRepo.consumptionsForServices(services.map((service) => service.id));
  const cameBack = new Set(
    failures.map((failure) => failure.serviceEventId).filter((id): id is string => id !== null),
  );

  interface Tally {
    person: string;
    services: number;
    kinds: Map<string, number>;
    parts: Set<string>;
    used: Map<string, { quantity: number; unit: string }>;
    cameBack: number;
    reversed: number;
  }
  const tallies = new Map<string, Tally>();

  for (const service of services) {
    // Grouped by name: an unattributed service is its own row rather than being
    // folded into somebody else's, because "—" doing eight refills is a visible
    // gap in the record and a silent merge is not.
    const key = service.personName ?? "—";
    const tally = tallies.get(key) ?? {
      person: key,
      services: 0,
      kinds: new Map(),
      parts: new Set(),
      used: new Map(),
      cameBack: 0,
      reversed: 0,
    };
    tally.services += 1;
    tally.kinds.set(service.serviceKindName, (tally.kinds.get(service.serviceKindName) ?? 0) + 1);
    tally.parts.add(service.partId);
    if (cameBack.has(service.id)) tally.cameBack += 1;
    if (service.pointsReversedAt) tally.reversed += 1;
    for (const line of used.get(service.id) ?? []) {
      const current = tally.used.get(line.name) ?? { quantity: 0, unit: line.unit };
      current.quantity += line.quantity;
      tally.used.set(line.name, current);
    }
    tallies.set(key, tally);
  }

  const rows: ReportRow[] = [...tallies.values()]
    .sort((a, b) => b.cameBack - a.cameBack || b.services - a.services)
    .map((tally, index) => ({
      id: String(index),
      reportId: null,
      cells: {
        person: tally.person,
        services: String(tally.services),
        breakdown: [...tally.kinds].map(([name, count]) => `${name} ${count}`).join(", "),
        cartridges: String(tally.parts.size),
        used:
          [...tally.used]
            .map(([name, line]) => `${name} ${Math.round(line.quantity * 100) / 100}${line.unit}`)
            .join(", ") || "—",
        cameBack: String(tally.cameBack),
        reversed: String(tally.reversed),
      },
    }));
  return oneGroup("Who serviced what", rows, PART_WORKLOAD_COLUMNS);
}

/** One ungrouped block — every cartridge report is a flat table. */
function oneGroup(label: string, rows: ReportRow[], columns: readonly string[]): SourceResult {
  return {
    groups: [{ key: null, label, rows, totals: { ...EMPTY_TOTALS, count: rows.length } }],
    totals: { ...EMPTY_TOTALS, count: rows.length },
    columns,
    assetName: null,
  };
}

/**
 * The dedicated leaderboard page's data: the top N people by points in the window,
 * optionally within one department, each with the avatar version the page needs to
 * show their picture. Same ledger, same permission-based visibility as the tabular
 * leaderboard source — this just shapes it for the podium and caps it to a few.
 */
export async function leaderboard(
  ctx: AuthContext,
  query: LeaderboardQuery,
): Promise<LeaderboardResult> {
  if (!ctx.companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  const { from, to } = financialYearWindow(
    query.fyStart,
    query.month ?? null,
    query.tzOffsetMinutes ?? 0,
  );
  const companyWide = ctx.isSuperadmin || can(ctx, PERMISSIONS.ANALYTICS_VIEW);
  const visibleUserIds = companyWide ? null : [ctx.userId, ...(await downlineUserIds(ctx.userId))];

  const raw = await repo.leaderboardRows(ctx, ctx.companyId, from, to, visibleUserIds);
  const rows = query.departmentId ? raw.filter((r) => r.departmentId === query.departmentId) : raw;

  const tally = new Map<string, { userId: string; name: string; own: number; team: number }>();
  for (const r of rows) {
    const cur = tally.get(r.userId) ?? { userId: r.userId, name: r.name, own: 0, team: 0 };
    cur.own += r.own;
    cur.team += r.team;
    tally.set(r.userId, cur);
  }

  const ranked = [...tally.values()]
    .map((p) => ({ ...p, points: round2(p.own + p.team) }))
    .filter((p) => p.points > 0)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  // Standard competition ranking, then keep the top N.
  let lastPoints = Number.NaN;
  let lastRank = 0;
  const withRank = ranked.map((p, i) => {
    const rank = p.points === lastPoints ? lastRank : i + 1;
    lastPoints = p.points;
    lastRank = rank;
    return { ...p, rank };
  });
  const top = withRank.slice(0, query.limit);

  const versions = await avatarVersions(top.map((t) => t.userId));
  const departmentName = query.departmentId
    ? await repo.departmentNameOf(query.departmentId, ctx.companyId)
    : null;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    fyStart: query.fyStart,
    month: query.month ?? null,
    departmentId: query.departmentId ?? null,
    departmentName,
    limit: query.limit,
    totalPeople: ranked.length,
    entries: top.map((t) => ({
      rank: t.rank,
      userId: t.userId,
      name: t.name,
      avatarVersion: versions.get(t.userId) ?? null,
      points: round2(t.points),
      own: round2(t.own),
      team: round2(t.team),
    })),
  };
}

async function companyNameOf(companyId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId));
  return row?.name ?? null;
}

/** The definition to run, and the view it came from (for the printed header). */
async function resolveDefinition(
  ctx: AuthContext,
  run: RunReport,
): Promise<{ definition: ReportDefinition; view: ReportView | null }> {
  let view: ReportView | null = null;
  if (run.viewId) {
    view = await getView(ctx, run.viewId); // throws 404/403 if not reachable
  }
  const base = view ? view.definition : undefined;
  const raw = run.definition ?? base;
  if (!raw) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "A report needs a view or a definition");
  }
  // Parse through the schema so an inline (or stored) definition is fully defaulted.
  return { definition: reportDefinitionSchema.parse(raw), view };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Gather rows into groups by a (key,label) function, with a subtotal per group. */
function bucketize<T>(
  rows: T[],
  keyLabel: (row: T) => { key: string | null; label: string },
  toRow: (row: T) => ReportRow,
  totalsFor: (rows: T[]) => ReportTotals,
  sortByKey: boolean,
): ReportGroup[] {
  const buckets = new Map<string, { key: string | null; label: string; rows: T[] }>();
  for (const row of rows) {
    const { key, label } = keyLabel(row);
    const bucketKey = key ?? `∅:${label}`;
    const bucket = buckets.get(bucketKey) ?? { key, label, rows: [] };
    bucket.rows.push(row);
    buckets.set(bucketKey, bucket);
  }
  const groups = [...buckets.values()].map((b) => ({
    key: b.key,
    label: b.label,
    rows: b.rows.map(toRow),
    totals: totalsFor(b.rows),
  }));
  groups.sort((a, b) =>
    sortByKey ? (a.key ?? "").localeCompare(b.key ?? "") : a.label.localeCompare(b.label),
  );
  return groups;
}

const localDay = (d: Date, tz: number) =>
  new Date(d.getTime() + tz * 60_000).toISOString().slice(0, 10);

// --- journal rows ---

function jDurationMinutes(row: EnrichedRow): number | null {
  return row.startedAt && row.endedAt
    ? Math.max(0, Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 60_000))
    : null;
}

function journalTotals(rows: EnrichedRow[]): ReportTotals {
  let durationMinutes = 0;
  let points = 0;
  for (const r of rows) {
    durationMinutes += jDurationMinutes(r) ?? 0;
    points += r.points ?? 0;
  }
  return {
    count: rows.length,
    durationMinutes: round2(durationMinutes),
    downtimeMinutes: 0,
    points: round2(points),
  };
}

function journalCells(row: EnrichedRow): Record<string, string> {
  const ageDays = Math.max(0, Math.floor((Date.now() - row.reportDate.getTime()) / 86_400_000));
  return {
    date: formatDate(row.reportDate.toISOString()),
    kind: row.kind === "work" ? "Work log" : "Issue",
    title: row.title,
    issueSummary: row.issueSummary ?? "",
    workSummary: row.workSummary ?? "",
    category: row.categoryName ?? "—",
    department: row.departmentName ?? "—",
    location: row.locationName ?? "—",
    asset: row.assetLabels.length > 0 ? row.assetLabels.join(", ") : "—",
    author: row.authorName,
    assignee: row.assigneeName ?? "—",
    severity: row.severityName ?? "—",
    status: row.statusName ?? "—",
    duration: formatDurationMinutes(jDurationMinutes(row)),
    age: `${ageDays}d`,
    points: row.points === null ? "—" : String(row.points),
  };
}

function journalRow(row: EnrichedRow): ReportRow {
  return { id: row.id, reportId: row.id, cells: journalCells(row) };
}

function groupJournal(rows: EnrichedRow[], grouping: ReportGrouping, tz: number): ReportGroup[] {
  const keyLabel = (row: EnrichedRow): { key: string | null; label: string } => {
    switch (grouping) {
      case "none":
        return { key: null, label: "All entries" };
      case "date":
        return { key: localDay(row.reportDate, tz), label: localDay(row.reportDate, tz) };
      case "location":
        return { key: row.locationId, label: row.locationName ?? "No location" };
      case "department":
        return { key: row.departmentId, label: row.departmentName ?? "No department" };
      case "category":
        return { key: row.categoryId, label: row.categoryName ?? "No category" };
      case "author":
        return { key: row.authorId, label: row.authorName };
      case "assignee":
        return { key: row.assigneeId, label: row.assigneeName ?? "Unassigned" };
      case "severity":
        return { key: row.severityId, label: row.severityName ?? "No severity" };
      case "status":
        return { key: row.statusId, label: row.statusName ?? "No status" };
      case "kind":
        return { key: row.kind, label: row.kind === "work" ? "Work log" : "Issue" };
      case "asset":
        // Placed under its first asset, so an entry is counted once, not duplicated.
        return row.assetLabels.length > 0
          ? { key: row.assetLabels[0]!, label: row.assetLabels[0]! }
          : { key: null, label: "No asset" };
      default:
        return { key: null, label: "All entries" };
    }
  };
  return bucketize(rows, keyLabel, journalRow, journalTotals, grouping === "date");
}

// --- downtime rows ---

function dtMinutes(row: repo.DowntimeReportRow): number {
  const end = row.endedAt ? row.endedAt.getTime() : Date.now();
  return Math.max(0, (end - row.startedAt.getTime()) / 60_000);
}

function downtimeTotals(rows: repo.DowntimeReportRow[]): ReportTotals {
  let downtimeMinutes = 0;
  for (const r of rows) downtimeMinutes += dtMinutes(r);
  return {
    count: rows.length,
    durationMinutes: 0,
    downtimeMinutes: round2(downtimeMinutes),
    points: 0,
  };
}

function downtimeRowCells(row: repo.DowntimeReportRow): Record<string, string> {
  return {
    date: formatDate(row.startedAt.toISOString()),
    asset: row.targetLabel ?? "—",
    reason: row.reason ?? "—",
    start: formatDateTime(row.startedAt.toISOString()),
    end: row.endedAt ? formatDateTime(row.endedAt.toISOString()) : "still down",
    downtime: formatDurationMinutes(dtMinutes(row)),
    reporter: row.createdByName,
  };
}

function groupDowntime(
  rows: repo.DowntimeReportRow[],
  grouping: ReportGrouping,
  tz: number,
): ReportGroup[] {
  const keyLabel = (row: repo.DowntimeReportRow): { key: string | null; label: string } => {
    if (grouping === "asset") return { key: row.targetId, label: row.targetLabel ?? "No asset" };
    if (grouping === "date")
      return { key: localDay(row.startedAt, tz), label: localDay(row.startedAt, tz) };
    return { key: null, label: "All outages" };
  };
  const toRow = (row: repo.DowntimeReportRow): ReportRow => ({
    id: row.id,
    reportId: row.reportId,
    cells: downtimeRowCells(row),
  });
  return bucketize(rows, keyLabel, toRow, downtimeTotals, grouping === "date");
}

// --- reliability rows ---

function reliabilityCells(a: AssetReliability): Record<string, string> {
  return {
    asset: a.assetName,
    failures: String(a.failures),
    open: a.openCount > 0 ? String(a.openCount) : "—",
    downtime: formatDurationMinutes(a.totalDowntimeMinutes),
    mttr: a.mttrMinutes === null ? "—" : formatDurationMinutes(a.mttrMinutes),
    mtbf: a.mtbfHours === null ? "—" : `${Math.round(a.mtbfHours)}h`,
    availability: a.availabilityPct === null ? "—" : `${a.availabilityPct}%`,
  };
}

// --- report views ---

function serializeView(row: repo.ReportViewRow): ReportView {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    access: row.access as ReportView["access"],
    groupIds: row.groupIds,
    definition: reportDefinitionSchema.parse(row.definition),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Whether the caller may see a view, given the group ids they belong to. Scope of
 * the rows is separate — this is only about being offered the shape.
 */
function maySeeView(view: repo.ReportViewRow, ctx: AuthContext, callerGroupIds: string[]): boolean {
  if (ctx.isSuperadmin) return true;
  if (view.isSystem) return true; // shipped views are offered to everyone
  if (view.ownerId === ctx.userId) return true; // your own, at any access
  if (view.companyId && ctx.companyId && view.companyId !== ctx.companyId) return false;
  if (view.access === "company") return true;
  if (view.access === "groups") return view.groupIds.some((g) => callerGroupIds.includes(g));
  return false; // private, not the owner
}

/** Only the owner (or a superadmin) may edit or delete a custom view; never a system one. */
function assertMayManage(view: repo.ReportViewRow, ctx: AuthContext): void {
  if (view.isSystem) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "A system report cannot be edited or deleted");
  }
  if (!ctx.isSuperadmin && view.ownerId !== ctx.userId) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "Only the report's owner may change it");
  }
}

export async function listViews(ctx: AuthContext): Promise<ReportView[]> {
  const [rows, callerGroupIds] = await Promise.all([
    repo.listViewRows(ctx.companyId),
    repo.groupIdsForUser(ctx.userId),
  ]);
  // Sharing decides which views exist for you; the per-report permission decides
  // which you may actually run. Listing one you cannot open is an invitation to a
  // 403 — so a view whose report is closed to you is not listed at all.
  return rows
    .filter((r) => maySeeView(r, ctx, callerGroupIds) && mayReadSource(ctx, sourceOfView(r)))
    .map(serializeView);
}

export async function getView(ctx: AuthContext, id: string): Promise<ReportView> {
  const row = await repo.getViewRow(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Report not found");
  const callerGroupIds = await repo.groupIdsForUser(ctx.userId);
  if (!maySeeView(row, ctx, callerGroupIds) || !mayReadSource(ctx, sourceOfView(row))) {
    // 404, not 403 — a view the caller may not see should not be enumerable, and
    // that holds whether it is sharing or the report's own permission that closed
    // it. Answering 403 would confirm the view exists.
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "Report not found");
  }
  return serializeView(row);
}

export async function createView(ctx: AuthContext, input: CreateReportView): Promise<ReportView> {
  if (!ctx.companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  const id = await repo.insertView(
    {
      companyId: ctx.companyId,
      name: input.name,
      description: input.description ?? null,
      ownerId: ctx.userId,
      access: input.access,
      definition: input.definition,
    },
    input.groupIds ?? [],
  );
  return getView(ctx, id);
}

export async function updateView(
  ctx: AuthContext,
  id: string,
  patch: UpdateReportView,
): Promise<ReportView> {
  const row = await repo.getViewRow(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Report not found");
  assertMayManage(row, ctx);
  await repo.updateViewRow(
    id,
    {
      name: patch.name,
      description: patch.description,
      access: patch.access,
      definition: patch.definition,
    },
    patch.groupIds,
  );
  return getView(ctx, id);
}

export async function deleteView(ctx: AuthContext, id: string): Promise<void> {
  const row = await repo.getViewRow(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Report not found");
  assertMayManage(row, ctx);
  await repo.deleteViewRow(id);
}

/**
 * Clone any view the caller may see — system or custom — into a new custom view they
 * own. This is how a shipped report becomes an editable starting point; the source
 * is never touched.
 */
export async function cloneView(ctx: AuthContext, id: string, name: string): Promise<ReportView> {
  const source = await getView(ctx, id); // enforces visibility
  return createView(ctx, {
    name,
    description: source.description ?? undefined,
    access: "private",
    groupIds: [],
    definition: source.definition,
  });
}
