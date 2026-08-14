// Author: Brijesh Dave <https://github.com/brijeshdave>
// The self-serve points endpoints, behind `points:read` (which every role holds). The
// ledger lists each award over a window; the summary rolls them up per person. Both are
// scoped to the caller's reporting line — or the whole company for an analytics viewer —
// so the permission only decides reaching the page, never whose points it reveals.
import {
  PERMISSIONS,
  pointsLedgerResultSchema,
  pointsQuerySchema,
  pointsSummaryResultSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import * as points from "@/features/points/service.js";

export async function pointsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.POINTS_READ),
  ];

  app.get(
    "/points/ledger",
    {
      preHandler: guard,
      schema: {
        tags: ["Points"],
        summary: "Your points ledger and your team's — one row per award",
        description:
          "Every award earned over the range for the caller's reporting line (company-wide for analytics:view). " +
          "Filter by source; newest first.",
        querystring: pointsQuerySchema,
        response: { 200: pointsLedgerResultSchema },
      },
    },
    async (request) => points.ledger(request.ctx!, request.query),
  );

  app.get(
    "/points/summary",
    {
      preHandler: guard,
      schema: {
        tags: ["Points"],
        summary: "Points per person — own, rolled-up team, and total",
        querystring: pointsQuerySchema,
        response: { 200: pointsSummaryResultSchema },
      },
    },
    async (request) => points.summary(request.ctx!, request.query),
  );
}
