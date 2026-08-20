// Author: Brijesh Dave <https://github.com/brijeshdave>
// Data access for the per-department monthly schedules and their cells. Kept beside
// the shift-catalogue repo; the two share the `shifts` table but nothing else.
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";

import type { AuthContext } from "@reportly/shared";

import { db } from "@/core/db/index.js";
import { withLocationsNullable } from "@/core/db/scoped.js";
import {
  locations,
  scheduleEntries,
  scheduleEntryLocations,
  schedules,
  shifts,
  users,
} from "@/core/db/schema.js";

export interface ScheduleRow {
  id: string;
  companyId: string;
  departmentId: string;
  /** Null is the central rota — the people who travel rather than sit at one site. */
  locationId: string | null;
  year: number;
  month: number;
  status: string;
  publishedAt: Date | null;
  locked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntryRow {
  id: string;
  scheduleId: string;
  date: string;
  userId: string;
  shiftId: string | null;
  state: string;
  plannedShiftId: string | null;
  plannedState: string | null;
}

const scheduleCols = {
  id: schedules.id,
  companyId: schedules.companyId,
  departmentId: schedules.departmentId,
  locationId: schedules.locationId,
  year: schedules.year,
  month: schedules.month,
  status: schedules.status,
  publishedAt: schedules.publishedAt,
  locked: schedules.locked,
  createdAt: schedules.createdAt,
  updatedAt: schedules.updatedAt,
};

const entryCols = {
  id: scheduleEntries.id,
  scheduleId: scheduleEntries.scheduleId,
  date: scheduleEntries.date,
  userId: scheduleEntries.userId,
  shiftId: scheduleEntries.shiftId,
  state: scheduleEntries.state,
  plannedShiftId: scheduleEntries.plannedShiftId,
  plannedState: scheduleEntries.plannedState,
};

/**
 * One department's rota for a month **at one site**. A null `locationId` asks for
 * the central rota, and must match a null column rather than compare equal to it —
 * `eq(col, null)` is never true in SQL, which would silently answer "no rota yet"
 * and offer to start a second one.
 */
export async function getScheduleByMonth(
  departmentId: string,
  locationId: string | null,
  year: number,
  month: number,
  companyId: string,
): Promise<ScheduleRow | null> {
  const [row] = await db
    .select(scheduleCols)
    .from(schedules)
    .where(
      and(
        eq(schedules.departmentId, departmentId),
        locationId === null ? isNull(schedules.locationId) : eq(schedules.locationId, locationId),
        eq(schedules.year, year),
        eq(schedules.month, month),
        eq(schedules.companyId, companyId),
      ),
    );
  return row ?? null;
}

export async function getScheduleById(id: string, companyId: string): Promise<ScheduleRow | null> {
  const [row] = await db
    .select(scheduleCols)
    .from(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.companyId, companyId)));
  return row ?? null;
}

export async function insertSchedule(
  companyId: string,
  departmentId: string,
  locationId: string | null,
  year: number,
  month: number,
): Promise<ScheduleRow> {
  const [row] = await db
    .insert(schedules)
    .values({ companyId, departmentId, locationId, year, month })
    .returning(scheduleCols);
  return row!;
}

export async function listEntries(scheduleId: string): Promise<EntryRow[]> {
  return db
    .select(entryCols)
    .from(scheduleEntries)
    .where(eq(scheduleEntries.scheduleId, scheduleId));
}

export async function getEntry(entryId: string, scheduleId: string): Promise<EntryRow | null> {
  const [row] = await db
    .select(entryCols)
    .from(scheduleEntries)
    .where(and(eq(scheduleEntries.id, entryId), eq(scheduleEntries.scheduleId, scheduleId)));
  return row ?? null;
}

/** Every working entry for one person on one day — the set an assignment checks overlap against. */
export async function workingEntriesFor(
  scheduleId: string,
  date: string,
  userId: string,
): Promise<EntryRow[]> {
  return db
    .select(entryCols)
    .from(scheduleEntries)
    .where(
      and(
        eq(scheduleEntries.scheduleId, scheduleId),
        eq(scheduleEntries.date, date),
        eq(scheduleEntries.userId, userId),
        eq(scheduleEntries.state, "working"),
      ),
    );
}

export interface WindowEntryRow {
  date: string;
  userId: string;
  userName: string;
  shiftId: string | null;
  shiftName: string | null;
  startMinute: number | null;
  endMinute: number | null;
  state: string;
}

/**
 * Every schedule entry for a department across [from, to) — the rows the roster,
 * coverage, and attendance reports read. Spans whatever monthly schedules the window
 * touches; joined to the person and (for working cells) the shift.
 */
export async function entriesInWindow(
  ctx: AuthContext,
  companyId: string,
  departmentId: string,
  fromDate: string,
  toDate: string,
): Promise<WindowEntryRow[]> {
  return db
    .select({
      date: scheduleEntries.date,
      userId: scheduleEntries.userId,
      userName: users.name,
      shiftId: scheduleEntries.shiftId,
      shiftName: shifts.name,
      startMinute: shifts.startMinute,
      endMinute: shifts.endMinute,
      state: scheduleEntries.state,
    })
    .from(scheduleEntries)
    .innerJoin(schedules, eq(schedules.id, scheduleEntries.scheduleId))
    .innerJoin(users, eq(users.id, scheduleEntries.userId))
    .leftJoin(shifts, eq(shifts.id, scheduleEntries.shiftId))
    .where(
      and(
        eq(schedules.companyId, companyId),
        eq(schedules.departmentId, departmentId),
        // A department has a rota per site now, so a window across "the
        // department" would otherwise read every plant's roster. The central
        // rota's NULL site stays visible to everyone — travelling staff are not
        // somebody else's secret.
        withLocationsNullable(ctx, schedules.locationId),
        gte(scheduleEntries.date, fromDate),
        lt(scheduleEntries.date, toDate),
      ),
    )
    .orderBy(asc(scheduleEntries.date), asc(users.name));
}

/** Every entry for one person across a set of days — for capturing before-state to log. */
export async function entriesForUserDates(
  scheduleId: string,
  userId: string,
  dates: string[],
): Promise<EntryRow[]> {
  if (dates.length === 0) return [];
  return db
    .select(entryCols)
    .from(scheduleEntries)
    .where(
      and(
        eq(scheduleEntries.scheduleId, scheduleId),
        eq(scheduleEntries.userId, userId),
        inArray(scheduleEntries.date, dates),
      ),
    );
}

export interface NewEntry {
  scheduleId: string;
  date: string;
  userId: string;
  shiftId: string | null;
  state: string;
  plannedShiftId?: string | null;
  plannedState?: string | null;
}

export async function insertEntry(fields: NewEntry): Promise<EntryRow> {
  const [row] = await db.insert(scheduleEntries).values(fields).returning(entryCols);
  return row!;
}

export async function insertEntries(rows: NewEntry[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(scheduleEntries).values(rows);
}

export async function updateEntry(
  entryId: string,
  fields: { shiftId: string | null; state: string },
): Promise<EntryRow | null> {
  const [row] = await db
    .update(scheduleEntries)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(scheduleEntries.id, entryId))
    .returning(entryCols);
  return row ?? null;
}

/**
 * Replace one person's cells across many days in a single transaction: clear those
 * days, then (unless clearing) put one entry on each. Predictable — a bulk apply
 * leaves exactly one shift per selected day, doubles included.
 *
 * The brush deletes and re-inserts rows, which would drop the published baseline and
 * hide a post-publish edit. So on a `published` schedule the baseline is carried: an
 * existing cell keeps its `planned*`, and a brand-new cell is baselined as "off" (it
 * was empty in the plan), so any edit after publishing still reads as a change.
 */
export async function replaceDays(
  scheduleId: string,
  userId: string,
  dates: string[],
  insert: { shiftId: string | null; state: string } | null,
  published: boolean,
  /** Sites to tag every replaced day with — central rota only. */
  locationIds: string[] = [],
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        date: scheduleEntries.date,
        plannedShiftId: scheduleEntries.plannedShiftId,
        plannedState: scheduleEntries.plannedState,
      })
      .from(scheduleEntries)
      .where(
        and(
          eq(scheduleEntries.scheduleId, scheduleId),
          eq(scheduleEntries.userId, userId),
          inArray(scheduleEntries.date, dates),
        ),
      );
    const baseline = new Map<
      string,
      { plannedShiftId: string | null; plannedState: string | null }
    >();
    for (const e of existing) {
      if (!baseline.has(e.date))
        baseline.set(e.date, { plannedShiftId: e.plannedShiftId, plannedState: e.plannedState });
    }

    await tx
      .delete(scheduleEntries)
      .where(
        and(
          eq(scheduleEntries.scheduleId, scheduleId),
          eq(scheduleEntries.userId, userId),
          inArray(scheduleEntries.date, dates),
        ),
      );
    if (insert) {
      await tx.insert(scheduleEntries).values(
        dates.map((date) => {
          const base = baseline.get(date);
          const planned =
            base && base.plannedState !== null
              ? base
              : published
                ? { plannedShiftId: null, plannedState: "off" }
                : { plannedShiftId: null, plannedState: null };
          return {
            scheduleId,
            date,
            userId,
            shiftId: insert.shiftId,
            state: insert.state,
            plannedShiftId: planned.plannedShiftId,
            plannedState: planned.plannedState,
          };
        }),
      );
      // The old cells went with the delete above, and their site tags cascaded with
      // them — so this sets the whole set for the days just written, never merges.
      if (locationIds.length > 0) {
        const written = await tx
          .select({ id: scheduleEntries.id })
          .from(scheduleEntries)
          .where(
            and(
              eq(scheduleEntries.scheduleId, scheduleId),
              eq(scheduleEntries.userId, userId),
              inArray(scheduleEntries.date, dates),
            ),
          );
        await tx
          .insert(scheduleEntryLocations)
          .values(
            written.flatMap((entry) =>
              locationIds.map((locationId) => ({ entryId: entry.id, locationId })),
            ),
          );
      }
    }
  });
}

export async function deleteEntry(entryId: string, scheduleId: string): Promise<boolean> {
  const rows = await db
    .delete(scheduleEntries)
    .where(and(eq(scheduleEntries.id, entryId), eq(scheduleEntries.scheduleId, scheduleId)))
    .returning({ id: scheduleEntries.id });
  return rows.length > 0;
}

export async function setLocked(scheduleId: string, locked: boolean): Promise<void> {
  await db
    .update(schedules)
    .set({ locked, updatedAt: new Date() })
    .where(eq(schedules.id, scheduleId));
}

/** Freeze the baseline: copy each entry's live shift/state into its `planned*`, mark published. */
export async function publish(scheduleId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(scheduleEntries)
      .set({ plannedShiftId: scheduleEntries.shiftId, plannedState: scheduleEntries.state })
      .where(eq(scheduleEntries.scheduleId, scheduleId));
    await tx
      .update(schedules)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(schedules.id, scheduleId));
  });
}

/** Exchange the shift/state of two entries in one transaction — an approved swap. */
export async function exchangeEntries(
  aId: string,
  a: { shiftId: string | null; state: string },
  bId: string,
  b: { shiftId: string | null; state: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(scheduleEntries)
      .set({ shiftId: b.shiftId, state: b.state, updatedAt: new Date() })
      .where(eq(scheduleEntries.id, aId));
    await tx
      .update(scheduleEntries)
      .set({ shiftId: a.shiftId, state: a.state, updatedAt: new Date() })
      .where(eq(scheduleEntries.id, bId));
  });
}

/* --------------------------- where a day was spent -------------------------- */

/**
 * The sites tagged on each cell of a rota, keyed by entry id.
 *
 * Only central rotas carry these: on a site rota the site is the rota's own, and
 * repeating it on every cell would be noise that can also disagree with itself.
 */
export async function locationsByEntry(scheduleId: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      entryId: scheduleEntryLocations.entryId,
      locationId: scheduleEntryLocations.locationId,
    })
    .from(scheduleEntryLocations)
    .innerJoin(scheduleEntries, eq(scheduleEntries.id, scheduleEntryLocations.entryId))
    .where(eq(scheduleEntries.scheduleId, scheduleId));

  const byEntry = new Map<string, string[]>();
  for (const row of rows) {
    byEntry.set(row.entryId, [...(byEntry.get(row.entryId) ?? []), row.locationId]);
  }
  return byEntry;
}

/** Replace the sites tagged on one cell — the whole set, like every other set here. */
export async function setEntryLocations(entryId: string, locationIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(scheduleEntryLocations).where(eq(scheduleEntryLocations.entryId, entryId));
    if (locationIds.length > 0) {
      await tx
        .insert(scheduleEntryLocations)
        .values(locationIds.map((locationId) => ({ entryId, locationId })));
    }
  });
}

/**
 * One person's own cells in a department for a month, across **every** rota it has
 * — each site's and the central one.
 *
 * Asking somebody to name the rota their shift is on before they can ask to change
 * it is asking them to know the org chart. They know the day; this finds the cell.
 */
export async function myEntriesInDepartment(
  companyId: string,
  departmentId: string,
  userId: string,
  year: number,
  month: number,
): Promise<
  (EntryRow & {
    locationId: string | null;
    locationName: string | null;
    shiftName: string | null;
  })[]
> {
  return db
    .select({
      id: scheduleEntries.id,
      scheduleId: scheduleEntries.scheduleId,
      date: scheduleEntries.date,
      userId: scheduleEntries.userId,
      shiftId: scheduleEntries.shiftId,
      state: scheduleEntries.state,
      plannedShiftId: scheduleEntries.plannedShiftId,
      plannedState: scheduleEntries.plannedState,
      locationId: schedules.locationId,
      locationName: locations.name,
      shiftName: shifts.name,
    })
    .from(scheduleEntries)
    .innerJoin(schedules, eq(schedules.id, scheduleEntries.scheduleId))
    .leftJoin(locations, eq(locations.id, schedules.locationId))
    .leftJoin(shifts, eq(shifts.id, scheduleEntries.shiftId))
    .where(
      and(
        eq(schedules.companyId, companyId),
        eq(schedules.departmentId, departmentId),
        eq(schedules.year, year),
        eq(schedules.month, month),
        eq(scheduleEntries.userId, userId),
      ),
    )
    .orderBy(asc(scheduleEntries.date));
}
