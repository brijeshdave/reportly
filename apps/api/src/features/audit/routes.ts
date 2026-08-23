// Author: Brijesh Dave <https://github.com/brijeshdave>
// Audit trail + change history read APIs. Read-only by design: audit rows are
// immutable, so there is no write path here. Gated by audit:view (admin-only) and
// scoped to the caller's active company unless they are a superadmin.
import {
  ERROR_CODES,
  PERMISSIONS,
  TRACKED_ENTITIES,
  auditEventSchema,
  can,
  entityHistorySchema,
  listQuerySchema,
  paginatedResult,
} from "@reportly/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { AppError } from "@/core/errors.js";
import { auditScope, distinctActions } from "@/features/audit/repo.js";
import { exportAuditEvents, getAuditEvents, getEntityHistory } from "@/features/audit/service.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";

const historyParams = z.object({
  entityType: z.enum(TRACKED_ENTITIES),
  id: z.string().min(1),
});

/** Superadmins see everything; everyone else is limited to their active company. */
function scopeFor(request: FastifyRequest) {
  const ctx = request.ctx!;
  return auditScope(ctx.isSuperadmin ? null : ctx.companyId);
}

export async function auditRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.AUDIT_VIEW),
  ];

  app.get(
    "/audit-events",
    {
      preHandler: guard,
      schema: {
        tags: ["Audit"],
        summary: "List audit events (standard pagination/sort/filter)",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(auditEventSchema) },
      },
    },
    async (request) =>
      getAuditEvents(await resolveListQuery(request.query, request.authUserId), scopeFor(request)),
  );

  /**
   * The action names present, so the filter can offer them instead of asking
   * somebody to remember that it is spelled "user.two-factor.reset".
   *
   * A static path, and before /audit-events/:id would be if one existed.
   */
  app.get(
    "/audit-events/actions",
    {
      preHandler: guard,
      schema: {
        tags: ["Audit"],
        summary: "The audit action names actually present, for the filter",
        response: { 200: z.array(z.string()) },
      },
    },
    async (request) => distinctActions(scopeFor(request)),
  );

  app.get(
    "/audit-events/export",
    {
      preHandler: guard,
      schema: {
        tags: ["Audit"],
        summary: "Download the audit trail (streamed csv or newline-delimited json)",
        querystring: z.object({ format: z.enum(["csv", "json"]).default("csv") }),
      },
    },
    async (request, reply) => {
      const { format } = request.query;
      reply
        .header(
          "content-type",
          format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson",
        )
        .header("content-disposition", `attachment; filename="audit-events.${format}"`);
      return reply.send(exportAuditEvents(scopeFor(request), format));
    },
  );

  // NOTE: deliberately `/history/:entityType/:id` rather than `/:entity/:id/history`.
  // The latter is shadowed by `/settings/:namespace/:key` (same shape, and Fastify
  // prefers the static `settings` segment), so settings history would be unreachable.
  app.get(
    "/history/:entityType/:id",
    {
      // Not the audit guard: a record's own history is a lighter thing than the
      // company-wide trail, and someone who may read the record should be able to
      // be granted it. An administrator with audit:view keeps it either way.
      preHandler: [
        app.authenticate,
        app.companyContext,
        async (request) => {
          const ctx = request.ctx;
          if (!ctx) throw new AppError(401, ERROR_CODES.UNAUTHENTICATED, "Authentication required");
          if (!can(ctx, PERMISSIONS.HISTORY_READ) && !can(ctx, PERMISSIONS.AUDIT_VIEW)) {
            throw new AppError(403, ERROR_CODES.FORBIDDEN, "Insufficient permissions");
          }
        },
      ],
      schema: {
        tags: ["Audit"],
        summary: "Field-level change history for an entity",
        params: historyParams,
        querystring: listQuerySchema,
        response: { 200: paginatedResult(entityHistorySchema) },
      },
    },
    async (request) => {
      const { entityType, id } = request.params;
      if (!(TRACKED_ENTITIES as readonly string[]).includes(entityType)) {
        throw new AppError(404, ERROR_CODES.NOT_FOUND, `History is not tracked for ${entityType}`);
      }
      return getEntityHistory(
        entityType,
        id,
        await resolveListQuery(request.query, request.authUserId),
      );
    },
  );
}
