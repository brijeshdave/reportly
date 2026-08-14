// Author: Brijesh Dave <https://github.com/brijeshdave>
// Downtime business logic.
//
// Two rules carry this feature. First, downtime rides on a report's **scope**: you
// may only record an outage on something the report is actually about, so the two
// can never drift apart. Second, an entry with no end time is **open** — it is what
// the pending queue lists, and its total keeps climbing until someone closes it. An
// open outage that read as zero minutes would be a breakdown nobody was counting.
import {
  type AuthContext,
  type CreateDowntime,
  type DowntimeEntry,
  type DowntimeTotal,
  ERROR_CODES,
  type UpdateDowntime,
} from "@reportly/shared";

import { mayUseLocation, withLocationsNullable } from "@/core/db/scoped.js";
import { journalEntries as reportsTable } from "@/core/db/schema.js";
import { AppError } from "@/core/errors.js";
import { notify } from "@/core/queue/notifications.js";
import {
  type DowntimePatch,
  type DowntimeRowRaw,
  type DowntimeTotalRaw,
  deleteEntry,
  entriesForReport,
  getEntry,
  insertEntry,
  openEntries,
  reportOf,
  reportTargetsThing,
  totals as totalsRows,
  updateEntry,
} from "@/features/downtime/repo.js";
import { downlineUserIds } from "@/features/journal/hierarchy.js";

function minutesBetween(start: Date, end: Date | null): number | null {
  if (!end) return null;
  return Math.round(((end.getTime() - start.getTime()) / 60000) * 100) / 100;
}

function serialize(row: DowntimeRowRaw): DowntimeEntry {
  return {
    id: row.id,
    companyId: row.companyId,
    reportId: row.reportId,
    targetKind: row.targetKind === "device" ? "device" : "asset",
    targetId: row.targetId,
    // The thing may have been deleted since; say so rather than showing a blank.
    targetLabel: row.targetLabel ?? "(removed)",
    reason: row.reason,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    durationMinutes: minutesBetween(row.startedAt, row.endedAt),
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeTotal(row: DowntimeTotalRaw): DowntimeTotal {
  return {
    targetKind: row.targetKind === "device" ? "device" : "asset",
    targetId: row.targetId,
    targetLabel: row.targetLabel ?? "(removed)",
    totalMinutes: Number(row.totalMinutes),
    openCount: row.openCount,
    entryCount: row.entryCount,
  };
}

async function requireEntry(id: string, companyId: string): Promise<DowntimeRowRaw> {
  const row = await getEntry(id, companyId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Downtime entry not found");
  return row;
}

/**
 * Who may record or amend downtime on a report: its author, anyone above them in the
 * reporting line, and a superadmin. The same people who may see the report.
 */
async function assertMayWrite(reportAuthorId: string, ctx: AuthContext): Promise<void> {
  if (ctx.isSuperadmin || reportAuthorId === ctx.userId) return;
  const below = await downlineUserIds(ctx.userId);
  if (!below.has(reportAuthorId)) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You cannot record downtime on this report");
  }
}

/**
 * Every downtime write path resolves its report through here, so the location
 * check lands once. An outage inherits its report's location: if you cannot see
 * the report, you cannot touch the outages raised from it.
 */
async function requireReport(
  reportId: string,
  companyId: string,
  ctx: AuthContext,
): Promise<NonNullable<Awaited<ReturnType<typeof reportOf>>>> {
  const report = await reportOf(reportId, companyId);
  if (!report || !mayUseLocation(ctx, report.locationId)) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "JournalEntry not found");
  }
  return report;
}

/** The downtime raised from one report. */
export async function listForReport(
  reportId: string,
  companyId: string,
  ctx: AuthContext,
): Promise<DowntimeEntry[]> {
  const report = await requireReport(reportId, companyId, ctx);
  await assertMayWrite(report.authorId, ctx);
  return (await entriesForReport(reportId)).map(serialize);
}

/** The pending queue: outages still running, oldest first — the ones to chase. */
export async function listOpen(companyId: string, ctx: AuthContext): Promise<DowntimeEntry[]> {
  const authorIds = ctx.isSuperadmin ? null : [ctx.userId, ...(await downlineUserIds(ctx.userId))];
  return (
    await openEntries(companyId, authorIds, withLocationsNullable(ctx, reportsTable.locationId))
  ).map(serialize);
}

/** Total minutes down per thing, worst first. */
export async function listTotals(companyId: string, ctx: AuthContext): Promise<DowntimeTotal[]> {
  return (await totalsRows(companyId, withLocationsNullable(ctx, reportsTable.locationId))).map(
    serializeTotal,
  );
}

export async function createDowntime(
  companyId: string,
  ctx: AuthContext,
  input: CreateDowntime,
): Promise<DowntimeEntry> {
  const report = await requireReport(input.reportId, companyId, ctx);
  await assertMayWrite(report.authorId, ctx);

  const inScope = await reportTargetsThing(input.reportId, input.targetKind, input.targetId);
  if (!inScope) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Add the thing to the report's scope first — downtime is recorded against what the report is about.",
      { targetKind: input.targetKind, targetId: input.targetId },
    );
  }

  const id = await insertEntry({
    companyId,
    reportId: input.reportId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    startedAt: new Date(input.startedAt),
    endedAt: input.endedAt ? new Date(input.endedAt) : null,
    reason: input.reason ?? null,
    createdBy: ctx.userId,
  });
  // Opened, not merely recorded: an entry filed with an end time already on it is
  // history, and telling the department an asset is down when it is back up
  // teaches people to ignore the channel.
  if (!input.endedAt) {
    await notify({
      type: "downtime.opened",
      companyId,
      actorUserId: ctx.userId,
      departmentId: report.departmentId,
      title: `Downtime opened on ${report.title}`,
      body: input.reason ?? "",
      link: `/journal/${input.reportId}`,
      entityKind: "downtime",
      entityId: id,
    });
  }
  return serialize(await requireEntry(id, companyId));
}

/**
 * Edit an entry — usually to close it by filling in the end time, which is the whole
 * "pending entry that can be edited and saved" loop. The start/end order is re-checked
 * against the *merged* record, since either side may be the one moving.
 */
export async function updateDowntime(
  id: string,
  companyId: string,
  ctx: AuthContext,
  input: UpdateDowntime,
): Promise<DowntimeEntry> {
  const row = await requireEntry(id, companyId);
  const report = await requireReport(row.reportId, companyId, ctx);
  await assertMayWrite(report.authorId, ctx);

  const patch: DowntimePatch = {};
  if (input.startedAt !== undefined) patch.startedAt = new Date(input.startedAt);
  if (input.endedAt !== undefined) patch.endedAt = input.endedAt ? new Date(input.endedAt) : null;
  if (input.reason !== undefined) patch.reason = input.reason ?? null;

  const startedAt = patch.startedAt ?? row.startedAt;
  const endedAt = patch.endedAt !== undefined ? patch.endedAt : row.endedAt;
  if (endedAt && endedAt < startedAt) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Downtime cannot end before it started");
  }

  await updateEntry(id, companyId, patch);
  // The transition, not the state: an edit to an already-closed entry's reason is
  // not the asset coming back.
  if (!row.endedAt && endedAt) {
    await notify({
      type: "downtime.closed",
      companyId,
      actorUserId: ctx.userId,
      departmentId: report.departmentId,
      title: `Downtime closed on ${report.title}`,
      body: patch.reason ?? row.reason ?? "",
      link: `/journal/${row.reportId}`,
      entityKind: "downtime",
      entityId: id,
    });
  }
  return serialize(await requireEntry(id, companyId));
}

export async function deleteDowntime(
  id: string,
  companyId: string,
  ctx: AuthContext,
): Promise<void> {
  const row = await requireEntry(id, companyId);
  const report = await requireReport(row.reportId, companyId, ctx);
  await assertMayWrite(report.authorId, ctx);
  await deleteEntry(id, companyId);
}
