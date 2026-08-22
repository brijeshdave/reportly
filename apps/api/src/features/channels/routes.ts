// Author: Brijesh Dave <https://github.com/brijeshdave>
// Contact-channel verification, for the caller's own account only. There is no
// admin route to mark someone else's channel verified: the point of verification
// is that the person holds the address, and an administrator saying so proves
// nothing. Audited, because proving a channel changes who can be reached.
import {
  PERMISSIONS,
  channelCodeSentSchema,
  channelStatusSchema,
  channelTestResultSchema,
  channelTestSchema,
  confirmChannelCodeSchema,
  requestChannelCodeSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import * as channels from "@/features/channels/service.js";

export async function channelsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/me/channels",
    {
      preHandler: [app.authenticate, app.companyContext],
      schema: {
        tags: ["Me"],
        summary: "Your contact channels: where each points, and whether it is verified",
        response: { 200: z.array(channelStatusSchema) },
      },
    },
    async (request) => channels.listChannels(request.authUserId!),
  );

  app.post(
    "/me/channels/verify/request",
    {
      preHandler: [app.authenticate, app.companyContext],
      schema: {
        tags: ["Me"],
        summary: "Send a one-time code to one of your channels",
        body: requestChannelCodeSchema,
        response: { 200: channelCodeSentSchema },
      },
    },
    async (request) => {
      const sent = await channels.requestCode(request.authUserId!, request.body.channel);
      // The code itself is never audited — it is a credential while it lives.
      await recordAudit(request, request.ctx!, {
        action: "channel.verify.request",
        details: { channel: request.body.channel },
      });
      return sent;
    },
  );

  app.post(
    "/me/channels/verify/confirm",
    {
      preHandler: [app.authenticate, app.companyContext],
      schema: {
        tags: ["Me"],
        summary: "Confirm a channel with the code sent to it",
        body: confirmChannelCodeSchema,
        response: { 200: z.array(channelStatusSchema) },
      },
    },
    async (request) => {
      const statuses = await channels.confirmCode(
        request.authUserId!,
        request.body.channel,
        request.body.code,
      );
      await recordAudit(request, request.ctx!, {
        action: "channel.verify.confirm",
        details: { channel: request.body.channel },
      });
      return statuses;
    },
  );

  /**
   * Prove a channel actually works, by sending one message through it now.
   *
   * `settings:manage`, not a self-service permission: this can be pointed at an
   * arbitrary address, so it is a way to send mail from the installation's own
   * server and belongs with whoever configures it.
   *
   * Answers 200 with `delivered: false` and the provider's words when it is
   * refused — that is a successful test with a negative result, not a failed
   * request, and turning it into a 502 would hide the very text somebody needs.
   */
  app.post(
    "/channels/test",
    {
      preHandler: [
        app.authenticate,
        app.companyContext,
        app.requirePermission(PERMISSIONS.SETTINGS_MANAGE),
      ],
      schema: {
        tags: ["Settings"],
        summary: "Send a test message over one channel and report what the provider said",
        description:
          "Not queued: a queued send would answer 'accepted for delivery', which is the useless half of the answer. A connection test is not a delivery test — a provider can accept the connection and refuse every message afterwards.",
        body: channelTestSchema,
        response: { 200: channelTestResultSchema },
      },
    },
    async (request) => {
      const result = await channels.testChannel(
        request.authUserId!,
        request.body.channel,
        request.body.destination,
      );
      await recordAudit(request, request.ctx!, {
        action: "channel.test",
        details: {
          channel: request.body.channel,
          destination: result.destination,
          delivered: result.delivered,
        },
      });
      return result;
    },
  );
}
