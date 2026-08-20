// Author: Brijesh Dave <https://github.com/brijeshdave>
// Routine definitions: a manager creates recurring duties for their team (anyone in
// their reporting downline, or themselves), sets the assignees, and edits/pauses them.
// Row scope is the reporting line: a manager manages what they created; a member sees
// what they are assigned. The occurrence + completion flow builds on these.
import {
  ERROR_CODES,
  isOccurrenceLocked,
  isOnTime,
  occurrenceDates,
  type AuthContext,
  type CreateRoutine,
  type Routine,
  type RoutineCadence,
  type RoutineCompletion,
  type RoutineOccurrence,
  type RoutineOccurrenceState,
  type RoutineRecurrence,
  type RoutineStatus,
  type PaginatedResult,
  type ResolvedListQuery,
  type UpdateRoutine,
} from "@reportly/shared";
import { toPaginatedResult } from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { notify } from "@/core/queue/notifications.js";
import { getDepartment } from "@/features/departments/repo.js";
import { downlineUserIds } from "@/features/journal/hierarchy.js";
import * as completions from "@/features/routines/completion-repo.js";
import type { AwardableRow, CompletionRow } from "@/features/routines/completion-repo.js";
import * as repo from "@/features/routines/repo.js";
import type { RoutineRow } from "@/features/routines/repo.js";

const asCadence = (v: string): RoutineCadence =>
  v === "weekly" || v === "monthly" || v === "quarterly" ? v : "daily";
const asStatus = (v: string): RoutineStatus => (v === "paused" ? "paused" : "active");

function serialize(row: RoutineRow, assignees: { userId: string; name: string }[]): Routine {
  return {
    id: row.id,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    title: row.title,
    description: row.description,
    cadence: asCadence(row.cadence),
    anchorWeekday: row.anchorWeekday,
    anchorDay: row.anchorDay,
    anchorMonthOfQuarter: row.anchorMonthOfQuarter,
    points: row.points,
    startDate: row.startDate,
    graceDays: row.graceDays,
    status: asStatus(row.status),
    createdBy: row.createdBy,
    assignees,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Attach assignees to a set of routine rows and serialize them. */
async function withAssignees(rows: RoutineRow[]): Promise<Routine[]> {
  const byRoutine = new Map<string, { userId: string; name: string }[]>();
  for (const a of await repo.assigneesFor(rows.map((r) => r.id))) {
    byRoutine.set(a.routineId, [
      ...(byRoutine.get(a.routineId) ?? []),
      { userId: a.userId, name: a.name },
    ]);
  }
  return rows.map((r) => serialize(r, byRoutine.get(r.id) ?? []));
}

/**
 * The managed list as a table: server-side filters, sort and paging.
 *
 * The rows a manager owns: what they created, or everything in the company for a
 * superadmin.
 */
export async function listManagedPage(
  query: ResolvedListQuery,
  companyId: string,
  userId: string,
  isSuperadmin: boolean,
): Promise<PaginatedResult<Routine>> {
  const { rows, total } = await repo.listManagedRoutines(
    query,
    companyId,
    isSuperadmin ? null : userId,
  );
  return toPaginatedResult(await withAssignees(rows), total, query);
}

/** Routines assigned to the caller — the ones they complete. */
export async function listAssigned(companyId: string, userId: string): Promise<Routine[]> {
  return withAssignees(await repo.assignedTo(companyId, userId));
}

export async function getRoutine(id: string, companyId: string): Promise<Routine> {
  const row = await repo.getRoutine(id, companyId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Routine not found");
  const assignees = (await repo.assigneesFor([id])).map((a) => ({
    userId: a.userId,
    name: a.name,
  }));
  return serialize(row, assignees);
}

/** Assignees must be the caller or someone in their reporting downline. */
async function assertAssignable(
  userId: string,
  isSuperadmin: boolean,
  assigneeIds: string[],
): Promise<void> {
  if (isSuperadmin) return;
  const allowed = new Set([userId, ...(await downlineUserIds(userId))]);
  const outside = assigneeIds.filter((id) => !allowed.has(id));
  if (outside.length > 0) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You can only assign routines to your own team");
  }
}

/** The anchor fields a cadence keeps; the others are nulled so a switch stays clean. */
function anchorsFor(input: {
  cadence: RoutineCadence;
  anchorWeekday?: number | null;
  anchorDay?: number | null;
  anchorMonthOfQuarter?: number | null;
}): {
  anchorWeekday: number | null;
  anchorDay: number | null;
  anchorMonthOfQuarter: number | null;
} {
  return {
    anchorWeekday: input.cadence === "weekly" ? (input.anchorWeekday ?? null) : null,
    anchorDay:
      input.cadence === "monthly" || input.cadence === "quarterly"
        ? (input.anchorDay ?? null)
        : null,
    anchorMonthOfQuarter:
      input.cadence === "quarterly" ? (input.anchorMonthOfQuarter ?? null) : null,
  };
}

export async function createRoutine(
  companyId: string,
  userId: string,
  isSuperadmin: boolean,
  input: CreateRoutine,
): Promise<Routine> {
  await assertAssignable(userId, isSuperadmin, input.assigneeIds);
  if (!(await getDepartment(input.departmentId, companyId))) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a department for this routine");
  }
  const id = await repo.insertRoutine(
    {
      companyId,
      departmentId: input.departmentId,
      title: input.title,
      description: input.description ?? null,
      cadence: input.cadence,
      ...anchorsFor(input),
      points: input.points,
      startDate: input.startDate,
      graceDays: input.graceDays,
      status: input.status,
      createdBy: userId,
    },
    input.assigneeIds,
  );
  return getRoutine(id, companyId);
}

export async function updateRoutine(
  id: string,
  companyId: string,
  userId: string,
  isSuperadmin: boolean,
  input: UpdateRoutine,
): Promise<Routine> {
  const before = await repo.getRoutine(id, companyId);
  if (!before) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Routine not found");
  if (!isSuperadmin && before.createdBy !== userId) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "Only the routine's owner can edit it");
  }
  if (input.assigneeIds) await assertAssignable(userId, isSuperadmin, input.assigneeIds);
  if (input.departmentId && !(await getDepartment(input.departmentId, companyId))) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That department is not in this company");
  }

  const cadence = input.cadence ?? asCadence(before.cadence);
  await repo.updateRoutineRow(
    id,
    companyId,
    {
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.cadence !== undefined ? { cadence: input.cadence } : {}),
      // Re-derive anchors whenever the cadence or an anchor is touched.
      ...(input.cadence !== undefined ||
      input.anchorWeekday !== undefined ||
      input.anchorDay !== undefined ||
      input.anchorMonthOfQuarter !== undefined
        ? anchorsFor({
            cadence,
            anchorWeekday: input.anchorWeekday ?? before.anchorWeekday,
            anchorDay: input.anchorDay ?? before.anchorDay,
            anchorMonthOfQuarter: input.anchorMonthOfQuarter ?? before.anchorMonthOfQuarter,
          })
        : {}),
      ...(input.points !== undefined ? { points: input.points } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.graceDays !== undefined ? { graceDays: input.graceDays } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
    input.assigneeIds ?? null,
  );
  return getRoutine(id, companyId);
}

export async function deleteRoutine(
  id: string,
  companyId: string,
  userId: string,
  isSuperadmin: boolean,
): Promise<void> {
  const before = await repo.getRoutine(id, companyId);
  if (!before) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Routine not found");
  if (!isSuperadmin && before.createdBy !== userId) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "Only the routine's owner can delete it");
  }
  await repo.deleteRoutineRow(id, companyId);
}

// --- occurrences & completions ---

const recurrenceOf = (row: RoutineRow): RoutineRecurrence => ({
  cadence: asCadence(row.cadence),
  anchorWeekday: row.anchorWeekday,
  anchorDay: row.anchorDay,
  anchorMonthOfQuarter: row.anchorMonthOfQuarter,
  startDate: row.startDate,
});

const today = () => new Date().toISOString().slice(0, 10);

function serializeCompletion(row: CompletionRow, occurrenceDate: string): RoutineCompletion {
  return {
    id: row.id,
    userId: row.userId,
    name: row.userName,
    status: row.status === "completed" ? "completed" : "in_progress",
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    notes: row.notes,
    onTime: isOnTime(occurrenceDate, row.finishedAt),
    awardedPoints: row.awardedPoints,
  };
}

/** An occurrence is done if anyone completed it; in progress if anyone started; else
 *  missed once its day has passed, or pending while it is today or still to come. */
function stateOf(date: string, comps: CompletionRow[], now: string): RoutineOccurrenceState {
  if (comps.some((c) => c.status === "completed")) return "completed";
  if (comps.some((c) => c.status === "in_progress")) return "in_progress";
  return date < now ? "missed" : "pending";
}

/** Build occurrences for a set of routines over [from, to), joined to their completions. */
async function buildOccurrences(
  rows: RoutineRow[],
  from: string,
  to: string,
): Promise<RoutineOccurrence[]> {
  const active = rows.filter((r) => r.status === "active");
  const compRows = await completions.completionsForRoutines(
    active.map((r) => r.id),
    from,
    to,
  );
  const byKey = new Map<string, CompletionRow[]>();
  for (const c of compRows) {
    const key = `${c.routineId}|${c.occurrenceDate}`;
    byKey.set(key, [...(byKey.get(key) ?? []), c]);
  }
  const now = today();
  const out: RoutineOccurrence[] = [];
  for (const r of active) {
    const rec = recurrenceOf(r);
    for (const date of occurrenceDates(rec, from, to)) {
      const comps = byKey.get(`${r.id}|${date}`) ?? [];
      out.push({
        routineId: r.id,
        routineTitle: r.title,
        points: r.points,
        date,
        state: stateOf(date, comps, now),
        locked: isOccurrenceLocked(rec, date, r.graceDays, now),
        completions: comps.map((c) => serializeCompletion(c, date)),
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.routineTitle.localeCompare(b.routineTitle));
  return out;
}

/** The caller's own occurrences (routines assigned to them) over the window. */
export async function myOccurrences(
  companyId: string,
  userId: string,
  from: string,
  to: string,
): Promise<RoutineOccurrence[]> {
  return buildOccurrences(await repo.assignedTo(companyId, userId), from, to);
}

/** One routine's occurrences with every assignee's completion — the compliance view. */
export async function routineOccurrences(
  ctx: AuthContext,
  companyId: string,
  routineId: string,
  from: string,
  to: string,
): Promise<RoutineOccurrence[]> {
  const routine = await repo.getRoutine(routineId, companyId);
  if (!routine) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Routine not found");
  const assignees = await repo.assigneeIdsOf(routineId);
  const mayView =
    ctx.isSuperadmin || routine.createdBy === ctx.userId || assignees.includes(ctx.userId);
  if (!mayView) throw new AppError(403, ERROR_CODES.FORBIDDEN, "You cannot see this routine");
  return buildOccurrences([routine], from, to);
}

/** Load the routine, check the caller may log it (an assignee), and that `date` is a real occurrence. */
async function forLogging(
  ctx: AuthContext,
  companyId: string,
  routineId: string,
  date: string,
): Promise<void> {
  const routine = await repo.getRoutine(routineId, companyId);
  if (!routine) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Routine not found");
  const assignees = await repo.assigneeIdsOf(routineId);
  if (!assignees.includes(ctx.userId)) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You are not assigned to this routine");
  }
  const rec = recurrenceOf(routine);
  const nextDay = new Date(`${date}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  if (!occurrenceDates(rec, date, nextDay.toISOString().slice(0, 10)).includes(date)) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "That day is not an occurrence of this routine",
    );
  }
  if (isOccurrenceLocked(rec, date, routine.graceDays, today())) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "This occurrence has expired and can no longer be logged",
    );
  }
}

export async function finishOccurrence(
  ctx: AuthContext,
  companyId: string,
  routineId: string,
  date: string,
  startedAt: string | null,
  finishedAt: string,
  notes: string | null,
): Promise<RoutineCompletion> {
  await forLogging(ctx, companyId, routineId, date);
  await completions.finishCompletion(
    routineId,
    date,
    ctx.userId,
    startedAt ? new Date(startedAt) : null,
    new Date(finishedAt),
    notes,
  );
  return serializeCompletion((await completions.getCompletion(routineId, date, ctx.userId))!, date);
}

const halfStep = (n: number) => Math.round(n * 2) / 2;
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Turn a set of awardable completions into ledger awards and write them for one company:
 * each earns its routine's points if on time, half if late. Idempotent — the rows are
 * already filtered to the unawarded — so any award pass can safely re-run.
 */
async function writeAwardsFor(
  companyId: string,
  rows: AwardableRow[],
): Promise<{ count: number; points: number }> {
  const awards = rows
    .map((r) => ({
      completionId: r.completionId,
      routineId: r.routineId,
      departmentId: r.departmentId,
      beneficiaryUserId: r.userId,
      earnedOn: r.occurrenceDate,
      points: halfStep(
        isOnTime(r.occurrenceDate, r.finishedAt) ? r.routinePoints : r.routinePoints / 2,
      ),
    }))
    .filter((a) => a.points > 0);

  await completions.writeAwards(companyId, awards);

  // One message per person, not per award. A month of daily routines is thirty
  // rows and one piece of news: "your routine points landed".
  const byUser = new Map<string, number>();
  for (const award of awards) {
    byUser.set(award.beneficiaryUserId, (byUser.get(award.beneficiaryUserId) ?? 0) + award.points);
  }
  for (const [userId, total] of byUser) {
    await notify({
      type: "routine.awarded",
      companyId,
      // The month-end run has no actor. Null keeps "Reportly" out of the actor
      // column, where it would be rendered as a person.
      actorUserId: null,
      subjectUserId: userId,
      title: `You earned ${halfStep(total)} points for routine work`,
      body: "Your completed routines were scored.",
      link: "/routines",
      entityKind: "routine",
      entityId: null,
    });
  }

  return { count: awards.length, points: halfStep(awards.reduce((s, a) => s + a.points, 0)) };
}

/**
 * The manual award: a month's points scoped to the caller's own routines (or all, for a
 * superadmin). Used by the Team routines "Award" button.
 */
export async function awardMonth(
  ctx: AuthContext,
  companyId: string,
  year: number,
  month: number,
): Promise<{ count: number; points: number }> {
  const managed = ctx.isSuperadmin
    ? await repo.allRoutines(companyId)
    : await repo.managedBy(companyId, ctx.userId);
  const routineIds = managed.map((r) => r.id);
  const monthStart = `${year}-${pad2(month)}-01`;
  const monthEnd = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;
  return writeAwardsFor(
    companyId,
    await completions.unawardedInMonth(routineIds, monthStart, monthEnd),
  );
}

/**
 * The scheduled award: every company's routine points for a month, over all of that
 * company's routines. Idempotent, so the monthly job can safely re-run. Run by the
 * routine-award worker for the month that just closed.
 */
export async function awardAllCompaniesForMonth(
  year: number,
  month: number,
): Promise<{ companies: number; count: number; points: number }> {
  const monthStart = `${year}-${pad2(month)}-01`;
  const monthEnd = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;
  return awardEveryCompany((routineIds) =>
    completions.unawardedInMonth(routineIds, monthStart, monthEnd),
  );
}

/**
 * The boot catch-up: award every company's still-unawarded completions from before
 * `beforeDate` (the first of the current month), so a monthly run the server was down for
 * is not lost. Idempotent, and never touches the open current month.
 */
export async function awardAllCompaniesBefore(
  beforeDate: string,
): Promise<{ companies: number; count: number; points: number }> {
  return awardEveryCompany((routineIds) => completions.unawardedBefore(routineIds, beforeDate));
}

/** Run an award pass over every company, selecting each one's completions with `pick`. */
async function awardEveryCompany(
  pick: (routineIds: string[]) => Promise<AwardableRow[]>,
): Promise<{ companies: number; count: number; points: number }> {
  const companyIds = await repo.allCompanyIds();
  let count = 0;
  let points = 0;
  for (const companyId of companyIds) {
    const routineIds = (await repo.allRoutines(companyId)).map((r) => r.id);
    if (routineIds.length === 0) continue;
    const res = await writeAwardsFor(companyId, await pick(routineIds));
    count += res.count;
    points += res.points;
  }
  return { companies: companyIds.length, count, points: halfStep(points) };
}
