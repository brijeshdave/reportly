// Author: Brijesh Dave <https://github.com/brijeshdave>
// The caller's own inbox and preferences.
//
// No permission anywhere in this file, deliberately. Every row served is the
// caller's own by construction — the queries take `ctx.userId`, not an id from
// the path — so a permission would be one every user had to hold, which decides
// nothing and only creates a way to lock somebody out of their own bell.
//
// The system-wide configuration is NOT here. It is two entries in the settings
// registry, so it is written through the settings API under `settings:manage`,
// like every other setting in the app.
import {
  ERROR_CODES,
  markNotificationsReadSchema,
  notificationPreferencesSchema,
  notificationSchema,
  unreadCountSchema,
  updateNotificationPreferencesSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { AppError } from "@/core/errors.js";
import * as service from "@/features/notifications/inbox-service.js";

export async function notificationRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const session = [app.authenticate, app.companyContext];

  app.get(
    "/me/notifications",
    {
      preHandler: session,
      schema: {
        tags: ["Me"],
        summary: "The caller's notifications for the active company, newest first",
        querystring: z.object({
          unreadOnly: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: z.object({ items: z.array(notificationSchema), total: z.number().int() }),
        },
      },
    },
    async (request) => {
      const ctx = request.ctx!;
      return service.inbox(ctx.userId, ctx.companyId, request.query);
    },
  );

  // Its own endpoint, and deliberately not part of the list: every client polls
  // this on a timer, and making them fetch twenty rows to render one number would
  // be the most-called query in the app doing the most work.
  app.get(
    "/me/notifications/unread-count",
    {
      preHandler: session,
      schema: {
        tags: ["Me"],
        summary: "How many unread notifications the bell should show",
        response: { 200: unreadCountSchema },
      },
    },
    async (request) => {
      const ctx = request.ctx!;
      return service.unread(ctx.userId, ctx.companyId);
    },
  );

  app.post(
    "/me/notifications/read",
    {
      preHandler: session,
      schema: {
        tags: ["Me"],
        summary: "Mark notifications read — specific ids, or all of them",
        body: markNotificationsReadSchema,
        response: { 200: z.object({ marked: z.number().int() }) },
      },
    },
    async (request) => {
      const ctx = request.ctx!;
      const marked = await service.markRead(ctx.userId, ctx.companyId, request.body.ids);
      return { marked };
    },
  );

  app.post(
    "/me/notifications/:id/archive",
    {
      preHandler: session,
      schema: {
        tags: ["Me"],
        summary: "Remove one notification from the caller's list",
        params: z.object({ id: z.guid() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const ctx = request.ctx!;
      const done = await service.archive(ctx.userId, ctx.companyId, request.params.id);
      // A 404 rather than a silent success: the id was not theirs, or does not
      // exist, and the two are the same answer to a caller who should know neither.
      if (!done) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Notification not found");
      reply.status(204);
      return null;
    },
  );

  app.get(
    "/me/notification-preferences",
    {
      preHandler: session,
      schema: {
        tags: ["Me"],
        summary: "What the caller receives, per type and channel, and why a cell is closed",
        description:
          "`allowed` is what the administrator permits; `deliverable` is whether the channel can " +
          "reach this person. Both are returned because they are different sentences on screen — " +
          "'your administrator turned this off' and 'verify your mobile first' — and a screen that " +
          "cannot tell them apart tells the reader to fix the wrong thing.",
        response: { 200: notificationPreferencesSchema },
      },
    },
    async (request) => service.preferences(request.ctx!.userId),
  );

  app.put(
    "/me/notification-preferences",
    {
      preHandler: session,
      schema: {
        tags: ["Me"],
        summary: "Set the caller's own notification preferences",
        description:
          "Only cells that differ from the current default are stored. Setting a cell back to its " +
          "default clears the override, so it follows the administrator again if they change it.",
        body: updateNotificationPreferencesSchema,
        response: { 200: notificationPreferencesSchema },
      },
    },
    async (request) => service.savePreferences(request.ctx!.userId, request.body.preferences),
  );
}
