// Author: Brijesh Dave <https://github.com/brijeshdave>
// Contact-channel verification, for the caller's own account only. There is no
// admin route to mark someone else's channel verified: the point of verification
// is that the person holds the address, and an administrator saying so proves
// nothing. Audited, because proving a channel changes who can be reached.
import {
  channelCodeSentSchema,
  channelStatusSchema,
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
}
