// Author: Brijesh Dave <https://github.com/brijeshdave>
// Designations CRUD. Permission-gated and audited; Zod schemas validate + document.
import {
  PERMISSIONS,
  createDesignationSchema,
  designationRowSchema,
  listQuerySchema,
  paginatedResult,
  updateDesignationSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { trackChanges } from "@/core/history.js";
import * as designations from "@/features/designations/service.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";

const idParams = z.object({ id: z.guid() });
const optionSchema = z.object({ id: z.guid(), name: z.string() });

export async function designationsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  // The choices a user's profile offers. Active only — a retired title is kept by
  // the people who hold it, but never handed to anybody new. Registered before
  // /designations/:id so "options" is not read as an id.
  app.get(
    "/designations/options",
    {
      preHandler: guard(PERMISSIONS.DESIGNATIONS_READ),
      schema: {
        tags: ["Designations"],
        summary: "Active designations, for the picker on a user's profile",
        response: { 200: z.array(optionSchema) },
      },
    },
    async () => designations.options(),
  );

  app.get(
    "/designations",
    {
      preHandler: guard(PERMISSIONS.DESIGNATIONS_READ),
      schema: {
        tags: ["Designations"],
        summary: "List designations with how many people hold each",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(designationRowSchema) },
      },
    },
    async (request) =>
      designations.listDesignations(await resolveListQuery(request.query, request.authUserId)),
  );

  app.post(
    "/designations",
    {
      preHandler: guard(PERMISSIONS.DESIGNATIONS_CREATE),
      schema: {
        tags: ["Designations"],
        summary: "Create a designation",
        body: createDesignationSchema,
        response: { 201: designationRowSchema },
      },
    },
    async (request, reply) => {
      const designation = await designations.createDesignation(
        request.body.name,
        request.body.status,
      );
      await recordAudit(request, request.ctx!, {
        action: "designation.create",
        after: designation,
      });
      reply.status(201);
      return designation;
    },
  );

  app.get(
    "/designations/:id",
    {
      preHandler: guard(PERMISSIONS.DESIGNATIONS_READ),
      schema: {
        tags: ["Designations"],
        summary: "Get a designation",
        params: idParams,
        response: { 200: designationRowSchema },
      },
    },
    async (request) => designations.getDesignation(request.params.id),
  );

  app.patch(
    "/designations/:id",
    {
      preHandler: guard(PERMISSIONS.DESIGNATIONS_UPDATE),
      schema: {
        tags: ["Designations"],
        summary: "Rename a designation, or retire it. A rename corrects every holder.",
        params: idParams,
        body: updateDesignationSchema,
        response: { 200: designationRowSchema },
      },
    },
    async (request) => {
      const before = await designations.getDesignation(request.params.id);
      const after = await designations.updateDesignation(request.params.id, request.body);
      await recordAudit(request, request.ctx!, { action: "designation.update", before, after });
      await trackChanges(request, request.ctx!, "designations", after.id, before, after);
      return after;
    },
  );

  app.delete(
    "/designations/:id",
    {
      preHandler: guard(PERMISSIONS.DESIGNATIONS_DELETE),
      schema: {
        tags: ["Designations"],
        summary:
          "Delete a designation. Refused with 409 while anybody holds it — deactivate instead.",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await designations.deleteDesignation(request.params.id);
      await recordAudit(request, request.ctx!, {
        action: "designation.delete",
        details: { designationId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );
}
