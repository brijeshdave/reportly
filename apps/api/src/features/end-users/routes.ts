// Author: Brijesh Dave <https://github.com/brijeshdave>
// End users — the supported people who have no Reportly account.
//
// `:read` is deliberately wide: naming the person a fault happened to is part of
// filing an entry, so anybody who files needs the list. Everything that changes the
// list is held separately, the way the other master data is cut.
import {
  ERROR_CODES,
  PERMISSIONS,
  createEndUserSchema,
  endUserSchema,
  listQuerySchema,
  paginatedResult,
  updateEndUserSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { AppError } from "@/core/errors.js";
import { parseUpload, sendXlsx } from "@/core/spreadsheet/http.js";
import * as endUsers from "@/features/end-users/service.js";
import { buildTemplate, parseCsv, parseXlsx } from "@/features/end-users/import-parse.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";

const idParams = z.object({ id: z.guid() });

function activeCompany(companyId: string | null): string {
  if (!companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  return companyId;
}

export async function endUsersRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  app.get(
    "/end-users",
    {
      preHandler: guard(PERMISSIONS.END_USERS_READ),
      schema: {
        tags: ["End users"],
        summary: "The people this company supports",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(endUserSchema) },
      },
    },
    async (request) =>
      endUsers.listEndUsers(
        await resolveListQuery(request.query, request.authUserId),
        activeCompany(request.ctx!.companyId),
      ),
  );

  // Registered before /end-users/:id so the word is not read as an id.
  app.get(
    "/end-users/pickable",
    {
      preHandler: guard(PERMISSIONS.END_USERS_READ),
      schema: {
        tags: ["End users"],
        summary: "Active end users for the journal's picker, narrowed to departments",
        description:
          "Pass `departmentIds` as a comma-separated list to narrow the list to those departments. " +
          "With none given the whole active list is returned, because an entry about a contractor " +
          "has no department to narrow by.",
        querystring: z.object({ departmentIds: z.string().optional() }),
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              fullName: z.string(),
              employeeNumber: z.string(),
              departmentName: z.string().nullable(),
            }),
          ),
        },
      },
    },
    async (request) => {
      const ids = (request.query.departmentIds ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      return endUsers.pickableEndUsers(activeCompany(request.ctx!.companyId), ids);
    },
  );

  app.get(
    "/end-users/export",
    {
      preHandler: guard(PERMISSIONS.END_USERS_READ),
      schema: { tags: ["End users"], summary: "Download the end-user list (.xlsx)" },
    },
    async (request, reply) =>
      sendXlsx(
        reply,
        await endUsers.exportEndUsers(activeCompany(request.ctx!.companyId)),
        "end-users.xlsx",
      ),
  );

  app.get(
    "/end-users/import/template",
    {
      preHandler: guard(PERMISSIONS.END_USERS_IMPORT),
      schema: { tags: ["End users"], summary: "Download the end-user import template (.xlsx)" },
    },
    async (_request, reply) =>
      sendXlsx(reply, await buildTemplate(), "end-user-import-template.xlsx"),
  );

  app.post(
    "/end-users/import",
    {
      preHandler: guard(PERMISSIONS.END_USERS_IMPORT),
      schema: {
        tags: ["End users"],
        summary: "Create or correct end users in bulk from an .xlsx or .csv upload",
        description:
          "People are matched on their employee number: a number already in the company is corrected, " +
          "a new one is added. All or nothing — if any row is wrong nothing is written, and every " +
          "problem comes back with its line number. A department name that does not exist is a problem, " +
          "not a new department.",
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
      const companyId = activeCompany(request.ctx!.companyId);
      const parsed = await parseUpload(request, parseCsv, parseXlsx);
      const outcome = await endUsers.importEndUsers(companyId, parsed);
      if (outcome.created + outcome.updated > 0) {
        await recordAudit(request, request.ctx!, {
          action: "end-user.import",
          after: { created: outcome.created, updated: outcome.updated },
        });
      }
      return outcome;
    },
  );

  app.get(
    "/end-users/:id",
    {
      preHandler: guard(PERMISSIONS.END_USERS_READ),
      schema: {
        tags: ["End users"],
        summary: "One end user",
        params: idParams,
        response: { 200: endUserSchema },
      },
    },
    async (request) =>
      endUsers.getEndUser(request.params.id, activeCompany(request.ctx!.companyId)),
  );

  app.post(
    "/end-users",
    {
      preHandler: guard(PERMISSIONS.END_USERS_CREATE),
      schema: {
        tags: ["End users"],
        summary: "Add somebody the team supports",
        body: createEndUserSchema,
        response: { 201: endUserSchema },
      },
    },
    async (request, reply) => {
      const created = await endUsers.createEndUser(
        activeCompany(request.ctx!.companyId),
        request.body,
      );
      await recordAudit(request, request.ctx!, { action: "end-user.create", after: created });
      reply.status(201);
      return created;
    },
  );

  app.patch(
    "/end-users/:id",
    {
      preHandler: guard(PERMISSIONS.END_USERS_UPDATE),
      schema: {
        tags: ["End users"],
        summary: "Correct an end user, or make them inactive",
        params: idParams,
        body: updateEndUserSchema,
        response: { 200: endUserSchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const before = await endUsers.getEndUser(request.params.id, companyId);
      const after = await endUsers.updateEndUser(request.params.id, companyId, request.body);
      await recordAudit(request, request.ctx!, { action: "end-user.update", before, after });
      return after;
    },
  );

  app.delete(
    "/end-users/:id",
    {
      preHandler: guard(PERMISSIONS.END_USERS_DELETE),
      schema: {
        tags: ["End users"],
        summary: "Remove an end user who is named on nothing",
        description:
          "Refused once they are named on an entry: the reports are built from those names, and a " +
          "deletion would leave the entry pointing at nobody. Set them inactive instead.",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const before = await endUsers.getEndUser(request.params.id, companyId);
      await endUsers.deleteEndUser(request.params.id, companyId);
      await recordAudit(request, request.ctx!, { action: "end-user.delete", before });
      reply.status(204);
      return null;
    },
  );
}
