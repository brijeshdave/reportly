// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reliability and recurrence analytics over the reports domain.
//
// Every route here is gated on `analytics:view` — deliberately not `:read`, which
// the role seed grants to Member. An aggregate cannot be filtered to the caller's
// downline the way a report list is (MTBF that differs per viewer is not the
// asset's MTBF), so whoever holds this sees counts across everyone's reports. That
// is a fact about the machine rather than about a person, which is why Manager has
// it — but it is a widening, so it stops there.
import {
  PERMISSIONS,
  analyticsWindowQuerySchema,
  analyticsWindowSchema,
  insightsSchema,
  managementPackQuerySchema,
  managementPackSchema,
  assetReliabilityReportSchema,
  recurringIssueSchema,
  recurringIssuesQuerySchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { ERROR_CODES } from "@reportly/shared";
import { AppError } from "@/core/errors.js";
import * as analytics from "@/features/analytics/service.js";
import { managementPack } from "@/features/analytics/pack-service.js";

// Kept as a plain string, not `z.guid()`, so an unknown asset is a 404
// from the handler rather than a 400 from the schema — the documented convention
// for params that need to distinguish "malformed" from "not yours".
const idParams = z.object({ id: z.string() });

function activeCompany(companyId: string | null): string {
  if (!companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  return companyId;
}

export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.ANALYTICS_VIEW),
  ];

  // Insights is its OWN permission, not analytics:view. The charts show the shape
  // of the work — how many issues, where downtime goes, who is contributing —
  // which an organisation may well want on a wall screen without also handing
  // over the reliability figures. See the note on the permission.
  const insightsGuard = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.INSIGHTS_VIEW),
  ];

  // The management pack — a month of the plant as headline numbers and sections of
  // charts, for the meeting and the slide deck.
  //
  // Gated on `insights:view` rather than `analytics:view`, for the reason the note
  // above gives: the pack is the shape of the work, which is what somebody presents
  // to management, and the reliability figures it borrows are already visible to
  // anybody who can open Insights.
  app.get(
    "/insights/pack",
    {
      preHandler: insightsGuard,
      schema: {
        tags: ["Analytics"],
        summary: "A month of the plant as indicators and charts, for a management pack",
        querystring: managementPackQuerySchema,
        response: { 200: managementPackSchema },
      },
    },
    async (request) => managementPack(request.query, activeCompany(request.ctx!.companyId)),
  );

  app.get(
    "/insights",
    {
      preHandler: insightsGuard,
      schema: {
        tags: ["Analytics"],
        summary: "Every Insights chart for a window, in one response",
        querystring: analyticsWindowQuerySchema,
        response: { 200: insightsSchema },
      },
    },
    async (request) => analytics.insights(activeCompany(request.ctx!.companyId), request.query),
  );

  app.get(
    "/analytics/assets/:id",
    {
      preHandler: guard,
      schema: {
        tags: ["Analytics"],
        summary: "Reliability for an asset and everything under it — MTBF, MTTR, availability",
        description:
          "Computed over the whole subtree: the asset, its descendants, and the devices that live at any of them. " +
          "MTBF is null when nothing failed in the window (unmeasured, not perfect) and MTTR is null when nothing " +
          "was closed. The window is echoed back because every figure moves with it.",
        params: idParams,
        querystring: analyticsWindowQuerySchema,
        response: { 200: assetReliabilityReportSchema },
      },
    },
    async (request) =>
      analytics.assetReliability(
        request.ctx!,
        request.params.id,
        activeCompany(request.ctx!.companyId),
        request.query,
      ),
  );

  app.get(
    "/analytics/recurring",
    {
      preHandler: guard,
      schema: {
        tags: ["Analytics"],
        summary: "Issues that keep coming back, worst first",
        description:
          "Submitted issue reports grouped by what they are about and their category, counted over the window. " +
          "Only groups with more than one occurrence are returned — one is not a pattern. Narrow to a line with " +
          "`assetId`, which covers its whole subtree.",
        querystring: recurringIssuesQuerySchema,
        response: {
          200: z.object({
            window: analyticsWindowSchema,
            items: z.array(recurringIssueSchema),
          }),
        },
      },
    },
    async (request) => analytics.recurring(activeCompany(request.ctx!.companyId), request.query),
  );
}
