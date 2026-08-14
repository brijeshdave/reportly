// Author: Brijesh Dave <https://github.com/brijeshdave>
// Services over HTTP: what was done to a part, and what it consumed doing it.
//
// One permission, `parts:service`, and it is separate from `parts:deploy` for a
// reason that is not tidiness: this is the route that writes to the shared point
// ledger. Whoever holds it can credit themselves.
import { PERMISSIONS, recordServiceSchema, serviceEventSchema } from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { requireModule } from "@/features/parts/module.js";
import * as services from "@/features/parts/service-service.js";

const idParams = z.object({ id: z.guid() });

export async function serviceRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/parts/:id/services",
    {
      preHandler: [
        app.authenticate,
        app.companyContext,
        app.requirePermission(PERMISSIONS.PARTS_READ),
      ],
      schema: {
        tags: ["Cartridges"],
        summary: "What has been done to this part, newest first",
        description:
          "Each entry carries what it consumed and what it paid. A reversed entry keeps " +
          "both, with `pointsReversedAt` set — the history of a part that came straight " +
          "back is the thing worth reading, so nothing is removed.",
        params: idParams,
        response: { 200: z.array(serviceEventSchema) },
      },
    },
    async (request) =>
      services.serviceHistory(request.params.id, await requireModule(request.ctx!.companyId)),
  );

  app.post(
    "/parts/:id/services",
    {
      preHandler: [
        app.authenticate,
        app.companyContext,
        app.requirePermission(PERMISSIONS.PARTS_SERVICE),
      ],
      schema: {
        tags: ["Cartridges"],
        summary: "Record a refill or a repair",
        description:
          "Only on a part in the workshop, and it comes out in stock with one more cycle " +
          "on it. What it pays is resolved from the model and the kind rather than sent " +
          "by the caller, so the screen and the ledger cannot disagree.",
        params: idParams,
        body: recordServiceSchema,
        response: { 201: serviceEventSchema },
      },
    },
    async (request, reply) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const event = await services.recordService(
        request.params.id,
        companyId,
        request.ctx!.userId,
        request.body,
      );
      await recordAudit(request, request.ctx!, {
        action: "part.service",
        details: { id: event.id, partId: request.params.id, points: event.points },
      });
      reply.status(201);
      return event;
    },
  );
}
