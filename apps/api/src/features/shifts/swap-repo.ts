// Author: Brijesh Dave <https://github.com/brijeshdave>
// Data access for colleague-swap requests. A row joins to both people and both sides'
// current shift, so the inbox reads whole. Approver routing is a set membership: the
// people who report directly to the caller.
import { and, desc, eq, inArray, ne, notInArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/core/db/index.js";
import {
  departmentUsers,
  locations,
  scheduleEntries,
  schedules,
  shiftSwapRequests,
  shifts,
  users,
} from "@/core/db/schema.js";

export interface SwapRow {
  id: string;
  departmentId: string;
  scheduleId: string;
  date: string;
  requesterUserId: string;
  requesterName: string;
  requesterShiftName: string | null;
  requesterEntryId: string | null;
  counterpartUserId: string | null;
  counterpartName: string | null;
  counterpartShiftName: string | null;
  counterpartEntryId: string | null;
  note: string | null;
  crossSite: boolean;
  crossSiteReason: string | null;
  status: string;
  approverUserId: string | null;
  approverName: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

const requester = alias(users, "swap_requester");
const counterpart = alias(users, "swap_counterpart");
const approver = alias(users, "swap_approver");
const requesterEntry = alias(scheduleEntries, "swap_requester_entry");
const counterpartEntry = alias(scheduleEntries, "swap_counterpart_entry");
const requesterShift = alias(shifts, "swap_requester_shift");
const counterpartShift = alias(shifts, "swap_counterpart_shift");

function baseQuery() {
  return (
    db
      .select({
        id: shiftSwapRequests.id,
        departmentId: shiftSwapRequests.departmentId,
        scheduleId: shiftSwapRequests.scheduleId,
        date: shiftSwapRequests.date,
        requesterUserId: shiftSwapRequests.requesterUserId,
        requesterName: requester.name,
        requesterShiftName: requesterShift.name,
        requesterEntryId: shiftSwapRequests.requesterEntryId,
        counterpartUserId: shiftSwapRequests.counterpartUserId,
        counterpartName: counterpart.name,
        counterpartShiftName: counterpartShift.name,
        counterpartEntryId: shiftSwapRequests.counterpartEntryId,
        note: shiftSwapRequests.note,
        crossSite: shiftSwapRequests.crossSite,
        crossSiteReason: shiftSwapRequests.crossSiteReason,
        status: shiftSwapRequests.status,
        approverUserId: shiftSwapRequests.approverUserId,
        approverName: approver.name,
        decidedAt: shiftSwapRequests.decidedAt,
        createdAt: shiftSwapRequests.createdAt,
      })
      .from(shiftSwapRequests)
      .innerJoin(requester, eq(requester.id, shiftSwapRequests.requesterUserId))
      // Left join: a request may not name a counterpart until a manager picks one.
      .leftJoin(counterpart, eq(counterpart.id, shiftSwapRequests.counterpartUserId))
      .leftJoin(approver, eq(approver.id, shiftSwapRequests.approverUserId))
      .leftJoin(requesterEntry, eq(requesterEntry.id, shiftSwapRequests.requesterEntryId))
      .leftJoin(counterpartEntry, eq(counterpartEntry.id, shiftSwapRequests.counterpartEntryId))
      .leftJoin(requesterShift, eq(requesterShift.id, requesterEntry.shiftId))
      .leftJoin(counterpartShift, eq(counterpartShift.id, counterpartEntry.shiftId))
  );
}

/** The people who report directly to `userId` — the swaps they may approve. */
export async function directReportIds(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: departmentUsers.userId })
    .from(departmentUsers)
    .where(eq(departmentUsers.reportsToId, userId));
  return rows.map((r) => r.userId);
}

/** Pending swaps whose requester is one of `requesterIds` (a manager's inbox). */
export async function pendingForRequesters(
  companyId: string,
  requesterIds: string[],
): Promise<SwapRow[]> {
  if (requesterIds.length === 0) return [];
  return baseQuery()
    .where(
      and(
        eq(shiftSwapRequests.companyId, companyId),
        eq(shiftSwapRequests.status, "pending"),
        inArray(shiftSwapRequests.requesterUserId, requesterIds),
      ),
    )
    .orderBy(desc(shiftSwapRequests.createdAt));
}

/** Every pending swap in the company (a scheduler's inbox). */
export async function allPending(companyId: string): Promise<SwapRow[]> {
  return baseQuery()
    .where(and(eq(shiftSwapRequests.companyId, companyId), eq(shiftSwapRequests.status, "pending")))
    .orderBy(desc(shiftSwapRequests.createdAt));
}

/** Swaps the caller raised or is named in, any status. */
export async function mine(companyId: string, userId: string): Promise<SwapRow[]> {
  return baseQuery()
    .where(
      and(
        eq(shiftSwapRequests.companyId, companyId),
        or(
          eq(shiftSwapRequests.requesterUserId, userId),
          eq(shiftSwapRequests.counterpartUserId, userId),
        ),
      ),
    )
    .orderBy(desc(shiftSwapRequests.createdAt));
}

/** Requests the caller has decided — their approval record, most recent first. */
export async function decidedBy(companyId: string, approverUserId: string): Promise<SwapRow[]> {
  return baseQuery()
    .where(
      and(
        eq(shiftSwapRequests.companyId, companyId),
        eq(shiftSwapRequests.approverUserId, approverUserId),
      ),
    )
    .orderBy(desc(shiftSwapRequests.decidedAt));
}

export async function getById(id: string, companyId: string): Promise<SwapRow | null> {
  const [row] = await baseQuery().where(
    and(eq(shiftSwapRequests.id, id), eq(shiftSwapRequests.companyId, companyId)),
  );
  return row ?? null;
}

export interface NewSwap {
  companyId: string;
  departmentId: string;
  scheduleId: string;
  date: string;
  requesterUserId: string;
  requesterEntryId: string;
  counterpartUserId: string | null;
  counterpartEntryId: string | null;
  note: string | null;
}

export async function insertSwap(fields: NewSwap): Promise<string> {
  const [row] = await db
    .insert(shiftSwapRequests)
    .values(fields)
    .returning({ id: shiftSwapRequests.id });
  return row!.id;
}

export async function setDecision(
  id: string,
  status: "approved" | "rejected",
  approverUserId: string,
  /** On approve, the colleague the manager confirmed — written back as the final counterpart. */
  counterpart?: { userId: string; entryId: string },
): Promise<void> {
  await db
    .update(shiftSwapRequests)
    .set({
      status,
      approverUserId,
      decidedAt: new Date(),
      updatedAt: new Date(),
      ...(counterpart
        ? { counterpartUserId: counterpart.userId, counterpartEntryId: counterpart.entryId }
        : {}),
    })
    .where(eq(shiftSwapRequests.id, id));
}

/** True if the requester already has a pending request for that same shift cell. */
export async function hasPendingForEntry(
  companyId: string,
  requesterEntryId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: shiftSwapRequests.id })
    .from(shiftSwapRequests)
    .where(
      and(
        eq(shiftSwapRequests.companyId, companyId),
        eq(shiftSwapRequests.requesterEntryId, requesterEntryId),
        eq(shiftSwapRequests.status, "pending"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Withdraw a still-pending request (the requester changed their mind). */
export async function cancel(id: string): Promise<void> {
  await db
    .update(shiftSwapRequests)
    .set({ status: "cancelled", decidedAt: new Date(), updatedAt: new Date() })
    .where(eq(shiftSwapRequests.id, id));
}

/**
 * Cancel every other pending request that references one of these entries — after an
 * approval moves those shifts, any request still pointing at them is stale and must
 * not be approvable on top of the change.
 */
export async function cancelPendingTouching(
  scheduleId: string,
  entryIds: string[],
  exceptId: string,
): Promise<void> {
  if (entryIds.length === 0) return;
  await db
    .update(shiftSwapRequests)
    .set({ status: "cancelled", decidedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(shiftSwapRequests.scheduleId, scheduleId),
        eq(shiftSwapRequests.status, "pending"),
        ne(shiftSwapRequests.id, exceptId),
        or(
          inArray(shiftSwapRequests.requesterEntryId, entryIds),
          inArray(shiftSwapRequests.counterpartEntryId, entryIds),
        ),
      ),
    );
}

/**
 * Colleagues working the same day as the requester — the manager's swap candidates.
 * The department's Head of Department is never offered: the HOD approves changes, they
 * are not shuffled into shifts by them.
 */
export async function candidatesFor(
  scheduleId: string,
  date: string,
  excludeUserId: string,
  departmentId: string,
): Promise<{ entryId: string; userId: string; name: string; shiftName: string | null }[]> {
  const hods = db
    .select({ id: departmentUsers.userId })
    .from(departmentUsers)
    .where(and(eq(departmentUsers.departmentId, departmentId), eq(departmentUsers.rank, "hod")));

  return db
    .select({
      entryId: scheduleEntries.id,
      userId: scheduleEntries.userId,
      name: users.name,
      shiftName: shifts.name,
    })
    .from(scheduleEntries)
    .innerJoin(users, eq(users.id, scheduleEntries.userId))
    .leftJoin(shifts, eq(shifts.id, scheduleEntries.shiftId))
    .where(
      and(
        eq(scheduleEntries.scheduleId, scheduleId),
        eq(scheduleEntries.date, date),
        eq(scheduleEntries.state, "working"),
        ne(scheduleEntries.userId, excludeUserId),
        notInArray(scheduleEntries.userId, hods),
      ),
    )
    .orderBy(users.name);
}

/** Pending requests on a schedule, thin — enough to mark and explain the cells. */
export async function pendingForSchedule(scheduleId: string): Promise<
  {
    id: string;
    requesterEntryId: string;
    requesterName: string;
    counterpartEntryId: string | null;
    counterpartName: string | null;
    note: string | null;
  }[]
> {
  const rows = await db
    .select({
      id: shiftSwapRequests.id,
      requesterEntryId: shiftSwapRequests.requesterEntryId,
      requesterName: requester.name,
      counterpartEntryId: shiftSwapRequests.counterpartEntryId,
      counterpartName: counterpart.name,
      note: shiftSwapRequests.note,
    })
    .from(shiftSwapRequests)
    .innerJoin(requester, eq(requester.id, shiftSwapRequests.requesterUserId))
    .leftJoin(counterpart, eq(counterpart.id, shiftSwapRequests.counterpartUserId))
    .where(
      and(eq(shiftSwapRequests.scheduleId, scheduleId), eq(shiftSwapRequests.status, "pending")),
    );
  // A pending request always still has its requester cell; narrow the nullable column.
  return rows.filter(
    (r): r is typeof r & { requesterEntryId: string } => r.requesterEntryId !== null,
  );
}

/* ------------------------------ across two sites ---------------------------- */

/**
 * Colleagues working that day on the department's *other* site rotas.
 *
 * Offered so an approver can see that a cross-site trade is possible at all — the
 * ordinary list is one rota, which is what makes same-site the default. Picking one
 * of these is still refused unless the approver says so explicitly.
 */
export async function crossSiteCandidatesFor(
  scheduleId: string,
  date: string,
  excludeUserId: string,
  departmentId: string,
  companyId: string,
): Promise<
  { entryId: string; userId: string; name: string; shiftName: string | null; siteName: string }[]
> {
  const [self] = await db
    .select({ year: schedules.year, month: schedules.month })
    .from(schedules)
    .where(eq(schedules.id, scheduleId));
  if (!self) return [];

  const hods = db
    .select({ id: departmentUsers.userId })
    .from(departmentUsers)
    .where(and(eq(departmentUsers.departmentId, departmentId), eq(departmentUsers.rank, "hod")));

  return (
    db
      .select({
        entryId: scheduleEntries.id,
        userId: scheduleEntries.userId,
        name: users.name,
        shiftName: shifts.name,
        siteName: locations.name,
      })
      .from(scheduleEntries)
      .innerJoin(schedules, eq(schedules.id, scheduleEntries.scheduleId))
      // An inner join on locations also drops the central rota, deliberately: travelling
      // staff are not somebody a plant trades a shift with.
      .innerJoin(locations, eq(locations.id, schedules.locationId))
      .innerJoin(users, eq(users.id, scheduleEntries.userId))
      .leftJoin(shifts, eq(shifts.id, scheduleEntries.shiftId))
      .where(
        and(
          eq(schedules.companyId, companyId),
          eq(schedules.departmentId, departmentId),
          eq(schedules.year, self.year),
          eq(schedules.month, self.month),
          ne(schedules.id, scheduleId),
          eq(scheduleEntries.date, date),
          eq(scheduleEntries.state, "working"),
          ne(scheduleEntries.userId, excludeUserId),
          notInArray(scheduleEntries.userId, hods),
        ),
      )
      .orderBy(users.name)
  );
}

/** One cell and the rota it sits on, for a counterpart that is not on the caller's. */
export async function entryWithSchedule(
  entryId: string,
  companyId: string,
): Promise<{
  id: string;
  scheduleId: string;
  departmentId: string;
  locationId: string | null;
  date: string;
  userId: string;
  shiftId: string | null;
  state: string;
} | null> {
  const [row] = await db
    .select({
      id: scheduleEntries.id,
      scheduleId: scheduleEntries.scheduleId,
      departmentId: schedules.departmentId,
      locationId: schedules.locationId,
      date: scheduleEntries.date,
      userId: scheduleEntries.userId,
      shiftId: scheduleEntries.shiftId,
      state: scheduleEntries.state,
    })
    .from(scheduleEntries)
    .innerJoin(schedules, eq(schedules.id, scheduleEntries.scheduleId))
    .where(and(eq(scheduleEntries.id, entryId), eq(schedules.companyId, companyId)));
  return row ?? null;
}

/** Record that an approver allowed a trade between two sites, and why. */
export async function markCrossSite(swapId: string, reason: string): Promise<void> {
  await db
    .update(shiftSwapRequests)
    .set({ crossSite: true, crossSiteReason: reason, updatedAt: new Date() })
    .where(eq(shiftSwapRequests.id, swapId));
}
