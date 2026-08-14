// Author: Brijesh Dave <https://github.com/brijeshdave>
// Groups CRUD, assignments, and clone. Permission-gated (superadmin bypasses via
// can()) and audited. GET /groups uses the standard list query. Zod schemas
// provide validation + OpenAPI docs.
import {
  PERMISSIONS,
  groupSchema,
  listQuerySchema,
  nameSchema,
  paginatedResult,
} from "@reportly/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { trackChanges } from "@/core/history.js";
import { parseUpload, sendXlsx } from "@/core/spreadsheet/http.js";
import * as groups from "@/features/groups/service.js";
import { buildExport, buildTemplate, parseCsv, parseXlsx } from "@/features/groups/import-parse.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";

const idParams = z.object({ id: z.guid() });
const nameBody = z.object({ name: nameSchema });
const idsBody = z.object({ ids: z.array(z.guid()) });
const assignedResponse = z.object({ assigned: z.array(z.guid()) });
const assignmentsResponse = z.object({
  // `users` are auth-owned text ids, not uuids.
  users: z.array(z.string()),
  roles: z.array(z.guid()),
});

export async function groupsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  const audit = (request: FastifyRequest, action: string, details: unknown) =>
    recordAudit(request, request.ctx!, { action, details });

  app.get(
    "/groups",
    {
      preHandler: guard(PERMISSIONS.GROUPS_READ),
      schema: {
        tags: ["Groups"],
        summary: "List groups (standard pagination/sort/filter)",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(groupSchema) },
      },
    },
    async (request) => groups.listGroups(await resolveListQuery(request.query, request.authUserId)),
  );

  // --- bulk export / import (static paths, before /:id) ---

  app.get(
    "/groups/export",
    {
      preHandler: guard(PERMISSIONS.GROUPS_READ),
      schema: { tags: ["Groups"], summary: "Export groups and the roles they carry as an .xlsx" },
    },
    async (_request, reply) =>
      sendXlsx(reply, await buildExport(await groups.exportGroups()), "groups.xlsx"),
  );

  app.get(
    "/groups/import/template",
    {
      preHandler: guard(PERMISSIONS.GROUPS_IMPORT),
      schema: { tags: ["Groups"], summary: "Download the group import template (.xlsx)" },
    },
    async (_request, reply) => sendXlsx(reply, await buildTemplate(), "group-import-template.xlsx"),
  );

  app.post(
    "/groups/import",
    {
      preHandler: guard(PERMISSIONS.GROUPS_IMPORT),
      schema: {
        tags: ["Groups"],
        summary: "Create or update groups (and their roles) in bulk from an .xlsx or .csv upload",
        description:
          "Groups are matched by name; the Roles cell (role names separated by | or ;) replaces a group's " +
          "role set, and a blank Roles cell leaves it unchanged. System groups are immutable. All or nothing: " +
          "if any row is wrong nothing is written, and every problem is returned with its line number.",
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
      const outcome = await groups.importGroups(parsed);
      if (outcome.created > 0 || outcome.updated > 0) {
        await audit(request, "group.import", {
          created: outcome.created,
          updated: outcome.updated,
        });
      }
      return outcome;
    },
  );

  app.post(
    "/groups",
    {
      preHandler: guard(PERMISSIONS.GROUPS_CREATE),
      schema: {
        tags: ["Groups"],
        summary: "Create a group",
        body: nameBody,
        response: { 201: groupSchema },
      },
    },
    async (request, reply) => {
      const group = await groups.createGroup(request.body.name);
      await audit(request, "group.create", { groupId: group.id });
      reply.status(201);
      return group;
    },
  );

  app.get(
    "/groups/:id",
    {
      preHandler: guard(PERMISSIONS.GROUPS_READ),
      schema: {
        tags: ["Groups"],
        summary: "Get a group",
        params: idParams,
        response: { 200: groupSchema },
      },
    },
    async (request) => groups.getGroup(request.params.id),
  );

  app.patch(
    "/groups/:id",
    {
      preHandler: guard(PERMISSIONS.GROUPS_UPDATE),
      schema: {
        tags: ["Groups"],
        summary: "Rename a group (system groups are immutable)",
        params: idParams,
        body: nameBody,
        response: { 200: groupSchema },
      },
    },
    async (request) => {
      const before = await groups.getGroup(request.params.id);
      const group = await groups.updateGroup(request.params.id, request.body.name);
      await audit(request, "group.update", { groupId: group.id });
      await trackChanges(request, request.ctx!, "groups", group.id, before, group);
      return group;
    },
  );

  app.delete(
    "/groups/:id",
    {
      preHandler: guard(PERMISSIONS.GROUPS_DELETE),
      schema: {
        tags: ["Groups"],
        summary: "Delete a group (system groups are immutable)",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await groups.deleteGroup(request.params.id);
      await audit(request, "group.delete", { groupId: request.params.id });
      reply.status(204);
      return null;
    },
  );

  // The assignment endpoints replace the whole set, so an editor must be able to
  // read the current one first — otherwise saving one tab wipes the others.
  app.get(
    "/groups/:id/assignments",
    {
      preHandler: guard(PERMISSIONS.GROUPS_READ),
      schema: {
        tags: ["Groups"],
        summary: "Get the ids assigned to a group (users, roles)",
        params: idParams,
        response: { 200: assignmentsResponse },
      },
    },
    async (request) => groups.getAssignments(request.params.id),
  );

  // A group holds no data of its own, so deleting it is allowed. It does revoke
  // its members' access, and the confirmation should say how many.
  app.get(
    "/groups/:id/impact",
    {
      preHandler: guard(PERMISSIONS.GROUPS_READ),
      schema: {
        tags: ["Groups"],
        summary: "What deleting this group would revoke (counts only; nothing is destroyed)",
        params: idParams,
        response: {
          200: z.object({
            members: z.number().int(),
            roles: z.number().int(),
          }),
        },
      },
    },
    async (request) => groups.groupImpact(request.params.id),
  );

  app.post(
    "/groups/:id/clone",
    {
      preHandler: guard(PERMISSIONS.GROUPS_CREATE),
      schema: {
        tags: ["Groups"],
        summary: "Clone a group's roles/companies/locations into a new group",
        params: idParams,
        body: nameBody,
        response: { 201: groupSchema },
      },
    },
    async (request, reply) => {
      const group = await groups.cloneGroup(request.params.id, request.body.name);
      await audit(request, "group.clone", { sourceId: request.params.id, groupId: group.id });
      reply.status(201);
      return group;
    },
  );

  // --- assignments (replace the full set) ---
  const assignmentRoute = (
    kind: "users" | "roles" | "companies" | "locations",
    apply: (id: string, ids: string[]) => Promise<void>,
  ) =>
    app.put(
      `/groups/:id/${kind}`,
      {
        preHandler: guard(PERMISSIONS.GROUPS_ASSIGN),
        schema: {
          tags: ["Groups"],
          summary: `Set the ${kind} assigned to a group`,
          params: idParams,
          body: idsBody,
          response: { 200: assignedResponse },
        },
      },
      async (request) => {
        await apply(request.params.id, request.body.ids);
        await audit(request, `group.assign.${kind}`, {
          groupId: request.params.id,
          ids: request.body.ids,
        });
        return { assigned: request.body.ids };
      },
    );

  assignmentRoute("users", groups.assignUsers);
  assignmentRoute("roles", groups.assignRoles);
}
