// Author: Brijesh Dave <https://github.com/brijeshdave>
// "My day" — the home screen's single read. It owns no data: every tile is
// composed from the feature that owns it, so a rule about who may see a task or an
// outage is enforced in exactly one place, not re-stated here.
import {
  type AuthContext,
  type MyDay,
  type MyDayDowntime,
  type MyDayReport,
  type MyDayTask,
  PERMISSIONS,
  can,
} from "@reportly/shared";

import { openEntriesCreatedBy } from "@/features/downtime/repo.js";
import { myReportsBetween } from "@/features/journal/repo.js";
import { myPoints, pendingAppraisals } from "@/features/journal/service.js";
import { openTasksFor } from "@/features/tasks/repo.js";

/**
 * How many rows each tile shows. A home screen is a nudge, not a work queue —
 * every tile links to the real list, which is paginated and filterable.
 */
const TILE_LIMIT = 5;

const MINUTE = 60_000;

/**
 * The caller's local day, from a UTC offset in minutes (east-positive).
 *
 * The browser sends it because only the browser knows it. A user in UTC+5:30 who
 * files a report at 00:30 local filed it *today*; computed in UTC it lands
 * yesterday and vanishes from their screen. Absent = UTC, which is a coherent day
 * rather than an error — a missing header must not break a home screen.
 */
export function dayBounds(now: Date, tzOffsetMinutes: number): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() + tzOffsetMinutes * MINUTE);
  // Midnight in the caller's local wall clock, expressed back in UTC.
  const localMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  const start = new Date(localMidnight - tzOffsetMinutes * MINUTE);
  return { start, end: new Date(start.getTime() + 24 * 60 * MINUTE) };
}

/**
 * Assemble the home screen.
 *
 * Sections the caller lacks the permission for are **omitted, not emptied**. The
 * distinction is the whole design: an empty array says "you are clear", an absent
 * key says "this is not yours to see", and a screen that tells someone without
 * `downtime:read` that they have "nothing to close" is lying to them. It is also
 * why nothing here 403s — a home screen that fails because one tile is out of
 * reach is a broken home screen.
 */
export async function myDay(
  ctx: AuthContext,
  companyId: string,
  tzOffsetMinutes: number,
): Promise<MyDay> {
  const { start, end } = dayBounds(new Date(), tzOffsetMinutes);

  // The tiles are independent reads; there is no reason for the slowest to wait on
  // the one before it.
  const [points, reportsToday, appraisals, downtimes, tasks] = await Promise.all([
    myPoints(ctx),
    myReportsBetween(ctx.userId, companyId, start, end, TILE_LIMIT),
    can(ctx, PERMISSIONS.JOURNAL_APPRAISE) ? pendingAppraisals(ctx) : null,
    can(ctx, PERMISSIONS.DOWNTIME_READ) ? openEntriesCreatedBy(companyId, ctx.userId) : null,
    can(ctx, PERMISSIONS.TASKS_READ) ? openTasksFor(ctx.userId, companyId, TILE_LIMIT) : null,
  ]);

  const now = Date.now();

  const day: MyDay = {
    dayStart: start.toISOString(),
    dayEnd: end.toISOString(),
    points,
    draftCount: reportsToday.draftCount,
    myReports: reportsToday.rows.map((r): MyDayReport => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      state: r.state,
      severityName: r.severityName,
      statusName: r.statusName,
    })),
  };

  if (appraisals) day.pendingAppraisals = appraisals.slice(0, TILE_LIMIT);

  if (downtimes) {
    day.openDowntimes = downtimes.slice(0, TILE_LIMIT).map((d): MyDayDowntime => ({
      id: d.id,
      reportId: d.reportId,
      targetLabel: d.targetLabel ?? "Unknown",
      startedAt: d.startedAt.toISOString(),
      // An open entry has no duration, only an age. Floored at zero so a start
      // time typed in the future reads as "just now" rather than as negative.
      openForMinutes: Math.max(0, (now - d.startedAt.getTime()) / MINUTE),
    }));
  }

  if (tasks) {
    day.openTasks = tasks.map((t): MyDayTask => ({
      id: t.id,
      title: t.title,
      state: t.state,
      dueAt: t.dueAt ? t.dueAt.toISOString() : null,
      overdue: t.dueAt !== null && t.dueAt.getTime() < now,
    }));
  }

  return day;
}
