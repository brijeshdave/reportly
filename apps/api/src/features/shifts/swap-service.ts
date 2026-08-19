// Author: Brijesh Dave <https://github.com/brijeshdave>
// Colleague-swap requests: raising one against your own shift and a coworker's on the
// same day, the inbox that routes to the requester's reporting manager, and the
// decision that — on approval — trades the two entries so the calendar's Actual view
// moves while the published plan stays put.
import {
  ERROR_CODES,
  PERMISSIONS,
  can,
  type AuthContext,
  type CreateSwapRequest,
  type SwapDecision,
  type SwapListQuery,
  type SwapRequest,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { notify } from "@/core/queue/notifications.js";
import * as changeLog from "@/features/shifts/change-log-repo.js";
import { cellLabel } from "@/features/shifts/change-log-repo.js";
import * as shiftRepo from "@/features/shifts/repo.js";
import * as scheduleRepo from "@/features/shifts/schedule-repo.js";
import * as repo from "@/features/shifts/swap-repo.js";
import type { SwapRow } from "@/features/shifts/swap-repo.js";

/** The cell label for an entry's shift, resolving the shift name from the catalogue. */
async function labelForEntry(
  companyId: string,
  entry: { shiftId: string | null; state: string },
): Promise<string> {
  const shift = entry.shiftId ? await shiftRepo.getShift(entry.shiftId, companyId) : null;
  return cellLabel(shift?.name ?? null, entry.state);
}

/**
 * Who may decide a swap they are not the reporting manager for.
 *
 * `shifts:approve` counts, not just `shifts:manage`. The two are separate
 * permissions on purpose — approving a colleague swap is not the same authority
 * as building the schedule, and an organisation that wants a supervisor to do the
 * first without the second should be able to say so. It could not: this checked
 * only `shifts:manage`, so `shifts:approve` was granted by two seeded roles,
 * shown in the roles matrix, and read by nothing.
 *
 * `shifts:manage` still counts on its own: whoever builds the schedule can
 * already achieve any swap by editing it directly, so withholding the approval
 * would be a formality rather than a control.
 */
function canDecideAnySwap(ctx: AuthContext): boolean {
  return (
    ctx.isSuperadmin || can(ctx, PERMISSIONS.SHIFTS_APPROVE) || can(ctx, PERMISSIONS.SHIFTS_MANAGE)
  );
}

/**
 * Who may act on somebody else's request administratively — withdrawing it.
 *
 * Deliberately NOT widened to `shifts:approve`. An approver's answer to a request
 * they do not want is to reject it, which leaves a decision on the record;
 * withdrawing it on the requester's behalf erases it instead, and that is a
 * schedule-owner's housekeeping act.
 */
function isScheduler(ctx: AuthContext): boolean {
  return ctx.isSuperadmin || can(ctx, PERMISSIONS.SHIFTS_MANAGE);
}

function serialize(
  row: SwapRow,
  canDecide: boolean,
  candidates: SwapRequest["candidates"] = [],
): SwapRequest {
  return {
    id: row.id,
    departmentId: row.departmentId,
    scheduleId: row.scheduleId,
    date: row.date,
    requesterUserId: row.requesterUserId,
    requesterName: row.requesterName,
    requesterShiftName: row.requesterShiftName,
    requesterEntryId: row.requesterEntryId,
    counterpartUserId: row.counterpartUserId,
    counterpartName: row.counterpartName,
    counterpartShiftName: row.counterpartShiftName,
    counterpartEntryId: row.counterpartEntryId,
    candidates,
    note: row.note,
    crossSite: row.crossSite,
    crossSiteReason: row.crossSiteReason,
    status: (["pending", "approved", "rejected", "cancelled"] as const).includes(
      row.status as never,
    )
      ? (row.status as SwapRequest["status"])
      : "pending",
    approverUserId: row.approverUserId,
    approverName: row.approverName,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    canDecide,
  };
}

/**
 * The colleagues a manager could swap a request's requester with.
 *
 * Their own rota first — those are the ordinary answer, and a rota is one site, so
 * "same site" needs no filter of its own. Then the department's other sites, marked
 * with where they are: an approver can see a cross-site trade is possible, and
 * choosing one is a deliberate act the server still makes them confirm.
 */
async function candidatesFor(row: SwapRow, companyId: string): Promise<SwapRequest["candidates"]> {
  const [sameSite, elsewhere] = await Promise.all([
    repo.candidatesFor(row.scheduleId, row.date, row.requesterUserId, row.departmentId),
    repo.crossSiteCandidatesFor(
      row.scheduleId,
      row.date,
      row.requesterUserId,
      row.departmentId,
      companyId,
    ),
  ]);
  return [
    ...sameSite.map((c) => ({ ...c, otherSiteName: null })),
    ...elsewhere.map(({ siteName, ...c }) => ({ ...c, otherSiteName: siteName })),
  ];
}

export async function createSwap(
  ctx: AuthContext,
  companyId: string,
  scheduleId: string,
  input: CreateSwapRequest,
): Promise<SwapRequest> {
  const schedule = await scheduleRepo.getScheduleById(scheduleId, companyId);
  if (!schedule) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Schedule not found");

  const mineEntry = await scheduleRepo.getEntry(input.requesterEntryId, scheduleId);
  if (!mineEntry) throw new AppError(404, ERROR_CODES.NOT_FOUND, "That shift no longer exists");
  // You can only ask to change your own cell.
  if (mineEntry.userId !== ctx.userId) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You can only change your own shift");
  }
  // A working shift or a weekly off (W/O) can be changed; leave and public holiday cannot.
  if (mineEntry.state === "working" ? !mineEntry.shiftId : mineEntry.state !== "off") {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "You can only change a working shift or a weekly off",
    );
  }
  // One open request per shift — no stacking duplicates for the same cell.
  if (await repo.hasPendingForEntry(companyId, mineEntry.id)) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "You already have a pending request for that shift",
    );
  }

  // A suggested counterpart is optional — the manager can add or change it — but if one
  // is given it must be a colleague's working shift on the same day.
  let counterpartUserId: string | null = null;
  let counterpartEntryId: string | null = null;
  if (input.counterpartEntryId) {
    const theirs = await scheduleRepo.getEntry(input.counterpartEntryId, scheduleId);
    if (!theirs)
      throw new AppError(404, ERROR_CODES.NOT_FOUND, "That colleague's shift no longer exists");
    if (theirs.userId === ctx.userId) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Suggest a colleague, not yourself");
    }
    if (theirs.date !== mineEntry.date || theirs.state !== "working") {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "The suggested swap must be a working shift that day",
      );
    }
    counterpartUserId = theirs.userId;
    counterpartEntryId = theirs.id;
  }

  const id = await repo.insertSwap({
    companyId,
    departmentId: schedule.departmentId,
    scheduleId,
    date: mineEntry.date,
    requesterUserId: ctx.userId,
    requesterEntryId: mineEntry.id,
    counterpartUserId,
    counterpartEntryId,
    note: input.note ?? null,
  });
  const row = await repo.getById(id, companyId);

  // Only when a colleague was actually named. An open request goes to the
  // manager's pending list, which is a screen they visit — not an interruption.
  if (counterpartUserId) {
    await notify({
      type: "shift.swap.requested",
      companyId,
      actorUserId: ctx.userId,
      userIds: [counterpartUserId],
      title: "A colleague asked to swap a shift with you",
      body: input.note ?? `For ${mineEntry.date}.`,
      link: "/schedule/changes",
      entityKind: "shift-swap",
      entityId: id,
    });
  }

  return serialize(row!, false);
}

export async function listSwaps(
  ctx: AuthContext,
  companyId: string,
  query: SwapListQuery,
): Promise<SwapRequest[]> {
  // The inbox has to show what the caller may act on, so it follows the same rule
  // as deciding rather than a narrower one.
  const scheduler = canDecideAnySwap(ctx);

  if (query.box === "inbox") {
    const rows = scheduler
      ? await repo.allPending(companyId)
      : await repo.pendingForRequesters(companyId, await repo.directReportIds(ctx.userId));
    // The inbox is where a manager picks the swap, so it carries the candidate list.
    return Promise.all(
      rows.map(async (r) => serialize(r, true, await candidatesFor(r, companyId))),
    );
  }

  // "handled": the requests the caller has already decided — their approval record.
  if (query.box === "handled") {
    return (await repo.decidedBy(companyId, ctx.userId)).map((r) => serialize(r, false));
  }

  // "mine": the caller's own requests and the ones aimed at them.
  const reports = scheduler ? [] : await repo.directReportIds(ctx.userId);
  const reportSet = new Set(reports);
  return (await repo.mine(companyId, ctx.userId)).map((r) =>
    serialize(r, r.status === "pending" && (scheduler || reportSet.has(r.requesterUserId))),
  );
}

/**
 * A counterpart on another site's rota.
 *
 * Refused unless the approver said so *in this request* and gave a reason. Two
 * plants trading a shift is a real decision with consequences for both — somebody
 * reading the rota next month needs to find out why, and "a manager clicked it" is
 * not an answer. The permission to decide the swap at all is checked above; this is
 * about the decision being on the record.
 */
async function crossSiteCounterpart(
  row: SwapRow,
  counterpartEntryId: string,
  companyId: string,
  decision: SwapDecision,
): Promise<{
  id: string;
  date: string;
  userId: string;
  shiftId: string | null;
  state: string;
} | null> {
  const theirs = await repo.entryWithSchedule(counterpartEntryId, companyId);
  if (!theirs) return null;

  if (!decision.allowCrossSite) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "That colleague is on another site's rota. Confirm the cross-site swap to allow it.",
    );
  }
  if (!decision.crossSiteReason || decision.crossSiteReason.trim().length < 3) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Say why this swap crosses two sites");
  }
  // Still the same department and month: the override loosens *where*, nothing else.
  if (theirs.departmentId !== row.departmentId) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "The counterpart must be in the same department",
    );
  }
  // The central rota is not a site, and its people are not a plant's to trade with.
  if (theirs.locationId === null) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Central staff are scheduled on their own rota and cannot be swapped with a site's",
    );
  }
  return theirs;
}

export async function decideSwap(
  ctx: AuthContext,
  companyId: string,
  swapId: string,
  decision: SwapDecision,
): Promise<SwapRequest> {
  const row = await repo.getById(swapId, companyId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Swap request not found");
  if (row.status !== "pending") {
    throw new AppError(409, ERROR_CODES.CONFLICT, "This request has already been decided");
  }

  // Only the requester's reporting manager, or someone holding shifts:approve /
  // shifts:manage, may decide.
  const scheduler = canDecideAnySwap(ctx);
  const allowed =
    scheduler || (await repo.directReportIds(ctx.userId)).includes(row.requesterUserId);
  if (!allowed) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "Only the reporting manager can decide this swap",
    );
  }

  if (decision.decision === "approve") {
    // The requester's shift must still exist, be theirs, and still be a working shift.
    if (!row.requesterEntryId) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "The requester's shift no longer exists");
    }
    const a = await scheduleRepo.getEntry(row.requesterEntryId, row.scheduleId);
    if (!a || (a.state !== "working" && a.state !== "off")) {
      throw new AppError(409, ERROR_CODES.CONFLICT, "The requester's shift has since changed");
    }

    const common = {
      companyId,
      scheduleId: row.scheduleId,
      departmentId: row.departmentId,
      date: row.date,
      actorUserId: ctx.userId,
      swapId,
    };

    if (decision.noSwap) {
      // Grant the change with no swap: the requester's cell is removed, so the day is
      // left empty/unassigned (a gap for the scheduler to fill) rather than a "W/O".
      // Cancel other pending requests touching it *before* the delete nulls the ref.
      const fromLabel = await labelForEntry(companyId, a);
      await repo.cancelPendingTouching(row.scheduleId, [a.id], swapId);
      await scheduleRepo.deleteEntry(a.id, row.scheduleId);
      await repo.setDecision(swapId, "approved", ctx.userId);
      await changeLog.recordChanges([
        { ...common, subjectUserId: a.userId, action: "swap", fromLabel, toLabel: "—" },
      ]);
    } else {
      // The counterpart is whoever the manager confirmed now, or the request's suggestion.
      const counterpartEntryId = decision.counterpartEntryId ?? row.counterpartEntryId;
      if (!counterpartEntryId) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_ERROR,
          "Choose a colleague to swap with, or approve with no swap",
        );
      }
      // Same rota first — the ordinary case, and the reason same-site needs no rule.
      const sameRota = await scheduleRepo.getEntry(counterpartEntryId, row.scheduleId);
      const b =
        sameRota ?? (await crossSiteCounterpart(row, counterpartEntryId, companyId, decision));
      if (!b)
        throw new AppError(409, ERROR_CODES.CONFLICT, "That colleague's shift has since changed");
      const acrossSites = sameRota === null;
      if (b.userId === a.userId) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_ERROR,
          "The counterpart must be a different person",
        );
      }
      if (a.date !== b.date || b.state !== "working") {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_ERROR,
          "The counterpart must be a working shift that day",
        );
      }
      const [aLabel, bLabel] = await Promise.all([
        labelForEntry(companyId, a),
        labelForEntry(companyId, b),
      ]);
      await scheduleRepo.exchangeEntries(a.id, { shiftId: a.shiftId, state: a.state }, b.id, {
        shiftId: b.shiftId,
        state: b.state,
      });
      // Any other pending request pointing at either traded shift is now stale. A
      // cross-site trade has to clear the other rota too — the stale request lives
      // under *its* schedule, not this one.
      await repo.cancelPendingTouching(row.scheduleId, [a.id, b.id], swapId);
      if (acrossSites) {
        const theirs = await repo.entryWithSchedule(b.id, companyId);
        if (theirs) await repo.cancelPendingTouching(theirs.scheduleId, [b.id], swapId);
        await repo.markCrossSite(swapId, decision.crossSiteReason!);
      }
      await repo.setDecision(swapId, "approved", ctx.userId, { userId: b.userId, entryId: b.id });
      // Log the trade from each person's side, so the change reads both ways.
      await changeLog.recordChanges([
        { ...common, subjectUserId: a.userId, action: "swap", fromLabel: aLabel, toLabel: bLabel },
        { ...common, subjectUserId: b.userId, action: "swap", fromLabel: bLabel, toLabel: aLabel },
      ]);
    }
  } else {
    await repo.setDecision(swapId, "rejected", ctx.userId);
    await changeLog.recordChanges([
      {
        companyId,
        scheduleId: row.scheduleId,
        departmentId: row.departmentId,
        date: row.date,
        actorUserId: ctx.userId,
        swapId,
        subjectUserId: row.requesterUserId,
        action: "reject",
        fromLabel: null,
        toLabel: null,
      },
    ]);
  }

  const decided = decision.decision === "approve" ? "approved" : "declined";
  await notify({
    type: "shift.swap.decided",
    companyId,
    actorUserId: ctx.userId,
    // Both sides of a trade, not just the person who asked: an approved swap
    // changes the counterpart's roster too, and finding that out by looking is
    // how people turn up on the wrong day.
    userIds: [row.requesterUserId, row.counterpartUserId].filter((id): id is string => Boolean(id)),
    title: `Your shift swap was ${decided}`,
    body: decision.decision === "approve" ? `The change is in the roster for ${row.date}.` : "",
    link: "/schedule/changes",
    entityKind: "shift-swap",
    entityId: swapId,
  });

  const fresh = await repo.getById(swapId, companyId);
  return serialize(fresh!, false);
}

/** Withdraw a request. The requester may take back their own while it is still pending. */
export async function cancelSwap(
  ctx: AuthContext,
  companyId: string,
  swapId: string,
): Promise<SwapRequest> {
  const row = await repo.getById(swapId, companyId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Request not found");
  if (row.requesterUserId !== ctx.userId && !isScheduler(ctx)) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "Only the person who raised it can withdraw it");
  }
  if (row.status !== "pending") {
    throw new AppError(409, ERROR_CODES.CONFLICT, "Only a pending request can be withdrawn");
  }
  await repo.cancel(swapId);
  const fresh = await repo.getById(swapId, companyId);
  return serialize(fresh!, false);
}
