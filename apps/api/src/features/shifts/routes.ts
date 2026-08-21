// Author: Brijesh Dave <https://github.com/brijeshdave>
// Shift catalogue routes, scoped to the active company (X-Company-Id -> ctx.companyId).
// `shifts:read` lists; `shifts:manage` creates/edits/deletes. Zod schemas validate
// and document; every mutation is audited. The per-department schedule routes are
// added alongside these in a later phase.
import {
  ERROR_CODES,
  PERMISSIONS,
  assignEntrySchema,
  bulkAssignSchema,
  createScheduleSchema,
  createShiftSchema,
  createSwapRequestSchema,
  scheduleEntrySchema,
  scheduleGridSchema,
  myEntriesQuerySchema,
  myEntrySchema,
  scheduleQuerySchema,
  scheduleSchema,
  shiftSchema,
  swapDecisionSchema,
  swapListQuerySchema,
  swapRequestSchema,
  updateShiftSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { sendXlsx } from "@/core/spreadsheet/http.js";
import { AppError } from "@/core/errors.js";
import { trackChanges } from "@/core/history.js";
import { scheduleToHtml, scheduleToXlsx } from "@/features/shifts/export.js";
import * as schedule from "@/features/shifts/schedule-service.js";
import * as shifts from "@/features/shifts/service.js";
import * as swaps from "@/features/shifts/swap-service.js";

const idParams = z.object({ id: z.guid() });

function activeCompany(companyId: string | null): string {
  if (!companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "X-Company-Id header is required");
  }
  return companyId;
}

export async function shiftsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  app.get(
    "/shifts",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_READ),
      schema: {
        tags: ["Shifts"],
        summary: "List the shifts in the active company, earliest start first",
        response: { 200: z.array(shiftSchema) },
      },
    },
    async (request) => shifts.listShifts(activeCompany(request.ctx!.companyId)),
  );

  app.get(
    "/shifts/:id",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_READ),
      schema: {
        tags: ["Shifts"],
        summary: "One shift",
        params: idParams,
        response: { 200: shiftSchema },
      },
    },
    async (request) => shifts.getShift(request.params.id, activeCompany(request.ctx!.companyId)),
  );

  app.post(
    "/shifts",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_MANAGE),
      schema: {
        tags: ["Shifts"],
        summary: "Create a shift",
        body: createShiftSchema,
        response: { 201: shiftSchema },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const shift = await shifts.createShift(companyId, request.body);
      await recordAudit(request, request.ctx!, { action: "shift.create", after: shift });
      reply.status(201);
      return shift;
    },
  );

  app.patch(
    "/shifts/:id",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_MANAGE),
      schema: {
        tags: ["Shifts"],
        summary: "Edit a shift (name, times, or active/disabled)",
        params: idParams,
        body: updateShiftSchema,
        response: { 200: shiftSchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const before = await shifts.getShift(request.params.id, companyId);
      const shift = await shifts.updateShift(request.params.id, companyId, request.body);
      await recordAudit(request, request.ctx!, { action: "shift.update", before, after: shift });
      await trackChanges(request, request.ctx!, "shifts", shift.id, before, shift);
      return shift;
    },
  );

  app.delete(
    "/shifts/:id",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_MANAGE),
      schema: {
        tags: ["Shifts"],
        summary: "Delete a shift",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const before = await shifts.getShift(request.params.id, companyId);
      await shifts.deleteShift(request.params.id, companyId);
      await recordAudit(request, request.ctx!, { action: "shift.delete", before });
      reply.status(204);
      return null;
    },
  );

  // --- per-department monthly schedules (the calendar) ---

  const scheduleIdParams = z.object({ id: z.guid() });
  const entryParams = z.object({ id: z.guid(), entryId: z.guid() });

  app.get(
    "/schedules",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_READ),
      schema: {
        tags: ["Shifts"],
        summary: "A department's schedule for a month — the calendar grid",
        description:
          "The whole month payload: the schedule (or null if not started), its days, the active " +
          "shifts, the department's members, every cell, and the coverage/gap flags. Readable by a " +
          "member of the department, or anyone with shifts:manage.",
        querystring: scheduleQuerySchema,
        response: { 200: scheduleGridSchema },
      },
    },
    async (request) =>
      schedule.getGrid(request.ctx!, activeCompany(request.ctx!.companyId), request.query),
  );

  // The same month, out of the app. Static path, before "/schedules/:id".
  //
  // `shifts:read` and no more: whoever may look at a rota may take a copy of it, and
  // a roster that can be read on screen but not printed is a roster people photograph
  // instead.
  app.get(
    "/schedules/export",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_READ),
      schema: {
        tags: ["Shifts"],
        summary: "The month roster as a spreadsheet or a printable A4 landscape page",
        querystring: scheduleQuerySchema.extend({
          format: z.enum(["xlsx", "html"]).default("xlsx"),
        }),
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const grid = await schedule.getGrid(request.ctx!, companyId, request.query);
      const stamp = {
        at: new Date(),
        by: await schedule.exporterName(request.ctx!.userId),
      };
      const base = `roster-${grid.year}-${String(grid.month).padStart(2, "0")}`;

      if (request.query.format === "html") {
        return reply
          .header("content-type", "text/html; charset=utf-8")
          .header("content-disposition", `attachment; filename="${base}.html"`)
          .header("cache-control", "no-store")
          .send(scheduleToHtml(grid, stamp));
      }
      return sendXlsx(reply, await scheduleToXlsx(grid, stamp), `${base}.xlsx`);
    },
  );

  // Static path, so it is declared before "/schedules/:id" can swallow it.
  app.get(
    "/schedules/my-entries",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_READ),
      schema: {
        tags: ["Shifts"],
        summary: "Your own cells in a department for a month, across every rota it has",
        description:
          "A department has a rota per site plus a central one, and somebody asking to change a " +
          "day knows the day rather than which rota it belongs to. Each cell says which rota it " +
          "is on, so the shift-change form can be built without asking.",
        querystring: myEntriesQuerySchema,
        response: { 200: z.array(myEntrySchema) },
      },
    },
    async (request) =>
      schedule.myEntries(request.ctx!, activeCompany(request.ctx!.companyId), request.query),
  );

  app.post(
    "/schedules",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_MANAGE),
      schema: {
        tags: ["Shifts"],
        summary: "Start a department's schedule for a month, optionally carried forward",
        body: createScheduleSchema,
        response: { 201: scheduleSchema },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const created = await schedule.createSchedule(request.ctx!, companyId, request.body);
      await recordAudit(request, request.ctx!, { action: "schedule.create", after: created });
      reply.status(201);
      return created;
    },
  );

  app.post(
    "/schedules/:id/assign",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_MANAGE),
      schema: {
        tags: ["Shifts"],
        summary: "Set or add a cell (a shift, or Off/Leave) for a person on a day",
        params: scheduleIdParams,
        body: assignEntrySchema,
        response: { 200: scheduleEntrySchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      return schedule.assignEntry(request.ctx!, companyId, request.params.id, request.body);
    },
  );

  app.post(
    "/schedules/:id/assign-bulk",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_MANAGE),
      schema: {
        tags: ["Shifts"],
        summary: "Set or clear many days for one person at once (the multi-select brush)",
        params: scheduleIdParams,
        body: bulkAssignSchema,
        response: { 200: z.object({ count: z.number().int() }) },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      return schedule.bulkAssign(request.ctx!, companyId, request.params.id, request.body);
    },
  );

  app.delete(
    "/schedules/:id/entries/:entryId",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_MANAGE),
      schema: {
        tags: ["Shifts"],
        summary: "Clear a cell",
        params: entryParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      await schedule.deleteEntry(
        request.ctx!.userId,
        companyId,
        request.params.id,
        request.params.entryId,
      );
      reply.status(204);
      return null;
    },
  );

  app.post(
    "/schedules/:id/publish",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_MANAGE),
      schema: {
        tags: ["Shifts"],
        summary: "Publish the schedule — freeze the scheduled baseline",
        params: scheduleIdParams,
        response: { 200: scheduleSchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const published = await schedule.publishSchedule(request.ctx!, companyId, request.params.id);
      await recordAudit(request, request.ctx!, { action: "schedule.publish", after: published });
      return published;
    },
  );

  app.post(
    "/schedules/:id/lock",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_MANAGE),
      schema: {
        tags: ["Shifts"],
        summary: "Lock the schedule — freeze it against direct edits (swaps still apply)",
        params: scheduleIdParams,
        response: { 200: scheduleSchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const locked = await schedule.setLock(request.ctx!, companyId, request.params.id, true);
      await recordAudit(request, request.ctx!, { action: "schedule.lock", after: locked });
      return locked;
    },
  );

  // Unlocking is reserved for the department's HOD (enforced in the service), so the
  // route floor is only shifts:read — an HOD who is an ordinary member can still do it.
  app.post(
    "/schedules/:id/unlock",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_READ),
      schema: {
        tags: ["Shifts"],
        summary: "Unlock the schedule (Head of Department only)",
        params: scheduleIdParams,
        response: { 200: scheduleSchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const unlocked = await schedule.setLock(request.ctx!, companyId, request.params.id, false);
      await recordAudit(request, request.ctx!, { action: "schedule.unlock", after: unlocked });
      return unlocked;
    },
  );

  // --- colleague swap requests ---

  // Raising a swap needs only shifts:read — you are offering your own shift, which is
  // like posting a comment: being able to see it is enough.
  app.post(
    "/schedules/:id/swaps",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_READ),
      schema: {
        tags: ["Shifts"],
        summary: "Request to swap your shift with a colleague's on the same day",
        params: scheduleIdParams,
        body: createSwapRequestSchema,
        response: { 201: swapRequestSchema },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const swap = await swaps.createSwap(request.ctx!, companyId, request.params.id, request.body);
      await recordAudit(request, request.ctx!, { action: "shift.swap.request", after: swap });
      reply.status(201);
      return swap;
    },
  );

  app.get(
    "/swaps",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_READ),
      schema: {
        tags: ["Shifts"],
        summary: "Swap requests: the inbox to decide, or the ones you raised",
        querystring: swapListQuerySchema,
        response: { 200: z.array(swapRequestSchema) },
      },
    },
    async (request) =>
      swaps.listSwaps(request.ctx!, activeCompany(request.ctx!.companyId), request.query),
  );

  // Deciding is gated by the reporting line inside the service, so shifts:read is the
  // floor; the service refuses anyone who is not the requester's manager or a scheduler.
  app.post(
    "/swaps/:id/decision",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_READ),
      schema: {
        tags: ["Shifts"],
        summary: "Approve or reject a swap (reporting manager or scheduler)",
        params: scheduleIdParams,
        body: swapDecisionSchema,
        response: { 200: swapRequestSchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const decided = await swaps.decideSwap(
        request.ctx!,
        companyId,
        request.params.id,
        request.body,
      );
      await recordAudit(request, request.ctx!, { action: "shift.swap.decision", after: decided });
      return decided;
    },
  );

  app.post(
    "/swaps/:id/cancel",
    {
      preHandler: guard(PERMISSIONS.SHIFTS_READ),
      schema: {
        tags: ["Shifts"],
        summary: "Withdraw your own pending shift-change request",
        params: scheduleIdParams,
        response: { 200: swapRequestSchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const cancelled = await swaps.cancelSwap(request.ctx!, companyId, request.params.id);
      await recordAudit(request, request.ctx!, { action: "shift.swap.cancel", after: cancelled });
      return cancelled;
    },
  );
}
