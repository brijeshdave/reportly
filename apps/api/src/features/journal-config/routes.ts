// Author: Brijesh Dave <https://github.com/brijeshdave>
// The three report-config catalogues: severities, statuses, categories. Reading is
// gated on reports:read (anyone who files a report picks from these); managing is
// admin-only via report-config:manage. Audited; zod schemas validate + document.
import {
  PERMISSIONS,
  createCategorySchema,
  createReportStatusSchema,
  createSeveritySchema,
  categoryRowSchema,
  journalStatusSchema,
  severitySchema,
  updateCategorySchema,
  updateReportStatusSchema,
  updateSeveritySchema,
} from "@reportly/shared";
import { ERROR_CODES } from "@reportly/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { AppError } from "@/core/errors.js";
import { parseUpload, sendXlsx } from "@/core/spreadsheet/http.js";
import * as config from "@/features/journal-config/service.js";
import {
  buildExport,
  buildTemplate,
  parseCsv,
  parseXlsx,
} from "@/features/journal-config/import-parse.js";

const idParams = z.object({ id: z.guid() });

function activeCompany(companyId: string | null): string {
  if (!companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  return companyId;
}

export async function reportConfigRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];
  const READ = PERMISSIONS.JOURNAL_READ;
  // Severities and statuses change what work already recorded is *worth*, so they
  // keep the heavier grant. A department's categories are its own vocabulary and
  // have their own permission, which an admin can hand to whichever group owns it.
  const MANAGE = PERMISSIONS.JOURNAL_CONFIG_MANAGE;
  const CATEGORIES = PERMISSIONS.CATEGORIES_MANAGE;

  const audit = (request: FastifyRequest, action: string, details: unknown) =>
    recordAudit(request, request.ctx!, { action, details });

  const IMPORT = PERMISSIONS.JOURNAL_CONFIG_IMPORT;

  /* ------------------------- Bulk export / import -------------------------- */

  app.get(
    "/journal-config/export",
    {
      preHandler: guard(IMPORT),
      schema: {
        tags: ["JournalEntry config"],
        summary:
          "Export the whole journal vocabulary (severities, statuses, categories, tags) as an .xlsx",
      },
    },
    async (request, reply) => {
      const rows = await config.exportVocabulary(activeCompany(request.ctx!.companyId));
      return sendXlsx(reply, await buildExport(rows), "journal-vocabulary.xlsx");
    },
  );

  app.get(
    "/journal-config/import/template",
    {
      preHandler: guard(IMPORT),
      schema: {
        tags: ["JournalEntry config"],
        summary: "Download the journal-vocabulary import template (.xlsx)",
      },
    },
    async (_request, reply) =>
      sendXlsx(reply, await buildTemplate(), "journal-vocabulary-import-template.xlsx"),
  );

  app.post(
    "/journal-config/import",
    {
      preHandler: guard(IMPORT),
      schema: {
        tags: ["JournalEntry config"],
        summary: "Create or update the journal vocabulary in bulk from an .xlsx or .csv upload",
        description:
          "One file, four kinds (the Kind column): company-wide severities and statuses, and per-department " +
          "categories and tags. Terms are matched by name (by department for categories/tags); an existing " +
          "term is updated, a new one created. All or nothing: if any row is wrong nothing is written, and " +
          "every problem is returned with its line number.",
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
      const outcome = await config.importVocabulary(companyId, parsed);
      if (outcome.created > 0 || outcome.updated > 0) {
        await recordAudit(request, request.ctx!, {
          action: "journal-config.import",
          after: { created: outcome.created, updated: outcome.updated },
        });
      }
      return outcome;
    },
  );

  /* ------------------------------ Severities ------------------------------- */

  app.get(
    "/severities",
    {
      preHandler: guard(READ),
      schema: {
        tags: ["JournalEntry config"],
        summary: "The severity ladder, low to high",
        response: { 200: z.array(severitySchema) },
      },
    },
    async () => config.listSeverities(),
  );

  app.post(
    "/severities",
    {
      preHandler: guard(MANAGE),
      schema: {
        tags: ["JournalEntry config"],
        summary: "Create a severity",
        body: createSeveritySchema,
        response: { 201: severitySchema },
      },
    },
    async (request, reply) => {
      const severity = await config.createSeverity(request.body);
      await audit(request, "severity.create", { severityId: severity.id });
      reply.status(201);
      return severity;
    },
  );

  app.patch(
    "/severities/:id",
    {
      preHandler: guard(MANAGE),
      schema: {
        tags: ["JournalEntry config"],
        summary: "Update a severity (name, order, status)",
        params: idParams,
        body: updateSeveritySchema,
        response: { 200: severitySchema },
      },
    },
    async (request) => {
      const severity = await config.updateSeverity(request.params.id, request.body);
      await audit(request, "severity.update", { severityId: severity.id });
      return severity;
    },
  );

  app.delete(
    "/severities/:id",
    {
      preHandler: guard(MANAGE),
      schema: {
        tags: ["JournalEntry config"],
        summary: "Delete a severity",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await config.deleteSeverity(request.params.id);
      await audit(request, "severity.delete", { severityId: request.params.id });
      reply.status(204);
      return null;
    },
  );

  /* ------------------------------- Statuses -------------------------------- */

  app.get(
    "/journal-statuses",
    {
      preHandler: guard(READ),
      schema: {
        tags: ["JournalEntry config"],
        summary: "The report status workflow",
        response: { 200: z.array(journalStatusSchema) },
      },
    },
    async () => config.listStatuses(),
  );

  app.post(
    "/journal-statuses",
    {
      preHandler: guard(MANAGE),
      schema: {
        tags: ["JournalEntry config"],
        summary: "Create a status",
        body: createReportStatusSchema,
        response: { 201: journalStatusSchema },
      },
    },
    async (request, reply) => {
      const status = await config.createStatus(request.body);
      await audit(request, "report-status.create", { statusId: status.id });
      reply.status(201);
      return status;
    },
  );

  app.patch(
    "/journal-statuses/:id",
    {
      preHandler: guard(MANAGE),
      schema: {
        tags: ["JournalEntry config"],
        summary: "Update a status (name, group, terminal, order)",
        params: idParams,
        body: updateReportStatusSchema,
        response: { 200: journalStatusSchema },
      },
    },
    async (request) => {
      const status = await config.updateStatus(request.params.id, request.body);
      await audit(request, "report-status.update", { statusId: status.id });
      return status;
    },
  );

  app.delete(
    "/journal-statuses/:id",
    {
      preHandler: guard(MANAGE),
      schema: {
        tags: ["JournalEntry config"],
        summary: "Delete a status",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await config.deleteStatus(request.params.id);
      await audit(request, "report-status.delete", { statusId: request.params.id });
      reply.status(204);
      return null;
    },
  );

  /* ------------------------------ Categories ------------------------------- */

  app.get(
    "/categories",
    {
      preHandler: guard(READ),
      schema: {
        tags: ["JournalEntry config"],
        summary: "JournalEntry categories; filter to one department with ?departmentId=",
        querystring: z.object({ departmentId: z.guid().optional() }),
        response: { 200: z.array(categoryRowSchema) },
      },
    },
    async (request) => config.listCategories(request.query.departmentId),
  );

  app.post(
    "/categories",
    {
      preHandler: guard(CATEGORIES),
      schema: {
        tags: ["JournalEntry config"],
        summary: "Create a category in a department",
        body: createCategorySchema,
        response: { 201: categoryRowSchema },
      },
    },
    async (request, reply) => {
      const category = await config.createCategory(
        request.body,
        activeCompany(request.ctx!.companyId),
      );
      await audit(request, "category.create", { categoryId: category.id });
      reply.status(201);
      return category;
    },
  );

  app.patch(
    "/categories/:id",
    {
      preHandler: guard(CATEGORIES),
      schema: {
        tags: ["JournalEntry config"],
        summary: "Rename a category, or retire it (its department is fixed)",
        params: idParams,
        body: updateCategorySchema,
        response: { 200: categoryRowSchema },
      },
    },
    async (request) => {
      const category = await config.updateCategory(request.params.id, request.body);
      await audit(request, "category.update", { categoryId: category.id });
      return category;
    },
  );

  app.delete(
    "/categories/:id",
    {
      preHandler: guard(CATEGORIES),
      schema: {
        tags: ["JournalEntry config"],
        summary: "Delete a category",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await config.deleteCategory(request.params.id);
      await audit(request, "category.delete", { categoryId: request.params.id });
      reply.status(204);
      return null;
    },
  );
}
