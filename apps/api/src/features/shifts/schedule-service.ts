// Author: Brijesh Dave <https://github.com/brijeshdave>
// The per-department monthly schedule: reading the calendar grid, building a month
// (optionally carried forward from another), assigning cells with the overlap guard,
// and publishing to freeze the scheduled baseline.
//
// Row scope is the department's: a reader must belong to the department, unless they
// hold shifts:manage (a scheduler, company-wide). Coverage and gap flags come from
// the pure `coverage` helpers so the maths is the same one the tests pin down.
import {
  SCHEDULE_STATE_COLORS,
  ERROR_CODES,
  PERMISSIONS,
  SHIFT_COLORS,
  can,
  scheduleDates,
  type AssignEntry,
  type AuthContext,
  type BulkAssign,
  type CreateSchedule,
  type EntryState,
  type Schedule,
  type ScheduleEntry,
  type ScheduleGrid,
  type MyEntriesQuery,
  type MyEntry,
  type ScheduleQuery,
} from "@reportly/shared";

import { eq } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { users } from "@/core/db/schema.js";
import { AppError } from "@/core/errors.js";
import { getEffectiveSetting } from "@/core/settings/service.js";
import { notify } from "@/core/queue/notifications.js";
import { avatarVersions } from "@/features/avatars/repo.js";
import * as changeLog from "@/features/shifts/change-log-repo.js";
import { cellLabel } from "@/features/shifts/change-log-repo.js";
import * as deptRepo from "@/features/departments/repo.js";
import * as locationService from "@/features/locations/service.js";
import { shiftsOverlap, coverageFor, type CoverageShift } from "@/features/shifts/coverage.js";
import * as shiftRepo from "@/features/shifts/repo.js";
import * as repo from "@/features/shifts/schedule-repo.js";
import type { EntryRow, ScheduleRow } from "@/features/shifts/schedule-repo.js";
import * as swapRepo from "@/features/shifts/swap-repo.js";

/** A quick shiftId → name lookup, for resolving change-log labels. */
async function shiftNames(companyId: string): Promise<Map<string, string>> {
  const rows = await shiftRepo.listShifts(companyId);
  return new Map(rows.map((s) => [s.id, s.name]));
}

const asEntryState = (value: string | null): EntryState | null =>
  value === "working" || value === "off" || value === "leave" || value === "holiday" ? value : null;

function serializeSchedule(
  row: ScheduleRow,
  departmentName: string,
  locationName: string | null,
): Schedule {
  return {
    id: row.id,
    departmentId: row.departmentId,
    departmentName,
    locationId: row.locationId,
    locationName,
    year: row.year,
    month: row.month,
    status: row.status === "published" ? "published" : "draft",
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    locked: row.locked,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeEntry(row: EntryRow, locationIds: string[] = []): ScheduleEntry {
  return {
    id: row.id,
    date: row.date,
    userId: row.userId,
    shiftId: row.shiftId,
    state: asEntryState(row.state) ?? "working",
    plannedShiftId: row.plannedShiftId,
    plannedState: asEntryState(row.plannedState),
    locationIds,
  };
}

/**
 * Who this rota is for.
 *
 * A site rota holds the people whose membership covers that site — and a membership
 * covering *no* sites already means "all of them", so those people appear on every
 * site's rota, which is what that has always meant elsewhere in the app.
 *
 * The central rota holds exactly the people flagged central, and they appear on no
 * site rota at all: they are scheduled once, in one place, rather than turning up
 * as a ghost row on three plants that cannot edit them.
 */
function rosterFor<T extends { userId: string; isCentral: boolean; locationIds: string[] }>(
  members: T[],
  locationId: string | null,
  alreadyRostered: ReadonlySet<string> = new Set(),
): T[] {
  const belongs = (m: T): boolean =>
    locationId === null
      ? m.isCentral
      : !m.isCentral && (m.locationIds.length === 0 || m.locationIds.includes(locationId));

  // Anyone already holding a cell stays on the rota they are on, whatever the rule
  // says about where they belong now. Two reasons, and the first is the important
  // one: every rota that existed before sites did lands on the central rota, and a
  // roster computed purely from the rule would empty it — a month of published
  // shifts, still in the table, with nobody to show them against. The second is
  // ordinary drift: somebody reassigned mid-month has not stopped having worked the
  // first half of it.
  return members.filter((m) => belongs(m) || alreadyRostered.has(m.userId));
}

/** A reader sees a department's schedule if they belong to it, or hold shifts:manage. */
async function assertCanRead(ctx: AuthContext, departmentId: string): Promise<void> {
  if (ctx.isSuperadmin || can(ctx, PERMISSIONS.SHIFTS_MANAGE)) return;
  const mine = await deptRepo.departmentsForUser(ctx.userId);
  if (!mine.some((d) => d.departmentId === departmentId)) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You are not in this department");
  }
}

/**
 * Resolve the rota's site, and refuse one that is not this company's — a rota keyed
 * by an id from somewhere else would be invisible to every list that filters by
 * company. Null is not an error: it is the central rota.
 */
async function requireSite(
  companyId: string,
  ctx: AuthContext,
  locationId: string | null,
): Promise<{ id: string; name: string } | null> {
  if (locationId === null) return null;
  // The *scoped* list, deliberately: this is what makes rota access location-aware.
  // A site the caller's groups do not reach is not theirs to roster, and answering
  // 404 rather than 403 keeps it from confirming the site exists at all.
  const sites = await locationService.listLocations(companyId, ctx);
  const site = sites.find((s) => s.id === locationId);
  if (!site) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Site not found");
  return { id: site.id, name: site.name };
}

/** The sites this caller may tag a central person's day with. */
async function companySites(
  companyId: string,
  ctx: AuthContext,
): Promise<{ id: string; name: string }[]> {
  const sites = await locationService.listLocations(companyId, ctx);
  return sites.filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name }));
}

async function requireDepartment(
  companyId: string,
  departmentId: string,
): Promise<{ name: string }> {
  const dept = await deptRepo.getDepartment(departmentId, companyId);
  if (!dept) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Department not found");
  return { name: dept.name };
}

/**
 * The name to stamp an export with. Falls back to "a user" rather than throwing: a
 * missing display name is not a reason to refuse somebody their roster.
 */
export async function exporterName(userId: string): Promise<string> {
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return row?.name ?? "a user";
}

export async function getGrid(
  ctx: AuthContext,
  companyId: string,
  query: ScheduleQuery,
): Promise<ScheduleGrid> {
  const dept = await requireDepartment(companyId, query.departmentId);
  await assertCanRead(ctx, query.departmentId);
  const site = await requireSite(companyId, ctx, query.locationId ?? null);

  const [scheduleRow, allMembers, allShifts] = await Promise.all([
    repo.getScheduleByMonth(
      query.departmentId,
      query.locationId ?? null,
      query.year,
      query.month,
      companyId,
    ),
    deptRepo.getMembers(query.departmentId),
    shiftRepo.listShifts(companyId),
  ]);

  const activeShifts = allShifts.filter((s) => s.status === "active");
  const entries = scheduleRow ? await repo.listEntries(scheduleRow.id) : [];
  const members = rosterFor(
    allMembers,
    query.locationId ?? null,
    new Set(entries.map((e) => e.userId)),
  );
  // Only the central rota tags a cell with sites; on a site rota it is the rota's own.
  const entrySites =
    scheduleRow && query.locationId === undefined
      ? await repo.locationsByEntry(scheduleRow.id)
      : new Map<string, string[]>();
  const pendingChanges = scheduleRow ? await swapRepo.pendingForSchedule(scheduleRow.id) : [];
  const days = scheduleDates(query.year, query.month);
  const memberIds = members.map((m) => m.userId);
  const versions = await avatarVersions(memberIds);

  const coverageShifts: CoverageShift[] = activeShifts.map((s) => ({
    id: s.id,
    startMinute: s.startMinute,
    endMinute: s.endMinute,
    runsOnDays: s.runsOnDays,
  }));
  const coverage = coverageFor(
    days,
    memberIds,
    coverageShifts,
    entries.map((e) => ({ date: e.date, userId: e.userId, shiftId: e.shiftId, state: e.state })),
  );

  // The company's own answer where it has one, the shipped defaults otherwise.
  const stateColors = await getEffectiveSetting(SCHEDULE_STATE_COLORS, { companyId });

  return {
    stateColors,
    departmentId: query.departmentId,
    departmentName: dept.name,
    locationId: query.locationId ?? null,
    locationName: site?.name ?? null,
    // Offered for tagging a central person's day; a site rota needs no such choice.
    locationOptions: query.locationId === undefined ? await companySites(companyId, ctx) : [],
    year: query.year,
    month: query.month,
    schedule: scheduleRow ? serializeSchedule(scheduleRow, dept.name, site?.name ?? null) : null,
    days,
    shifts: activeShifts.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      color: (SHIFT_COLORS as readonly string[]).includes(s.color)
        ? (s.color as (typeof SHIFT_COLORS)[number])
        : "slate",
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      runsOnDays: [...(s.runsOnDays ?? [0, 1, 2, 3, 4, 5, 6])].sort((a, b) => a - b),
      status: s.status === "disabled" ? "disabled" : "active",
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    members: members.map((m) => ({
      userId: m.userId,
      name: m.name,
      avatarVersion: versions.get(m.userId) ?? null,
      isHod: m.rank === "hod",
    })),
    entries: entries.map((e) => serializeEntry(e, entrySites.get(e.id) ?? [])),
    coverage,
    pendingChanges,
  };
}

/**
 * The caller's own cells in a department for a month, wherever they are rostered.
 * No permission beyond being in the department: these are their own shifts.
 */
export async function myEntries(
  ctx: AuthContext,
  companyId: string,
  query: MyEntriesQuery,
): Promise<MyEntry[]> {
  await requireDepartment(companyId, query.departmentId);
  await assertCanRead(ctx, query.departmentId);
  const rows = await repo.myEntriesInDepartment(
    companyId,
    query.departmentId,
    ctx.userId,
    query.year,
    query.month,
  );
  return rows.map((row) => ({
    entryId: row.id,
    scheduleId: row.scheduleId,
    date: row.date,
    shiftId: row.shiftId,
    shiftName: row.shiftName,
    state: asEntryState(row.state) ?? "working",
    locationId: row.locationId,
    locationName: row.locationName,
  }));
}

/**
 * Delete a month's rota — the plan and every cell in it.
 *
 * Asked for from production: there was no way to remove one, so a month started by
 * mistake stayed on the calendar for ever.
 *
 * Behind its own permission rather than `shifts:manage`, because building a rota
 * and destroying a published one are different acts: the second takes a month of
 * somebody's planning with it. The permission ends in `:delete`, which the role
 * tiers already reserve for a superadmin.
 *
 * Returns what was deleted so the audit row says which month, department and site
 * went — an id alone would be unreadable a week later.
 */
export async function deleteSchedule(
  ctx: AuthContext,
  companyId: string,
  id: string,
): Promise<Schedule> {
  const row = await repo.getScheduleById(id, companyId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Schedule not found");
  await assertCanRead(ctx, row.departmentId);

  const dept = await requireDepartment(companyId, row.departmentId);
  const site = await requireSite(companyId, ctx, row.locationId);
  const deleted = serializeSchedule(row, dept.name, site?.name ?? null);

  await repo.deleteSchedule(id, companyId);
  return deleted;
}

export async function createSchedule(
  ctx: AuthContext,
  companyId: string,
  input: CreateSchedule,
): Promise<Schedule> {
  const dept = await requireDepartment(companyId, input.departmentId);
  const locationId = input.locationId ?? null;

  // A company with sites must say which rota this is. Left implicit, "no site" reads
  // as the central rota — and a department's ordinary staff are not on it, so the
  // month would open empty and look like a bug in the roster rather than a choice.
  if (locationId === null && !input.central) {
    const sites = await companySites(companyId, ctx);
    if (sites.length > 0) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Choose a site for this rota, or start the central rota for travelling staff",
      );
    }
  }

  const site = await requireSite(companyId, ctx, locationId);
  if (
    await repo.getScheduleByMonth(
      input.departmentId,
      locationId,
      input.year,
      input.month,
      companyId,
    )
  ) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "A schedule for that month already exists");
  }

  const created = await repo.insertSchedule(
    companyId,
    input.departmentId,
    locationId,
    input.year,
    input.month,
  );

  if (input.carryForwardFrom) {
    // Carried forward from the *same* rota — a month at Plant A continues Plant A,
    // and the central rota continues itself.
    const source = await repo.getScheduleByMonth(
      input.departmentId,
      locationId,
      input.carryForwardFrom.year,
      input.carryForwardFrom.month,
      companyId,
    );
    if (source) {
      const sourceEntries = await repo.listEntries(source.id);
      const lastDay = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const carried = sourceEntries
        .map((e) => ({ day: Number(e.date.slice(8, 10)), e }))
        .filter(({ day }) => day <= lastDay)
        .map(({ day, e }) => ({
          scheduleId: created.id,
          date: `${input.year}-${pad2(input.month)}-${pad2(day)}`,
          userId: e.userId,
          shiftId: e.shiftId,
          state: e.state,
        }));
      await repo.insertEntries(carried);
    }
  }

  return serializeSchedule(created, dept.name, site?.name ?? null);
}

/** Fetch a schedule in the caller's company, or 404. */
async function requireSchedule(companyId: string, scheduleId: string): Promise<ScheduleRow> {
  const row = await repo.getScheduleById(scheduleId, companyId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Schedule not found");
  return row;
}

/** A locked schedule refuses direct edits — only approved swaps still move it. */
function assertUnlocked(schedule: ScheduleRow): void {
  if (schedule.locked) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This schedule is locked — only a swap can change it",
    );
  }
}

export async function setLock(
  ctx: AuthContext,
  companyId: string,
  scheduleId: string,
  locked: boolean,
): Promise<Schedule> {
  const schedule = await requireSchedule(companyId, scheduleId);
  // Locking is a scheduler's act; unlocking is reserved for the department's HOD, so a
  // locked plan cannot be quietly reopened by whoever built it.
  if (!locked && !ctx.isSuperadmin) {
    const members = await deptRepo.getMembers(schedule.departmentId);
    const mine = members.find((m) => m.userId === ctx.userId);
    if (mine?.rank !== "hod") {
      throw new AppError(
        403,
        ERROR_CODES.FORBIDDEN,
        "Only the Head of Department can unlock a schedule",
      );
    }
  }
  await repo.setLocked(scheduleId, locked);
  await changeLog.recordChanges([
    {
      companyId,
      scheduleId,
      departmentId: schedule.departmentId,
      date: null,
      subjectUserId: null,
      actorUserId: ctx.userId,
      action: locked ? "lock" : "unlock",
      fromLabel: null,
      toLabel: null,
    },
  ]);
  const dept = await deptRepo.getDepartment(schedule.departmentId, companyId);
  const site = await requireSite(companyId, ctx, schedule.locationId);
  const fresh = await repo.getScheduleById(scheduleId, companyId);
  return serializeSchedule(fresh!, dept?.name ?? "", site?.name ?? null);
}

export async function assignEntry(
  ctx: AuthContext,
  companyId: string,
  scheduleId: string,
  input: AssignEntry,
): Promise<ScheduleEntry> {
  const schedule = await requireSchedule(companyId, scheduleId);
  assertUnlocked(schedule);

  // The date must fall inside the schedule's month.
  const [y, m] = [input.date.slice(0, 4), input.date.slice(5, 7)].map(Number);
  if (y !== schedule.year || m !== schedule.month) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Date is outside this schedule's month");
  }

  // The person must belong to the department — and to *this* rota. A site rota holds
  // the people who work that site; the central rota holds the ones who travel. Being
  // in the department is no longer enough, or a central person could be rostered at a
  // plant as well as centrally and nobody would know which was real.
  const members = await deptRepo.getMembers(schedule.departmentId);
  if (!members.some((mem) => mem.userId === input.userId)) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That person is not in this department");
  }
  // Central staff are rostered centrally, so a site's rota may not also claim them:
  // that is the double-booking the separate rota exists to prevent. The other way
  // round is left open on purpose — the central rota is also where every pre-site
  // rota landed, and refusing edits there would strand them.
  const person = members.find((mem) => mem.userId === input.userId);
  if (schedule.locationId !== null && person?.isCentral) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "That person is central — roster them on the department's central rota",
    );
  }

  // Where they spent the day. Only the central rota carries this.
  const dayLocationIds: string[] = input.locationIds ?? [];
  if (dayLocationIds.length > 0) {
    if (schedule.locationId !== null) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "A site rota's cells are already at that site",
      );
    }
    const allowed = new Set((await companySites(companyId, ctx)).map((site) => site.id));
    if (dayLocationIds.some((id) => !allowed.has(id))) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Site not found");
    }
  }

  // Working means a real, active shift; Off/Leave carry no shift.
  const working = input.state === "working";
  let shiftId: string | null = null;
  if (working) {
    if (!input.shiftId) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a shift, or set Off/Leave");
    }
    const shift = await shiftRepo.getShift(input.shiftId, companyId);
    if (!shift) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Shift not found");
    if (shift.status !== "active") {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That shift is disabled");
    }
    // No time-overlapping shift the same day for this person. A non-overlapping
    // second shift (a double) is allowed; the same slot is edited via entryId.
    const others = (await repo.workingEntriesFor(scheduleId, input.date, input.userId)).filter(
      (e) => e.id !== input.entryId,
    );
    for (const other of others) {
      if (!other.shiftId) continue;
      const os = await shiftRepo.getShift(other.shiftId, companyId);
      if (os && shiftsOverlap(shift.startMinute, shift.endMinute, os.startMinute, os.endMinute)) {
        throw new AppError(
          409,
          ERROR_CODES.CONFLICT,
          "That overlaps a shift they already have that day",
        );
      }
    }
    shiftId = shift.id;
  }

  // A change to a published schedule is logged as a deviation from the plan.
  const logEdit = async (fromLabel: string, toLabel: string) => {
    if (schedule.status !== "published" || fromLabel === toLabel) return;
    await changeLog.recordChanges([
      {
        companyId,
        scheduleId,
        departmentId: schedule.departmentId,
        date: input.date,
        subjectUserId: input.userId,
        actorUserId: ctx.userId,
        action: "assign",
        fromLabel,
        toLabel,
      },
    ]);
  };
  const names = schedule.status === "published" ? await shiftNames(companyId) : null;
  const toLabel = cellLabel(shiftId ? (names?.get(shiftId) ?? null) : null, input.state);

  if (input.entryId) {
    const existing = await repo.getEntry(input.entryId, scheduleId);
    if (!existing) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Entry not found");
    const updated = await repo.updateEntry(input.entryId, { shiftId, state: input.state });
    await logEdit(
      cellLabel(existing.shiftId ? (names?.get(existing.shiftId) ?? null) : null, existing.state),
      toLabel,
    );
    if (input.locationIds !== undefined)
      await repo.setEntryLocations(input.entryId, dayLocationIds);
    return serializeEntry(updated!, dayLocationIds);
  }

  const created = await repo.insertEntry({
    scheduleId,
    date: input.date,
    userId: input.userId,
    shiftId,
    state: input.state,
    // On a published schedule a new cell is baselined as "off" (empty in the plan), so
    // the addition shows as a change like everything else after publishing.
    ...(schedule.status === "published" ? { plannedShiftId: null, plannedState: "off" } : {}),
  });
  await logEdit("—", toLabel);
  if (dayLocationIds.length > 0) await repo.setEntryLocations(created.id, dayLocationIds);
  return serializeEntry(created, dayLocationIds);
}

export async function bulkAssign(
  ctx: AuthContext,
  companyId: string,
  scheduleId: string,
  input: BulkAssign,
): Promise<{ count: number }> {
  const actorUserId = ctx.userId;
  const schedule = await requireSchedule(companyId, scheduleId);
  assertUnlocked(schedule);

  const members = await deptRepo.getMembers(schedule.departmentId);
  if (!members.some((mem) => mem.userId === input.userId)) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That person is not in this department");
  }
  for (const date of input.dates) {
    const [y, m] = [date.slice(0, 4), date.slice(5, 7)].map(Number);
    if (y !== schedule.year || m !== schedule.month) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "A date is outside this schedule's month",
      );
    }
  }

  let insert: { shiftId: string | null; state: string } | null = null;
  if (input.set) {
    if (input.set.state === "working") {
      if (!input.set.shiftId) {
        throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a shift, or set Off/Leave/PH");
      }
      const shift = await shiftRepo.getShift(input.set.shiftId, companyId);
      if (!shift || shift.status !== "active") {
        throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That shift is not available");
      }
      insert = { shiftId: shift.id, state: "working" };
    } else {
      insert = { shiftId: null, state: input.set.state };
    }
  }

  const published = schedule.status === "published";
  // Capture before-state so a published edit logs from→to per day.
  const before = published
    ? await repo.entriesForUserDates(scheduleId, input.userId, input.dates)
    : [];
  const bulkSites = input.locationIds ?? [];
  if (bulkSites.length > 0) {
    if (schedule.locationId !== null) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "A site rota's cells are already at that site",
      );
    }
    const allowed = new Set((await companySites(companyId, ctx)).map((site) => site.id));
    if (bulkSites.some((id) => !allowed.has(id))) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Site not found");
    }
  }
  await repo.replaceDays(scheduleId, input.userId, input.dates, insert, published, bulkSites);

  if (published) {
    const names = await shiftNames(companyId);
    const beforeByDate = new Map<string, { shiftId: string | null; state: string }>();
    for (const e of before) if (!beforeByDate.has(e.date)) beforeByDate.set(e.date, e);
    const toLabel = insert
      ? cellLabel(insert.shiftId ? (names.get(insert.shiftId) ?? null) : null, insert.state)
      : "—";
    const rows = input.dates.flatMap((date) => {
      const b = beforeByDate.get(date);
      const fromLabel = b
        ? cellLabel(b.shiftId ? (names.get(b.shiftId) ?? null) : null, b.state)
        : "—";
      if (fromLabel === toLabel) return [];
      return [
        {
          companyId,
          scheduleId,
          departmentId: schedule.departmentId,
          date,
          subjectUserId: input.userId,
          actorUserId,
          action: insert ? "assign" : "clear",
          fromLabel,
          toLabel,
        },
      ];
    });
    await changeLog.recordChanges(rows);
  }
  return { count: input.dates.length };
}

export async function deleteEntry(
  actorUserId: string,
  companyId: string,
  scheduleId: string,
  entryId: string,
): Promise<void> {
  const schedule = await requireSchedule(companyId, scheduleId);
  assertUnlocked(schedule);
  const entry = await repo.getEntry(entryId, scheduleId);
  const removed = await repo.deleteEntry(entryId, scheduleId);
  if (!removed || !entry) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Entry not found");
  if (schedule.status === "published") {
    const names = await shiftNames(companyId);
    await changeLog.recordChanges([
      {
        companyId,
        scheduleId,
        departmentId: schedule.departmentId,
        date: entry.date,
        subjectUserId: entry.userId,
        actorUserId,
        action: "clear",
        fromLabel: cellLabel(
          entry.shiftId ? (names.get(entry.shiftId) ?? null) : null,
          entry.state,
        ),
        toLabel: "—",
      },
    ]);
  }
}

export async function publishSchedule(
  ctx: AuthContext,
  companyId: string,
  scheduleId: string,
): Promise<Schedule> {
  const actorUserId = ctx.userId;
  const schedule = await requireSchedule(companyId, scheduleId);
  // Publishing a site's rota is managing that site: refuse one the caller's groups
  // do not reach, before anything is frozen.
  const site = await requireSite(companyId, ctx, schedule.locationId);
  const siteLabel = site?.name ?? null;
  await repo.publish(scheduleId);
  await changeLog.recordChanges([
    {
      companyId,
      scheduleId,
      departmentId: schedule.departmentId,
      date: null,
      subjectUserId: null,
      actorUserId,
      action: "publish",
      fromLabel: null,
      toLabel: null,
    },
  ]);
  const dept = await deptRepo.getDepartment(schedule.departmentId, companyId);
  await notify({
    type: "shift.schedule.published",
    companyId,
    actorUserId,
    departmentId: schedule.departmentId,
    title: siteLabel
      ? `The ${dept?.name ?? "department"} roster for ${siteLabel} was published`
      : `The ${dept?.name ?? "department"} roster was published`,
    body: "Your shifts for the period are now final.",
    link: "/schedule",
    entityKind: "schedule",
    entityId: scheduleId,
  });
  const fresh = await repo.getScheduleById(scheduleId, companyId);
  return serializeSchedule(fresh!, dept?.name ?? "", siteLabel);
}
