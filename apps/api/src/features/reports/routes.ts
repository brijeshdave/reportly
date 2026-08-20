// Author: Brijesh Dave <https://github.com/brijeshdave>
// Generated-reports routes: running a report (JSON, Excel, or standalone A4 HTML),
// and the CRUD for saved report views. `reports:view` runs and reads; `reports:export`
// downloads; `reports:manage` creates/edits/deletes/clones custom views. The rows a
// report contains are always scoped by the journal's own rules inside the service —
// these permissions widen which report *shapes* a caller may run, never the rows.
import {
  PERMISSIONS,
  createReportViewSchema,
  cloneReportViewSchema,
  leaderboardQuerySchema,
  leaderboardResultSchema,
  reportResultSchema,
  reportViewSchema,
  runReportSchema,
  updateReportViewSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import * as reports from "@/features/reports/service.js";
import { reportToHtml } from "@/features/reports/html.js";
import { reportToXlsx } from "@/features/reports/xlsx.js";

const idParams = z.object({ id: z.string() });

// The browser's UTC offset (minutes east of UTC), so "today"/"this week" and the
// by-day grouping land on the operator's day rather than UTC's.
const tzQuery = z.object({
  tzOffsetMinutes: z.coerce.number().int().min(-720).max(840).optional(),
});

function tz(query: { tzOffsetMinutes?: number }): number {
  return query.tzOffsetMinutes ?? 0;
}

function fileName(name: string | null, ext: string): string {
  const base = (name ?? "report").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base}-${stamp}.${ext}`;
}

export async function reportsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Which report is being asked for arrives in the **body** — a source, or a saved
  // view that names one — so there is no fixed permission a route guard could
  // check. These admit an authenticated caller; the service checks the key for the
  // report it just resolved (`assertMayRead`), which is the only place that can
  // know it. Viewing includes exporting and printing, so both use the same list.
  const canView = [app.authenticate, app.companyContext];
  const canExport = canView;
  const canManage = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.REPORTS_MANAGE),
  ];
  // The leaderboard page has its own permission, separate from the reports library.
  const canViewLeaderboard = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.LEADERBOARD_VIEW),
  ];

  // --- the dedicated leaderboard page ---

  app.get(
    "/reports/leaderboard",
    {
      preHandler: canViewLeaderboard,
      schema: {
        tags: ["Reports"],
        summary: "The top people by points, for the leaderboard page",
        description:
          "The top `limit` people by points earned over the range, optionally within one department. " +
          "Company-wide for holders of analytics:view; otherwise the caller's own reporting line.",
        querystring: leaderboardQuerySchema,
        response: { 200: leaderboardResultSchema },
      },
    },
    async (request) => reports.leaderboard(request.ctx!, request.query),
  );

  // --- running a report ---

  app.post(
    "/reports/run",
    {
      preHandler: canView,
      schema: {
        tags: ["Reports"],
        summary: "Run a report — gather the journal rows into groups with subtotals",
        description:
          "Pass a saved `viewId`, an inline `definition`, or both (the inline definition overrides the saved one). " +
          "Rows are the caller's own journal scope: reporting line and location, submitted entries only.",
        querystring: tzQuery,
        body: runReportSchema,
        response: { 200: reportResultSchema },
      },
    },
    async (request) => reports.runReport(request.ctx!, request.body, tz(request.query)),
  );

  app.post(
    "/reports/export.xlsx",
    {
      preHandler: canExport,
      schema: {
        tags: ["Reports"],
        summary: "Download a report as an Excel workbook",
        querystring: tzQuery,
        body: runReportSchema,
      },
    },
    async (request, reply) => {
      const result = await reports.runReport(request.ctx!, request.body, tz(request.query));
      const buffer = await reportToXlsx(result);
      reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(fileName(result.meta.viewName, "xlsx"))}`,
        )
        .header("content-length", String(buffer.length))
        .header("cache-control", "no-store");
      return reply.send(buffer);
    },
  );

  app.post(
    "/reports/export.html",
    {
      preHandler: canExport,
      schema: {
        tags: ["Reports"],
        summary: "Download a report as a standalone, print-ready A4 HTML page",
        querystring: tzQuery,
        body: runReportSchema,
      },
    },
    async (request, reply) => {
      const result = await reports.runReport(request.ctx!, request.body, tz(request.query));
      const html = reportToHtml(result);
      reply
        .header("content-type", "text/html; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(fileName(result.meta.viewName, "html"))}`,
        )
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff");
      return reply.send(html);
    },
  );

  // --- saved report views ---

  app.get(
    "/report-views",
    {
      preHandler: canView,
      schema: {
        tags: ["Reports"],
        summary: "The report views the caller may run — system views plus those shared with them",
        response: { 200: z.array(reportViewSchema) },
      },
    },
    async (request) => reports.listViews(request.ctx!),
  );

  app.get(
    "/report-views/:id",
    {
      preHandler: canView,
      schema: {
        tags: ["Reports"],
        summary: "One report view",
        params: idParams,
        response: { 200: reportViewSchema },
      },
    },
    async (request) => reports.getView(request.ctx!, request.params.id),
  );

  app.post(
    "/report-views",
    {
      preHandler: canManage,
      schema: {
        tags: ["Reports"],
        summary: "Create a custom report view",
        body: createReportViewSchema,
        response: { 201: reportViewSchema },
      },
    },
    async (request, reply) => {
      const view = await reports.createView(request.ctx!, request.body);
      reply.status(201);
      return view;
    },
  );

  app.patch(
    "/report-views/:id",
    {
      preHandler: canManage,
      schema: {
        tags: ["Reports"],
        summary: "Edit a custom report view (never a system one) and set who it is shared with",
        params: idParams,
        body: updateReportViewSchema,
        response: { 200: reportViewSchema },
      },
    },
    async (request) => reports.updateView(request.ctx!, request.params.id, request.body),
  );

  app.delete(
    "/report-views/:id",
    {
      preHandler: canManage,
      schema: {
        tags: ["Reports"],
        summary: "Delete a custom report view",
        params: idParams,
      },
    },
    async (request, reply) => {
      await reports.deleteView(request.ctx!, request.params.id);
      reply.status(204);
    },
  );

  app.post(
    "/report-views/:id/clone",
    {
      preHandler: canManage,
      schema: {
        tags: ["Reports"],
        summary: "Clone any view the caller may see into a new custom view they own",
        params: idParams,
        body: cloneReportViewSchema,
        response: { 201: reportViewSchema },
      },
    },
    async (request, reply) => {
      const view = await reports.cloneView(request.ctx!, request.params.id, request.body.name);
      reply.status(201);
      return view;
    },
  );
}
