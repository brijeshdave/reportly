// Author: Brijesh Dave <https://github.com/brijeshdave>
// Composition root: builds the Fastify instance with security headers, CORS,
// request correlation, the shared error envelope, and versioned /api/v1 routes.
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";

import { registerAuth } from "@/core/auth/plugin.js";
import { registerDocs } from "@/core/docs.js";
import { closePools } from "@/core/db/pool.js";
import { closeEmailQueue } from "@/core/queue/email.js";
import { closeNotificationQueue } from "@/core/queue/notifications.js";
import { closeRedis } from "@/core/redis.js";
import { corsOrigins, env, trustProxy } from "@/core/env.js";
import { registerErrorHandler } from "@/core/errors.js";
import { isSystemDebugActive } from "@/core/debug/service.js";
import { currentQueryCount, runWithRequestContext } from "@/core/request-context.js";
import { logger } from "@/core/logger.js";
import { generateRequestId, REQUEST_ID_HEADER, registerRequestId } from "@/core/request-id.js";
import { auditRoutes } from "@/features/audit/routes.js";
import { messagesRoutes } from "@/features/messages/routes.js";
import { companiesRoutes } from "@/features/companies/routes.js";
import { debugRoutes } from "@/features/debug/routes.js";
import { groupsRoutes } from "@/features/groups/routes.js";
import { healthRoutes } from "@/features/health/routes.js";
import { locationsRoutes } from "@/features/locations/routes.js";
import { departmentsRoutes } from "@/features/departments/routes.js";
import { designationsRoutes } from "@/features/designations/routes.js";
import { reportConfigRoutes } from "@/features/journal-config/routes.js";
import { journalRoutes } from "@/features/journal/routes.js";
import { analyticsRoutes } from "@/features/analytics/routes.js";
import { reportsRoutes } from "@/features/reports/routes.js";
import { shiftsRoutes } from "@/features/shifts/routes.js";
import { routinesRoutes } from "@/features/routines/routes.js";
import { pointsRoutes } from "@/features/points/routes.js";
import { backupsRoutes } from "@/features/backups/routes.js";
import { vocabularyRoutes } from "@/features/vocabulary/routes.js";
import { commentsRoutes } from "@/features/comments/routes.js";
import { assetsRoutes } from "@/features/assets/routes.js";
import { devicesRoutes } from "@/features/devices/routes.js";
import { downtimeRoutes } from "@/features/downtime/routes.js";
import { tasksRoutes } from "@/features/tasks/routes.js";
import { attachmentsRoutes } from "@/features/attachments/routes.js";
import { channelsRoutes } from "@/features/channels/routes.js";
import { avatarsRoutes } from "@/features/avatars/routes.js";
import { logsRoutes } from "@/features/logs/routes.js";
import { meRoutes } from "@/features/me/routes.js";
import { notificationRoutes } from "@/features/notifications/routes.js";
import { partCatalogueRoutes } from "@/features/parts/catalogue-routes.js";
import { partsRoutes } from "@/features/parts/parts-routes.js";
import { serviceRoutes } from "@/features/parts/service-routes.js";
import { queuesRoutes } from "@/features/queues/routes.js";
import { rolesRoutes } from "@/features/roles/routes.js";
import { settingsRoutes } from "@/features/settings/routes.js";
import { ssoRoutes } from "@/features/sso/routes.js";
import { usersRoutes } from "@/features/users/routes.js";

export const API_PREFIX = "/api/v1";

/**
 * Largest request body we will read into memory. Nothing we accept is bulk — the
 * biggest is a role's permission list — so this is generous already, and stating
 * it keeps an unauthenticated POST from being a cheap way to spend our heap.
 * Fastify's own default happens to be the same; relying on that silently would
 * mean a Fastify release could change our exposure.
 */
const BODY_LIMIT_BYTES = 1_048_576; // 1 MiB

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Cast keeps the app's FastifyInstance generic on FastifyBaseLogger so route
    // modules (which take a plain FastifyInstance) stay assignable.
    loggerInstance: logger as FastifyBaseLogger,
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: (req) => generateRequestId(req),
    bodyLimit: BODY_LIMIT_BYTES,
    // Behind the bundled nginx, request.ip is the proxy unless we say to read the
    // forwarded header. Every per-IP rate limit and every audit IP depends on this
    // being right. It defaults to trusting nobody, because trusting a spoofable
    // header on a direct listener is worse than seeing the proxy — see TRUST_PROXY.
    trustProxy,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });

  // Attachments. The global bodyLimit above governs JSON; a multipart part is read
  // by this plugin and needs its own ceiling, or the 1 MiB limit would apply to
  // photos and nothing would upload. `fileSize` is enforced as the bytes arrive, so
  // an oversized file is cut off mid-stream instead of landing in the heap first.
  await app.register(multipart, {
    limits: {
      fileSize: env.STORAGE_MAX_UPLOAD_MB * 1024 * 1024,
      files: 1,
      // A form part that is not the file has no business being large.
      fieldSize: 1024,
    },
  });

  // Everything downstream runs inside the request context, so the request id is
  // available to code that never sees the Fastify request (jobs, auth callbacks).
  app.addHook("onRequest", (request, _reply, done) => {
    // System-wide debug applies to every request; `authenticate` may additionally
    // switch it on for the calling user.
    request.debugMode = isSystemDebugActive();
    runWithRequestContext({ requestId: String(request.id), queryCount: 0 }, done);
  });

  // Marker for the client (the web debug banner reads this).
  app.addHook("onSend", async (request, reply) => {
    if (request.debugMode) reply.header("x-debug", "on");
  });

  // Verbose per-request summary. Redaction is applied by the logger; auth routes
  // never contribute a request body — credentials must never reach a sink.
  app.addHook("onResponse", async (request, reply) => {
    if (!request.debugMode) return;
    const isAuthRoute = request.url.startsWith(`${API_PREFIX}/auth`);
    request.log.info(
      {
        feature: "debug",
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTimeMs: Math.round(reply.elapsedTime),
        queries: currentQueryCount(),
        ...(isAuthRoute ? {} : { body: request.body ?? null, query: request.query ?? null }),
      },
      "debug summary",
    );
  });

  registerRequestId(app);
  registerErrorHandler(app);
  app.addHook("onClose", async () => {
    await Promise.allSettled([
      closePools(),
      closeRedis(),
      closeEmailQueue(),
      closeNotificationQueue(),
    ]);
  });

  // Register docs before feature routes so their schemas are captured.
  await registerDocs(app);
  await registerAuth(app);
  await app.register(healthRoutes, { prefix: API_PREFIX });
  await app.register(meRoutes, { prefix: API_PREFIX });
  await app.register(notificationRoutes, { prefix: API_PREFIX });
  await app.register(channelsRoutes, { prefix: API_PREFIX });
  await app.register(ssoRoutes, { prefix: API_PREFIX });
  await app.register(companiesRoutes, { prefix: API_PREFIX });
  await app.register(locationsRoutes, { prefix: API_PREFIX });
  await app.register(departmentsRoutes, { prefix: API_PREFIX });
  await app.register(designationsRoutes, { prefix: API_PREFIX });
  await app.register(reportConfigRoutes, { prefix: API_PREFIX });
  await app.register(vocabularyRoutes, { prefix: API_PREFIX });
  await app.register(assetsRoutes, { prefix: API_PREFIX });
  await app.register(devicesRoutes, { prefix: API_PREFIX });
  await app.register(journalRoutes, { prefix: API_PREFIX });
  await app.register(downtimeRoutes, { prefix: API_PREFIX });
  await app.register(analyticsRoutes, { prefix: API_PREFIX });
  await app.register(reportsRoutes, { prefix: API_PREFIX });
  await app.register(shiftsRoutes, { prefix: API_PREFIX });
  await app.register(routinesRoutes, { prefix: API_PREFIX });
  await app.register(pointsRoutes, { prefix: API_PREFIX });
  await app.register(backupsRoutes, { prefix: API_PREFIX });
  // Every route refuses with a 404 unless the caller's company has the module on.
  await app.register(partCatalogueRoutes, { prefix: API_PREFIX });
  await app.register(partsRoutes, { prefix: API_PREFIX });
  await app.register(serviceRoutes, { prefix: API_PREFIX });
  // Registers nothing at all unless QUEUE_ADMIN is set — see features/queues/routes.ts.
  await app.register(queuesRoutes, { prefix: API_PREFIX });
  await app.register(tasksRoutes, { prefix: API_PREFIX });
  await app.register(attachmentsRoutes, { prefix: API_PREFIX });
  await app.register(commentsRoutes, { prefix: API_PREFIX });
  await app.register(groupsRoutes, { prefix: API_PREFIX });
  await app.register(usersRoutes, { prefix: API_PREFIX });
  await app.register(avatarsRoutes, { prefix: API_PREFIX });
  await app.register(rolesRoutes, { prefix: API_PREFIX });
  await app.register(settingsRoutes, { prefix: API_PREFIX });
  await app.register(logsRoutes, { prefix: API_PREFIX });
  await app.register(debugRoutes, { prefix: API_PREFIX });
  await app.register(auditRoutes, { prefix: API_PREFIX });
  await app.register(messagesRoutes, { prefix: API_PREFIX });

  return app;
}
