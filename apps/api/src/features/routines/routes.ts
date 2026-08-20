// Author: Brijesh Dave <https://github.com/brijeshdave>
// Routine definition routes, scoped to the active company. `routines:read` lists (the
// ones you manage or are assigned); `routines:manage` creates/edits/deletes. The
// occurrence + completion routes are added with that flow.
import {
  ERROR_CODES,
  PERMISSIONS,
  createRoutineSchema,
  finishOccurrenceSchema,
  listQuerySchema,
  paginatedResult,
  occurrenceQuerySchema,
  routineCompletionSchema,
  routineOccurrenceSchema,
  routineSchema,
  updateRoutineSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { AppError } from "@/core/errors.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";
import * as routines from "@/features/routines/service.js";

const idParams = z.object({ id: z.guid() });

function activeCompany(companyId: string | null): string {
  if (!companyId)
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "X-Company-Id header is required");
  return companyId;
}

export async function routinesRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  app.get(
    "/routines",
    {
      preHandler: guard(PERMISSIONS.ROUTINES_READ),
      schema: {
        tags: ["Routines"],
        summary: "The routines assigned to you — the ones you complete",
        response: { 200: z.array(routineSchema) },
      },
    },
    // Unpaged on purpose: My Routines groups every duty by cadence, and a page of
    // twenty would hide half of somebody's week. The ones you *manage* are a table
    // instead — see /routines/managed.
    async (request) =>
      routines.listAssigned(activeCompany(request.ctx!.companyId), request.ctx!.userId),
  );

  // The team view. A table like every other list: filtered, sorted and paged by
  // the server, rather than one unpaged array the browser then sifts through.
  app.get(
    "/routines/managed",
    {
      preHandler: guard(PERMISSIONS.ROUTINES_READ),
      schema: {
        tags: ["Routines"],
        summary:
          "Search the routines you manage (filter by title, department, cadence, assignee, site)",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(routineSchema) },
      },
    },
    async (request) =>
      routines.listManagedPage(
        await resolveListQuery(request.query, request.authUserId),
        activeCompany(request.ctx!.companyId),
        request.ctx!.userId,
        request.ctx!.isSuperadmin,
      ),
  );

  // My occurrences across every routine assigned to me, over a window.
  app.get(
    "/routines/occurrences",
    {
      preHandler: guard(PERMISSIONS.ROUTINES_READ),
      schema: {
        tags: ["Routines"],
        summary: "Your routine occurrences over a window (done / missed / pending)",
        querystring: occurrenceQuerySchema,
        response: { 200: z.array(routineOccurrenceSchema) },
      },
    },
    async (request) =>
      routines.myOccurrences(
        activeCompany(request.ctx!.companyId),
        request.ctx!.userId,
        request.query.from,
        request.query.to,
      ),
  );

  app.get(
    "/routines/:id",
    {
      preHandler: guard(PERMISSIONS.ROUTINES_READ),
      schema: {
        tags: ["Routines"],
        summary: "One routine",
        params: idParams,
        response: { 200: routineSchema },
      },
    },
    async (request) =>
      routines.getRoutine(request.params.id, activeCompany(request.ctx!.companyId)),
  );

  // One routine's occurrences with every assignee's completion — the compliance grid.
  app.get(
    "/routines/:id/occurrences",
    {
      preHandler: guard(PERMISSIONS.ROUTINES_READ),
      schema: {
        tags: ["Routines"],
        summary: "A routine's occurrences with each assignee's completion",
        params: idParams,
        querystring: occurrenceQuerySchema,
        response: { 200: z.array(routineOccurrenceSchema) },
      },
    },
    async (request) =>
      routines.routineOccurrences(
        request.ctx!,
        activeCompany(request.ctx!.companyId),
        request.params.id,
        request.query.from,
        request.query.to,
      ),
  );

  const occurrenceParams = z.object({
    id: z.guid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });

  app.post(
    "/routines/:id/occurrences/:date/finish",
    {
      preHandler: guard(PERMISSIONS.ROUTINES_LOG),
      schema: {
        tags: ["Routines"],
        summary: "Finish your occurrence (records the finish time and notes)",
        params: occurrenceParams,
        body: finishOccurrenceSchema,
        response: { 200: routineCompletionSchema },
      },
    },
    async (request) =>
      routines.finishOccurrence(
        request.ctx!,
        activeCompany(request.ctx!.companyId),
        request.params.id,
        request.params.date,
        request.body.startedAt ?? null,
        request.body.finishedAt,
        request.body.notes ?? null,
      ),
  );

  // Award a month's routine points into the leaderboard ledger. Idempotent.
  app.post(
    "/routines/award",
    {
      preHandler: guard(PERMISSIONS.ROUTINES_MANAGE),
      schema: {
        tags: ["Routines"],
        summary: "Award a month's routine points (on-time full, late half) — idempotent",
        querystring: z.object({
          year: z.coerce.number().int().min(2000).max(2100),
          month: z.coerce.number().int().min(1).max(12),
        }),
        response: { 200: z.object({ count: z.number().int(), points: z.number() }) },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const result = await routines.awardMonth(
        request.ctx!,
        companyId,
        request.query.year,
        request.query.month,
      );
      await recordAudit(request, request.ctx!, {
        action: "routine.award",
        details: { year: request.query.year, month: request.query.month, ...result },
      });
      return result;
    },
  );

  app.post(
    "/routines",
    {
      preHandler: guard(PERMISSIONS.ROUTINES_MANAGE),
      schema: {
        tags: ["Routines"],
        summary: "Create a routine for your team",
        body: createRoutineSchema,
        response: { 201: routineSchema },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const routine = await routines.createRoutine(
        companyId,
        request.ctx!.userId,
        request.ctx!.isSuperadmin,
        request.body,
      );
      await recordAudit(request, request.ctx!, { action: "routine.create", after: routine });
      reply.status(201);
      return routine;
    },
  );

  app.patch(
    "/routines/:id",
    {
      preHandler: guard(PERMISSIONS.ROUTINES_MANAGE),
      schema: {
        tags: ["Routines"],
        summary: "Edit a routine (its cadence, points, assignees, or pause it)",
        params: idParams,
        body: updateRoutineSchema,
        response: { 200: routineSchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const before = await routines.getRoutine(request.params.id, companyId);
      const routine = await routines.updateRoutine(
        request.params.id,
        companyId,
        request.ctx!.userId,
        request.ctx!.isSuperadmin,
        request.body,
      );
      await recordAudit(request, request.ctx!, {
        action: "routine.update",
        before,
        after: routine,
      });
      return routine;
    },
  );

  app.delete(
    "/routines/:id",
    {
      preHandler: guard(PERMISSIONS.ROUTINES_MANAGE),
      schema: {
        tags: ["Routines"],
        summary: "Delete a routine",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const before = await routines.getRoutine(request.params.id, companyId);
      await routines.deleteRoutine(
        request.params.id,
        companyId,
        request.ctx!.userId,
        request.ctx!.isSuperadmin,
      );
      await recordAudit(request, request.ctx!, { action: "routine.delete", before });
      reply.status(204);
      return null;
    },
  );
}
