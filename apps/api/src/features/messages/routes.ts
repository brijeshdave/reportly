// Author: Brijesh Dave <https://github.com/brijeshdave>
// The outbound message log, read-only.
//
// Behind `logs:view` rather than `users:read`: these rows say who Reportly has
// been contacting and when, which is a different and more sensitive question than
// "who works here". There is no write path at all — not even a delete — because a
// log a person can tidy answers nothing.
import {
  PERMISSIONS,
  listQuerySchema,
  outboundMessageSchema,
  paginatedResult,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { messageScope } from "@/features/messages/repo.js";
import { getMessages } from "@/features/messages/service.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";

export async function messagesRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/messages",
    {
      preHandler: [
        app.authenticate,
        app.companyContext,
        app.requirePermission(PERMISSIONS.LOGS_VIEW),
      ],
      schema: {
        tags: ["Messages"],
        summary: "List every message Reportly sent out, and whether it arrived",
        description:
          "Email, SMS, WhatsApp, Telegram and Discord. Destinations are stored redacted, and message bodies are never stored at all — a password-reset email carries a working link, and a log of those would outlive the token.",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(outboundMessageSchema) },
      },
    },
    async (request) => {
      const ctx = request.ctx!;
      return getMessages(
        await resolveListQuery(request.query, request.authUserId),
        // Superadmins see the whole installation; everybody else sees their own
        // company's messages and the ones that belong to no company.
        messageScope(ctx.isSuperadmin ? null : ctx.companyId),
      );
    },
  );
}
