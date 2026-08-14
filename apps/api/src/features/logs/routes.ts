// Author: Brijesh Dave <https://github.com/brijeshdave>
// Client log reporter. Browser errors/logs enter the same pipeline (and the same
// sinks) as server logs, tagged feature="client" and carrying the request id, so
// one id traces a user action from the browser through the API and its jobs.
import {
  PERMISSIONS,
  listQuerySchema,
  logEntrySchema,
  logLevelSchema,
  paginatedResult,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { exportLogs, getLogTail, getLogs } from "@/features/logs/service.js";
import { consumeRateLimit } from "@/lib/rate-limit.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";

const CLIENT_LOG_MAX_PER_MINUTE = 30;

const clientLogBody = z.object({
  level: logLevelSchema.default("info"),
  msg: z.string().min(1).max(2000),
  context: z.record(z.string(), z.unknown()).optional(),
});

export async function logsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/logs/client",
    {
      preHandler: async (request) => {
        await consumeRateLimit(`rl:logs:client:${request.ip}`, CLIENT_LOG_MAX_PER_MINUTE, 60);
      },
      schema: {
        tags: ["Logs"],
        summary: "JournalEntry a client-side log or error into the server log pipeline",
        body: clientLogBody,
        response: { 202: z.object({ accepted: z.literal(true) }) },
      },
    },
    async (request, reply) => {
      const { level, msg, context } = request.body;
      // request.log already carries reqId; tag the feature and (if known) the user.
      const log = request.log.child({ feature: "client", userId: request.authUserId });
      log[level](context ?? {}, msg);
      reply.status(202);
      return { accepted: true as const };
    },
  );

  // --- reading logs (admin-only) ---
  const guard = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.LOGS_VIEW),
  ];

  app.get(
    "/logs",
    {
      preHandler: guard,
      schema: {
        tags: ["Logs"],
        summary: "Search logs (filter by level/feature/requestId/userId/ts; standard pagination)",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(logEntrySchema) },
      },
    },
    async (request) => getLogs(await resolveListQuery(request.query, request.authUserId)),
  );

  app.get(
    "/logs/tail",
    {
      preHandler: guard,
      schema: {
        tags: ["Logs"],
        summary: "Poll for new log lines since an opaque cursor (live tail)",
        querystring: z.object({
          cursor: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
        response: {
          200: z.object({
            entries: z.array(logEntrySchema),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => getLogTail(request.query.cursor, request.query.limit),
  );

  app.get(
    "/logs/export",
    {
      preHandler: guard,
      schema: {
        tags: ["Logs"],
        summary: "Download logs (streamed csv or newline-delimited json)",
        querystring: listQuerySchema.extend({ format: z.enum(["csv", "json"]).default("csv") }),
      },
    },
    async (request, reply) => {
      const { format, ...rest } = request.query;
      const query = await resolveListQuery(rest, request.authUserId);
      reply
        .header(
          "content-type",
          format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson",
        )
        .header("content-disposition", `attachment; filename="logs.${format}"`);
      return reply.send(exportLogs(query, format));
    },
  );
}
