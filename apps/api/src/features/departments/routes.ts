// Author: Brijesh Dave <https://github.com/brijeshdave>
// Departments CRUD, tree, and membership, scoped to the active company
// (X-Company-Id -> ctx.companyId). Permission-gated and audited; Zod schemas
// provide validation + OpenAPI docs.
import {
  ERROR_CODES,
  PERMISSIONS,
  createDepartmentSchema,
  departmentMemberSchema,
  departmentNodeSchema,
  departmentSchema,
  downlineMemberSchema,
  orgChartNodeSchema,
  orgPersonSchema,
  setDepartmentMembersSchema,
  updateDepartmentSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { trackChanges } from "@/core/history.js";
import { AppError } from "@/core/errors.js";
import { parseUpload, sendXlsx } from "@/core/spreadsheet/http.js";
import * as departments from "@/features/departments/service.js";
import {
  buildExport,
  buildTemplate,
  parseCsv,
  parseXlsx,
} from "@/features/departments/import-parse.js";

const idParams = z.object({ id: z.guid() });

function activeCompany(companyId: string | null): string {
  if (!companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "X-Company-Id header is required");
  }
  return companyId;
}

export async function departmentsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  app.get(
    "/departments",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_READ),
      schema: {
        tags: ["Departments"],
        summary: "List departments in the active company (flat; assemble the tree by parentId)",
        response: { 200: z.array(departmentNodeSchema) },
      },
    },
    async (request) => departments.listDepartments(activeCompany(request.ctx!.companyId)),
  );

  // --- bulk export / import (static paths, before /:id) ---

  app.get(
    "/departments/export",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_READ),
      schema: {
        tags: ["Departments"],
        summary: "Export the org tree as an .xlsx (one row per department, by path)",
      },
    },
    async (request, reply) => {
      const rows = await departments.exportDepartments(activeCompany(request.ctx!.companyId));
      return sendXlsx(reply, await buildExport(rows), "departments.xlsx");
    },
  );

  app.get(
    "/departments/import/template",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_IMPORT),
      schema: { tags: ["Departments"], summary: "Download the department import template (.xlsx)" },
    },
    async (_request, reply) =>
      sendXlsx(reply, await buildTemplate(), "department-import-template.xlsx"),
  );

  app.post(
    "/departments/import",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_IMPORT),
      schema: {
        tags: ["Departments"],
        summary: "Build or update the org tree in bulk from an .xlsx or .csv upload",
        description:
          "Each row is a full path from the root; missing ancestors are created and an existing path has " +
          "its status updated. Membership (rank, reporting line, sites) is the user import's concern. All " +
          "or nothing: if any row is wrong nothing is written, and every problem is returned with its line.",
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
      const outcome = await departments.importDepartments(companyId, parsed);
      if (outcome.created > 0 || outcome.updated > 0) {
        await recordAudit(request, request.ctx!, {
          action: "department.import",
          after: { created: outcome.created, updated: outcome.updated },
        });
      }
      return outcome;
    },
  );

  app.post(
    "/departments",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_CREATE),
      schema: {
        tags: ["Departments"],
        summary: "Create a department in the active company",
        body: createDepartmentSchema,
        response: { 201: departmentSchema },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const department = await departments.createDepartment(
        companyId,
        request.body.name,
        request.body.parentId ?? null,
      );
      await recordAudit(request, request.ctx!, { action: "department.create", after: department });
      reply.status(201);
      return department;
    },
  );

  app.get(
    "/departments/:id",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_READ),
      schema: {
        tags: ["Departments"],
        summary: "Get a department",
        params: idParams,
        response: { 200: departmentSchema },
      },
    },
    async (request) =>
      departments.getDepartment(request.params.id, activeCompany(request.ctx!.companyId)),
  );

  app.patch(
    "/departments/:id",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_UPDATE),
      schema: {
        tags: ["Departments"],
        summary: "Rename or re-parent a department",
        params: idParams,
        body: updateDepartmentSchema,
        response: { 200: departmentSchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const before = await departments.getDepartment(request.params.id, companyId);
      const updated = await departments.updateDepartment(
        request.params.id,
        companyId,
        request.body,
      );
      await recordAudit(request, request.ctx!, {
        action: "department.update",
        before,
        after: updated,
      });
      await trackChanges(request, request.ctx!, "departments", updated.id, before, updated);
      return updated;
    },
  );

  // Deactivating is the reversible alternative to deleting: members and the
  // subtree stay intact, the department simply stops being offered for new work.
  for (const [action, status] of [
    ["deactivate", "inactive"],
    ["reactivate", "active"],
  ] as const) {
    app.post(
      `/departments/:id/${action}`,
      {
        preHandler: guard(PERMISSIONS.DEPARTMENTS_UPDATE),
        schema: {
          tags: ["Departments"],
          summary: `${action[0]!.toUpperCase()}${action.slice(1)} a department`,
          params: idParams,
          response: { 200: departmentSchema },
        },
      },
      async (request) => {
        const companyId = activeCompany(request.ctx!.companyId);
        const before = await departments.getDepartment(request.params.id, companyId);
        const department = await departments.setStatus(request.params.id, companyId, status);
        await recordAudit(request, request.ctx!, {
          action: `department.${action}`,
          before,
          after: department,
        });
        await trackChanges(request, request.ctx!, "departments", department.id, before, department);
        return department;
      },
    );
  }

  app.delete(
    "/departments/:id",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_DELETE),
      schema: {
        tags: ["Departments"],
        summary: "Delete a department. Refused with 409 while it has sub-departments or members.",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      await departments.deleteDepartment(request.params.id, companyId);
      await recordAudit(request, request.ctx!, {
        action: "department.delete",
        details: { departmentId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );

  app.get(
    "/departments/:id/members",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_READ),
      schema: {
        tags: ["Departments"],
        summary: "The members of a department, with their HOD flag",
        params: idParams,
        response: { 200: z.array(departmentMemberSchema) },
      },
    },
    async (request) =>
      departments.getMembers(request.params.id, activeCompany(request.ctx!.companyId)),
  );

  // The whole organisation, in one call: the chart page draws it without a request
  // per node. Registered before /departments/:id so "org-chart" is not read as an id.
  app.get(
    "/departments/org-chart",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_READ),
      schema: {
        tags: ["Departments"],
        summary: "Every membership in the active company, with its reporting edge",
        response: { 200: z.array(orgChartNodeSchema) },
      },
    },
    async (request) => departments.orgChart(activeCompany(request.ctx!.companyId)),
  );

  // The people a reporting edge may name. Registered before /departments/:id so
  // "people" is not swallowed as an id.
  app.get(
    "/departments/people",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_READ),
      schema: {
        tags: ["Departments"],
        summary: "Everyone with a membership in the active company (manager candidates)",
        response: { 200: z.array(orgPersonSchema) },
      },
    },
    async (request) => departments.orgPeople(activeCompany(request.ctx!.companyId)),
  );

  /**
   * Everyone below a person in the reporting line, at any depth.
   *
   * Gated on departments:read because it *is* the org chart. It is also the set the
   * reports feature will scope on — a Head of Department seeing their leads' juniors
   * comes from this walk, not from a job title.
   */
  app.get(
    "/users/:id/downline",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_READ),
      schema: {
        tags: ["Departments"],
        summary: "Everyone below this person in the reporting line, transitively",
        params: z.object({ id: z.string() }),
        response: { 200: z.array(downlineMemberSchema) },
      },
    },
    async (request) => departments.downline(request.params.id),
  );

  app.put(
    "/departments/:id/members",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_ASSIGN),
      schema: {
        tags: ["Departments"],
        summary: "Set the members of a department (replaces the whole set)",
        params: idParams,
        body: setDepartmentMembersSchema,
        response: { 200: z.array(departmentMemberSchema) },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      await departments.setMembers(request.params.id, companyId, request.body.members);
      await recordAudit(request, request.ctx!, {
        action: "department.assign.members",
        details: { departmentId: request.params.id, members: request.body.members },
      });
      return departments.getMembers(request.params.id, companyId);
    },
  );
}
