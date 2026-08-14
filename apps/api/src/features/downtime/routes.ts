// Author: Brijesh Dave <https://github.com/brijeshdave>
// Downtime raised from a report: open one, close it, list what is still pending, and
// the per-thing totals. Reading is gated on downtime:read, writing on downtime:write
// — and the service further limits writing to the report's author and their line, so
// the permission alone never lets someone edit a stranger's outage.
import {
  ERROR_CODES,
  PERMISSIONS,
  createDowntimeSchema,
  downtimeEntrySchema,
  downtimeTotalSchema,
  updateDowntimeSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { AppError } from "@/core/errors.js";
import * as downtime from "@/features/downtime/service.js";

const idParams = z.object({ id: z.guid() });

function activeCompany(companyId: string | null): string {
  if (!companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  return companyId;
}

export async function downtimeRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  // Registered before /downtime/:id so these are not read as ids.
  app.get(
    "/downtime/pending",
    {
      preHandler: guard(PERMISSIONS.DOWNTIME_READ),
      schema: {
        tags: ["Downtime"],
        summary: "Outages still running (no end time) — the pending queue, oldest first",
        response: { 200: z.array(downtimeEntrySchema) },
      },
    },
    async (request) => downtime.listOpen(activeCompany(request.ctx!.companyId), request.ctx!),
  );

  app.get(
    "/downtime/totals",
    {
      preHandler: guard(PERMISSIONS.DOWNTIME_READ),
      schema: {
        tags: ["Downtime"],
        summary: "Total minutes down per thing, worst first. Open outages count up to now.",
        response: { 200: z.array(downtimeTotalSchema) },
      },
    },
    async (request) => downtime.listTotals(activeCompany(request.ctx!.companyId), request.ctx!),
  );

  app.get(
    "/journal/:id/downtime",
    {
      preHandler: guard(PERMISSIONS.DOWNTIME_READ),
      schema: {
        tags: ["Downtime"],
        summary: "The downtime raised from one report",
        params: idParams,
        response: { 200: z.array(downtimeEntrySchema) },
      },
    },
    async (request) =>
      downtime.listForReport(
        request.params.id,
        activeCompany(request.ctx!.companyId),
        request.ctx!,
      ),
  );

  app.post(
    "/downtime",
    {
      preHandler: guard(PERMISSIONS.DOWNTIME_WRITE),
      schema: {
        tags: ["Downtime"],
        summary:
          "Record downtime against something a report is about. Omit the end time to leave it open.",
        body: createDowntimeSchema,
        response: { 201: downtimeEntrySchema },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const entry = await downtime.createDowntime(companyId, request.ctx!, request.body);
      await recordAudit(request, request.ctx!, { action: "downtime.create", after: entry });
      reply.status(201);
      return entry;
    },
  );

  app.patch(
    "/downtime/:id",
    {
      preHandler: guard(PERMISSIONS.DOWNTIME_WRITE),
      schema: {
        tags: ["Downtime"],
        summary: "Edit a downtime entry — fill in the end time to close it, or amend the reason",
        params: idParams,
        body: updateDowntimeSchema,
        response: { 200: downtimeEntrySchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const after = await downtime.updateDowntime(
        request.params.id,
        companyId,
        request.ctx!,
        request.body,
      );
      await recordAudit(request, request.ctx!, { action: "downtime.update", after });
      return after;
    },
  );

  app.delete(
    "/downtime/:id",
    {
      preHandler: guard(PERMISSIONS.DOWNTIME_WRITE),
      schema: {
        tags: ["Downtime"],
        summary: "Delete a downtime entry",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      await downtime.deleteDowntime(request.params.id, companyId, request.ctx!);
      await recordAudit(request, request.ctx!, {
        action: "downtime.delete",
        details: { downtimeId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );
}
