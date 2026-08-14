// Author: Brijesh Dave <https://github.com/brijeshdave>
// Device types and tags — a department's own vocabulary.
//
// Reading needs only the permission you would already hold to do the work (see a
// device, read a report). Managing is a **separate, granular permission per
// catalogue** — `device-types:manage`, `tags:manage` — rather than the blanket
// `report-config:manage`, so an admin can hand one department's vocabulary to the
// group that actually owns it without also handing over the severity ladder. The
// seed grants both to Manager by default; that is a default, not a rule.
import {
  ERROR_CODES,
  PERMISSIONS,
  createDeviceTypeSchema,
  createTagSchema,
  deviceTypeRowSchema,
  tagRowSchema,
  updateDeviceTypeSchema,
  updateTagSchema,
} from "@reportly/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { AppError } from "@/core/errors.js";
import * as vocabulary from "@/features/vocabulary/service.js";

const idParams = z.object({ id: z.guid() });
const byDepartment = z.object({ departmentId: z.guid().optional() });

/** The company the caller is working in. Vocabulary hangs off departments, which
 *  belong to a company, so every read and write here is scoped by it. */
function activeCompany(companyId: string | null): string {
  if (!companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  return companyId;
}

export async function vocabularyRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  const audit = (request: FastifyRequest, action: string, details: unknown) =>
    recordAudit(request, request.ctx!, { action, details });

  /* ----------------------------- Device types ----------------------------- */

  app.get(
    "/device-types",
    {
      // Read is gated on devices:read — if you may see the register, you may see
      // what its entries are called.
      preHandler: guard(PERMISSIONS.DEVICES_READ),
      schema: {
        tags: ["Vocabulary"],
        summary: "Device types; filter to one department with ?departmentId=",
        querystring: byDepartment,
        response: { 200: z.array(deviceTypeRowSchema) },
      },
    },
    async (request) =>
      vocabulary.listTypes(activeCompany(request.ctx!.companyId), request.query.departmentId),
  );

  app.post(
    "/device-types",
    {
      preHandler: guard(PERMISSIONS.DEVICE_TYPES_MANAGE),
      schema: {
        tags: ["Vocabulary"],
        summary: "Create a device type in a department",
        body: createDeviceTypeSchema,
        response: { 201: deviceTypeRowSchema },
      },
    },
    async (request, reply) => {
      const type = await vocabulary.createType(request.body, activeCompany(request.ctx!.companyId));
      await audit(request, "device-type.create", { deviceTypeId: type.id, name: type.name });
      reply.status(201);
      return type;
    },
  );

  app.patch(
    "/device-types/:id",
    {
      preHandler: guard(PERMISSIONS.DEVICE_TYPES_MANAGE),
      schema: {
        tags: ["Vocabulary"],
        summary: "Rename, describe, or retire a device type",
        params: idParams,
        body: updateDeviceTypeSchema,
        response: { 200: deviceTypeRowSchema },
      },
    },
    async (request) => {
      const before = await vocabulary.getType(request.params.id, request.ctx!.companyId);
      const after = await vocabulary.updateType(
        request.params.id,
        request.body,
        request.ctx!.companyId,
      );
      await audit(request, "device-type.update", { before, after });
      return after;
    },
  );

  app.delete(
    "/device-types/:id",
    {
      preHandler: guard(PERMISSIONS.DEVICE_TYPES_MANAGE),
      schema: {
        tags: ["Vocabulary"],
        summary: "Delete an unused device type (one in use must be retired instead)",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await vocabulary.deleteType(request.params.id, request.ctx!.companyId);
      await audit(request, "device-type.delete", { deviceTypeId: request.params.id });
      reply.status(204);
      return null;
    },
  );

  /* --------------------------------- Tags --------------------------------- */

  app.get(
    "/tags",
    {
      // Anyone who may read a report may see the labels it can carry — otherwise
      // the tag picker on the report form would be empty for the people filing.
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Vocabulary"],
        summary: "Tags; filter to one department with ?departmentId=",
        querystring: byDepartment,
        response: { 200: z.array(tagRowSchema) },
      },
    },
    async (request) =>
      vocabulary.listAllTags(activeCompany(request.ctx!.companyId), request.query.departmentId),
  );

  app.post(
    "/tags",
    {
      preHandler: guard(PERMISSIONS.TAGS_MANAGE),
      schema: {
        tags: ["Vocabulary"],
        summary: "Create a tag in a department",
        body: createTagSchema,
        response: { 201: tagRowSchema },
      },
    },
    async (request, reply) => {
      const tag = await vocabulary.createTag(request.body, activeCompany(request.ctx!.companyId));
      await audit(request, "tag.create", { tagId: tag.id, name: tag.name });
      reply.status(201);
      return tag;
    },
  );

  app.patch(
    "/tags/:id",
    {
      preHandler: guard(PERMISSIONS.TAGS_MANAGE),
      schema: {
        tags: ["Vocabulary"],
        summary: "Rename, describe, or retire a tag",
        params: idParams,
        body: updateTagSchema,
        response: { 200: tagRowSchema },
      },
    },
    async (request) => {
      const before = await vocabulary.getOneTag(request.params.id, request.ctx!.companyId);
      const after = await vocabulary.updateTag(
        request.params.id,
        request.body,
        request.ctx!.companyId,
      );
      await audit(request, "tag.update", { before, after });
      return after;
    },
  );

  app.delete(
    "/tags/:id",
    {
      preHandler: guard(PERMISSIONS.TAGS_MANAGE),
      schema: {
        tags: ["Vocabulary"],
        summary: "Delete an unused tag (one in use must be retired instead)",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await vocabulary.deleteTag(request.params.id, request.ctx!.companyId);
      await audit(request, "tag.delete", { tagId: request.params.id });
      reply.status(204);
      return null;
    },
  );
}
