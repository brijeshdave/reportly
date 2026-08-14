// Author: Brijesh Dave <https://github.com/brijeshdave>
// Debug-mode API. Reading your own status needs only a session; switching debug on
// (system-wide or for yourself) is permission-gated because it raises log volume.
// Enabling always sets an expiry, so debug can never be left on forever.
import { PERMISSIONS, debugModeSchema } from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import {
  DEBUG_DEFAULT_MINUTES,
  DEBUG_MAX_MINUTES,
  debugStatus,
  disableSystemDebug,
  disableUserDebug,
  enableSystemDebug,
  enableUserDebug,
} from "@/core/debug/service.js";

const scopeBody = z.object({
  scope: z.enum(["system", "user"]).default("user"),
  minutes: z.number().int().min(1).max(DEBUG_MAX_MINUTES).default(DEBUG_DEFAULT_MINUTES),
});

const statusResponse = z.object({
  system: debugModeSchema,
  user: debugModeSchema.nullable(),
  active: z.boolean(),
});

export async function debugRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const toggleGuard = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.DEBUG_TOGGLE),
  ];

  app.get(
    "/debug",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Debug"],
        summary: "Your effective debug status (system + your own switch)",
        response: { 200: statusResponse },
      },
    },
    async (request) => debugStatus(request.authUserId!),
  );

  app.post(
    "/debug/enable",
    {
      preHandler: toggleGuard,
      schema: {
        tags: ["Debug"],
        summary: "Enable debug mode for a bounded window",
        body: scopeBody,
        response: { 200: statusResponse },
      },
    },
    async (request) => {
      const userId = request.authUserId!;
      const { scope, minutes } = request.body;
      if (scope === "system") await enableSystemDebug(minutes);
      else await enableUserDebug(userId, minutes);
      await recordAudit(request, request.ctx!, {
        action: "debug.enable",
        details: { scope, minutes },
      });
      return debugStatus(userId);
    },
  );

  app.post(
    "/debug/disable",
    {
      preHandler: toggleGuard,
      schema: {
        tags: ["Debug"],
        summary: "Disable debug mode",
        body: z.object({ scope: z.enum(["system", "user"]).default("user") }),
        response: { 200: statusResponse },
      },
    },
    async (request) => {
      const userId = request.authUserId!;
      const { scope } = request.body;
      if (scope === "system") await disableSystemDebug();
      else await disableUserDebug(userId);
      await recordAudit(request, request.ctx!, { action: "debug.disable", details: { scope } });
      return debugStatus(userId);
    },
  );
}
