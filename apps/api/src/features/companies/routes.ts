// Author: Brijesh Dave <https://github.com/brijeshdave>
// Companies CRUD. Company lifecycle (create/delete) and per-company management
// are permission-gated; the target company for :id routes is resolved from the
// path and access-checked. Zod schemas provide validation + OpenAPI docs.
import {
  ERROR_CODES,
  PERMISSIONS,
  type Permission,
  companySchema,
  createCompanySchema,
  listQuerySchema,
  paginatedResult,
  updateCompanySchema,
} from "@reportly/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { can } from "@reportly/shared";
import { recordAudit } from "@/core/audit.js";
import { trackChanges } from "@/core/history.js";
import { buildAuthContext, hasCompanyAccess, isSuperadmin } from "@/core/auth/context.js";
import { AppError } from "@/core/errors.js";
import * as companies from "@/features/companies/service.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";

const idParams = z.object({ id: z.guid() });
/** A location or group tied to a company. Enough for the UI to name and link it. */
const referenceSchema = z.object({ id: z.guid(), name: z.string() });

/** Guard for company-scoped routes: resolve ctx from the path company + permission. */
function requireCompanyPermission(permission: Permission) {
  return async function (request: FastifyRequest) {
    const userId = request.authUserId;
    if (!userId) throw new AppError(401, ERROR_CODES.UNAUTHENTICATED, "Authentication required");
    const { id } = request.params as { id: string };
    if (!(await hasCompanyAccess(userId, id))) {
      throw new AppError(403, ERROR_CODES.FORBIDDEN, "No access to this company");
    }
    const ctx = await buildAuthContext(userId, id);
    if (!can(ctx, permission)) {
      throw new AppError(403, ERROR_CODES.FORBIDDEN, "Insufficient permissions");
    }
    request.ctx = ctx;
  };
}

export async function companiesRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/companies",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Companies"],
        summary: "List companies the caller can access (standard pagination/sort/filter)",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(companySchema) },
      },
    },
    async (request) => {
      const userId = request.authUserId!;
      return companies.listCompanies(
        await resolveListQuery(request.query, userId),
        userId,
        await isSuperadmin(userId),
      );
    },
  );

  app.post(
    "/companies",
    {
      preHandler: [
        app.authenticate,
        app.companyContext,
        app.requirePermission(PERMISSIONS.COMPANIES_CREATE),
      ],
      schema: {
        tags: ["Companies"],
        summary: "Create a company (auto-creates its Remote location)",
        body: createCompanySchema,
        response: { 201: companySchema },
      },
    },
    async (request, reply) => {
      const company = await companies.createCompany(request.body.name);
      await recordAudit(request, request.ctx!, {
        action: "company.create",
        companyId: company.id,
        after: company,
      });
      reply.status(201);
      return company;
    },
  );

  app.get(
    "/companies/:id",
    {
      preHandler: [app.authenticate, requireCompanyPermission(PERMISSIONS.COMPANIES_READ)],
      schema: {
        tags: ["Companies"],
        summary: "Get a company",
        params: idParams,
        response: { 200: companySchema },
      },
    },
    async (request) => companies.getCompany(request.params.id),
  );

  app.patch(
    "/companies/:id",
    {
      preHandler: [app.authenticate, requireCompanyPermission(PERMISSIONS.COMPANIES_UPDATE)],
      schema: {
        tags: ["Companies"],
        summary: "Update a company",
        params: idParams,
        body: updateCompanySchema,
        response: { 200: companySchema },
      },
    },
    async (request) => {
      const before = await companies.getCompany(request.params.id);
      const updated = await companies.updateCompany(
        request.params.id,
        request.body.name ?? before.name,
      );
      await recordAudit(request, request.ctx!, {
        action: "company.update",
        companyId: updated.id,
        before,
        after: updated,
      });
      await trackChanges(request, request.ctx!, "companies", updated.id, before, updated);
      return updated;
    },
  );

  // Deactivating retires a company without destroying its locations or narrowing
  // any group's scope.
  for (const [action, status] of [
    ["deactivate", "inactive"],
    ["reactivate", "active"],
  ] as const) {
    app.post(
      `/companies/:id/${action}`,
      {
        preHandler: [app.authenticate, requireCompanyPermission(PERMISSIONS.COMPANIES_UPDATE)],
        schema: {
          tags: ["Companies"],
          summary: `${action[0]!.toUpperCase()}${action.slice(1)} a company`,
          params: idParams,
          response: { 200: companySchema },
        },
      },
      async (request) => {
        const before = await companies.getCompany(request.params.id);
        const company = await companies.setStatus(request.params.id, status);
        await recordAudit(request, request.ctx!, {
          action: `company.${action}`,
          companyId: company.id,
          before,
          after: company,
        });
        await trackChanges(request, request.ctx!, "companies", company.id, before, company);
        return company;
      },
    );
  }

  app.get(
    "/companies/:id/references",
    {
      preHandler: [app.authenticate, requireCompanyPermission(PERMISSIONS.COMPANIES_READ)],
      schema: {
        tags: ["Companies"],
        summary: "What deleting this company would destroy (locations) or detach (groups)",
        params: idParams,
        response: {
          200: z.object({
            locations: z.array(referenceSchema),
            groups: z.array(referenceSchema),
          }),
        },
      },
    },
    async (request) => companies.companyReferences(request.params.id),
  );

  app.delete(
    "/companies/:id",
    {
      preHandler: [app.authenticate, requireCompanyPermission(PERMISSIONS.COMPANIES_DELETE)],
      schema: {
        tags: ["Companies"],
        summary:
          "Delete a company. Refused with 409 while it has locations beyond Remote, or groups scoped to it, unless cascade=true.",
        params: idParams,
        querystring: z.object({ cascade: z.coerce.boolean().default(false) }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const before = await companies.getCompany(request.params.id);
      const { destroyed } = await companies.deleteCompany(request.params.id, request.query.cascade);
      await recordAudit(request, request.ctx!, {
        action: "company.delete",
        companyId: before.id,
        before,
        // What the cascade took with it, so the trail is not just "deleted".
        details: { destroyed },
      });
      reply.status(204);
      return null;
    },
  );
}
