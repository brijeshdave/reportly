// Author: Brijesh Dave <https://github.com/brijeshdave>
// Profile pictures. Anyone may set their own; changing somebody else's needs
// users:update, the same permission that edits the rest of their profile.
import { PERMISSIONS, avatarUploadSchema } from "@reportly/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { AppError } from "@/core/errors.js";
import { ERROR_CODES, can } from "@reportly/shared";
import * as avatars from "@/features/avatars/service.js";

const idParams = z.object({ id: z.string() });

/** Your own picture is yours; anyone else's needs the permission that edits them. */
function assertMayEdit(request: FastifyRequest, targetUserId: string): void {
  if (request.authUserId === targetUserId) return;
  if (can(request.ctx!, PERMISSIONS.USERS_UPDATE)) return;
  throw new AppError(403, ERROR_CODES.FORBIDDEN, "You may only change your own picture");
}

export async function avatarsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * The image itself. Served with a long cache and an ETag: the URL a page renders
   * carries a version stamp, so a changed picture is a different URL and an
   * unchanged one never crosses the wire twice.
   */
  app.get(
    "/users/:id/avatar",
    {
      preHandler: [app.authenticate, app.companyContext],
      schema: {
        tags: ["Users"],
        summary: "A user's profile picture (404 when they have none)",
        params: idParams,
      },
    },
    async (request, reply) => {
      const avatar = await avatars.readAvatar(request.params.id);
      if (!avatar) throw new AppError(404, ERROR_CODES.NOT_FOUND, "No picture");

      const etag = `"${avatar.updatedAt.getTime()}"`;
      if (request.headers["if-none-match"] === etag) {
        reply.status(304);
        return null;
      }

      reply
        .header("Content-Type", avatar.contentType)
        .header("ETag", etag)
        // Private: it is a picture of a person, and must not be held by a shared
        // cache between them and us.
        .header("Cache-Control", "private, max-age=86400");
      return reply.send(avatar.bytes);
    },
  );

  app.put(
    "/users/:id/avatar",
    {
      preHandler: [app.authenticate, app.companyContext],
      schema: {
        tags: ["Users"],
        summary: "Set a profile picture (PNG, JPEG or WebP; the browser resizes first)",
        params: idParams,
        body: avatarUploadSchema,
        response: { 200: z.object({ version: z.number() }) },
      },
    },
    async (request) => {
      assertMayEdit(request, request.params.id);
      const version = await avatars.setAvatar(request.params.id, request.body.data);
      await recordAudit(request, request.ctx!, {
        action: "user.avatar.set",
        details: { userId: request.params.id },
      });
      return { version };
    },
  );

  app.delete(
    "/users/:id/avatar",
    {
      preHandler: [app.authenticate, app.companyContext],
      schema: {
        tags: ["Users"],
        summary: "Remove a profile picture",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      assertMayEdit(request, request.params.id);
      await avatars.removeAvatar(request.params.id);
      await recordAudit(request, request.ctx!, {
        action: "user.avatar.remove",
        details: { userId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );
}
