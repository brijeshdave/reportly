// Author: Brijesh Dave <https://github.com/brijeshdave>
// Roles. System roles are immutable but clonable: a role defines what a permission
// set means, so editing one would silently re-grant every group holding it. Custom
// roles are fully editable. Zod schemas double as OpenAPI docs.
import {
  PERMISSIONS,
  createRoleSchema,
  listQuerySchema,
  nameSchema,
  paginatedResult,
  roleSchema,
  updateRoleSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { trackChanges } from "@/core/history.js";
import { parseUpload, sendXlsx } from "@/core/spreadsheet/http.js";
import * as roles from "@/features/roles/service.js";
import { buildExport, buildTemplate, parseCsv, parseXlsx } from "@/features/roles/import-parse.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";

const idParams = z.object({ id: z.guid() });
const nameBody = z.object({ name: nameSchema });
/** A group that holds a role. Enough for the UI to name and link it. */
const referenceSchema = z.object({ id: z.guid(), name: z.string() });

export async function rolesRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];
  const read = guard(PERMISSIONS.ROLES_READ);

  app.get(
    "/roles",
    {
      preHandler: read,
      schema: {
        tags: ["Roles"],
        summary: "List roles with their permissions (standard pagination/sort/filter)",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(roleSchema) },
      },
    },
    async (request) => roles.listRoles(await resolveListQuery(request.query, request.authUserId)),
  );

  // --- bulk export / import (static paths, before /:id) ---

  app.get(
    "/roles/export",
    {
      preHandler: read,
      schema: {
        tags: ["Roles"],
        summary: "Export roles and the permissions they grant as an .xlsx",
      },
    },
    async (_request, reply) =>
      sendXlsx(reply, await buildExport(await roles.exportRoles()), "roles.xlsx"),
  );

  app.get(
    "/roles/import/template",
    {
      preHandler: guard(PERMISSIONS.ROLES_IMPORT),
      schema: { tags: ["Roles"], summary: "Download the role import template (.xlsx)" },
    },
    async (_request, reply) => sendXlsx(reply, await buildTemplate(), "role-import-template.xlsx"),
  );

  app.post(
    "/roles/import",
    {
      preHandler: guard(PERMISSIONS.ROLES_IMPORT),
      schema: {
        tags: ["Roles"],
        summary:
          "Create or update roles (and their permissions) in bulk from an .xlsx or .csv upload",
        description:
          "Roles are matched by name; the Permissions cell (permission keys separated by | ; , or spaces) " +
          "replaces a role's permission set, and a blank cell leaves it unchanged. System roles are immutable. " +
          "All or nothing: if any row is wrong nothing is written, and every problem is returned with its line.",
        response: {
          200: z.object({
            created: z.number().int(),
            updated: z.number().int(),
            problems: z.array(z.object({ line: z.number().int(), message: z.string() })),
          }),
        },
      },
    },
    async (request) => {
      const parsed = await parseUpload(request, parseCsv, parseXlsx);
      const outcome = await roles.importRoles(parsed);
      if (outcome.created > 0 || outcome.updated > 0) {
        await recordAudit(request, request.ctx!, {
          action: "role.import",
          after: { created: outcome.created, updated: outcome.updated },
        });
      }
      return outcome;
    },
  );

  app.get(
    "/roles/:id",
    {
      preHandler: read,
      schema: {
        tags: ["Roles"],
        summary: "Get a role with its permissions",
        params: idParams,
        response: { 200: roleSchema },
      },
    },
    async (request) => roles.getRole(request.params.id),
  );

  app.get(
    "/roles/:id/references",
    {
      preHandler: read,
      schema: {
        tags: ["Roles"],
        summary: "Groups holding this role (who a change or deletion would affect)",
        params: idParams,
        response: { 200: z.object({ groups: z.array(referenceSchema) }) },
      },
    },
    async (request) => ({ groups: await roles.roleReferences(request.params.id) }),
  );

  app.post(
    "/roles",
    {
      preHandler: guard(PERMISSIONS.ROLES_CREATE),
      schema: {
        tags: ["Roles"],
        summary: "Create a custom role",
        body: createRoleSchema,
        response: { 201: roleSchema },
      },
    },
    async (request, reply) => {
      const role = await roles.createRole(request.body.name, request.body.permissions);
      await recordAudit(request, request.ctx!, { action: "role.create", after: role });
      reply.status(201);
      return role;
    },
  );

  app.patch(
    "/roles/:id",
    {
      preHandler: guard(PERMISSIONS.ROLES_UPDATE),
      schema: {
        tags: ["Roles"],
        summary: "Rename a custom role or change its permissions (system roles are immutable)",
        params: idParams,
        body: updateRoleSchema,
        response: { 200: roleSchema },
      },
    },
    async (request) => {
      const before = await roles.getRole(request.params.id);
      const role = await roles.updateRole(request.params.id, request.body);
      await recordAudit(request, request.ctx!, { action: "role.update", before, after: role });
      await trackChanges(request, request.ctx!, "roles", role.id, before, role);
      return role;
    },
  );

  app.post(
    "/roles/:id/clone",
    {
      preHandler: guard(PERMISSIONS.ROLES_CLONE),
      schema: {
        tags: ["Roles"],
        summary: "Copy a role's permissions into a new, editable role",
        params: idParams,
        body: nameBody,
        response: { 201: roleSchema },
      },
    },
    async (request, reply) => {
      const role = await roles.cloneRole(request.params.id, request.body.name);
      await recordAudit(request, request.ctx!, {
        action: "role.clone",
        details: { sourceId: request.params.id },
        after: role,
      });
      reply.status(201);
      return role;
    },
  );

  app.delete(
    "/roles/:id",
    {
      preHandler: guard(PERMISSIONS.ROLES_DELETE),
      schema: {
        tags: ["Roles"],
        summary: "Delete a custom role. Refused with 409 while any group holds it.",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const before = await roles.getRole(request.params.id);
      await roles.deleteRole(request.params.id);
      await recordAudit(request, request.ctx!, { action: "role.delete", before });
      reply.status(204);
      return null;
    },
  );
}
