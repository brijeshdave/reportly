// Author: Brijesh Dave <https://github.com/brijeshdave>
// Parts over HTTP: the register, and the four moves a part can make.
//
// Registering and scrapping sit behind `parts:manage`; installing and booking
// back in behind `parts:deploy`. They are genuinely different authorities — the
// person at the printer is not usually the person who decides a cartridge is
// finished.
import {
  PERMISSIONS,
  createPartSchema,
  deployPartSchema,
  listQuerySchema,
  paginatedResult,
  partEventSchema,
  partSchema,
  placementSchema,
  returnPartSchema,
  returnedPartSchema,
  updatePartSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";
import { requireModule } from "@/features/parts/module.js";
import * as parts from "@/features/parts/parts-service.js";

const idParams = z.object({ id: z.guid() });

export async function partsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  app.get(
    "/parts",
    {
      preHandler: guard(PERMISSIONS.PARTS_READ),
      schema: {
        tags: ["Cartridges"],
        summary: "Search the parts register of the active company",
        description:
          "Paged, sorted and filtered by the server like every other register. Filter on " +
          "`status` for the workshop queue, on `partModelId` for one kind of cartridge.",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(partSchema) },
      },
    },
    async (request) =>
      parts.listParts(
        await requireModule(request.ctx!.companyId),
        await resolveListQuery(request.query, request.authUserId),
      ),
  );

  app.get(
    "/parts/:id",
    {
      preHandler: guard(PERMISSIONS.PARTS_READ),
      schema: {
        tags: ["Cartridges"],
        summary: "One part, with where it is now",
        params: idParams,
        response: { 200: partSchema },
      },
    },
    async (request) =>
      parts.getPart(request.params.id, await requireModule(request.ctx!.companyId)),
  );

  app.get(
    "/parts/:id/history",
    {
      preHandler: guard(PERMISSIONS.PARTS_READ),
      schema: {
        tags: ["Cartridges"],
        summary: "Every printer this part has been in, newest first",
        description:
          "The part itself says where it is now. This says where it has been — which is what " +
          "answers how long a refill lasted, and which printer keeps eating cartridges.",
        params: idParams,
        response: { 200: z.array(placementSchema) },
      },
    },
    async (request) =>
      parts.partHistory(request.params.id, await requireModule(request.ctx!.companyId)),
  );

  app.get(
    "/parts/:id/timeline",
    {
      preHandler: guard(PERMISSIONS.PARTS_READ),
      schema: {
        tags: ["Cartridges"],
        summary: "Everything that has happened to this part, newest first",
        description:
          "Installs, returns and services in one sequence. Merged from the placements and " +
          "the service events rather than stored as a third log — those are the facts, and " +
          "a timeline is a way of reading them. A placement yields two entries, since it " +
          "went in and came out weeks apart.",
        params: idParams,
        response: { 200: z.array(partEventSchema) },
      },
    },
    async (request) =>
      parts.partTimeline(request.params.id, await requireModule(request.ctx!.companyId)),
  );

  app.get(
    "/parts/:id/fitting-devices",
    {
      preHandler: guard(PERMISSIONS.PARTS_DEPLOY),
      schema: {
        tags: ["Cartridges"],
        summary: "The devices this part's model fits",
        description:
          "What the install picker offers. The same rule the deploy refuses on, asked before " +
          "the choice instead of after it — offering a machine that will certainly be rejected " +
          "is worse than a short list. Empty means the model fits no device type yet, which is " +
          "fixed on the model rather than here.",
        params: idParams,
        response: {
          200: z.array(
            z.object({ id: z.guid(), name: z.string(), typeName: z.string().nullable() }),
          ),
        },
      },
    },
    async (request) =>
      parts.fittingDevices(request.params.id, await requireModule(request.ctx!.companyId)),
  );

  app.post(
    "/parts",
    {
      preHandler: guard(PERMISSIONS.PARTS_MANAGE),
      schema: {
        tags: ["Cartridges"],
        summary: "Register a part",
        description: "It starts in stock. `identifier` is the label your team writes on it.",
        body: createPartSchema,
        response: { 201: partSchema },
      },
    },
    async (request, reply) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const part = await parts.createPart(companyId, request.body);
      await recordAudit(request, request.ctx!, {
        action: "part.create",
        details: { id: part.id, identifier: part.identifier },
      });
      reply.status(201);
      return part;
    },
  );

  app.patch(
    "/parts/:id",
    {
      preHandler: guard(PERMISSIONS.PARTS_MANAGE),
      schema: {
        tags: ["Cartridges"],
        summary: "Correct a part's details",
        params: idParams,
        body: updatePartSchema,
        response: { 200: partSchema },
      },
    },
    async (request) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const part = await parts.updatePart(request.params.id, companyId, request.body);
      await recordAudit(request, request.ctx!, { action: "part.update", details: { id: part.id } });
      return part;
    },
  );

  app.post(
    "/parts/:id/deploy",
    {
      preHandler: guard(PERMISSIONS.PARTS_DEPLOY),
      schema: {
        tags: ["Cartridges"],
        summary: "Install a part on a device",
        description:
          "Refused unless the part is in stock and its model lists that device's type as " +
          "compatible. A part that does not fit will not work in the machine whatever the " +
          "record says.\n\n`meterStart` is the machine's own page counter as it reads now — " +
          "half of a page count, and recorded here because this is the only moment somebody " +
          "is standing in front of it with the part in their hand.",
        params: idParams,
        body: deployPartSchema,
        response: { 200: partSchema },
      },
    },
    async (request) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const part = await parts.deployPart(
        request.params.id,
        companyId,
        request.ctx!.userId,
        request.body,
      );
      await recordAudit(request, request.ctx!, {
        action: "part.deploy",
        details: { id: part.id, deviceId: request.body.deviceId },
      });
      return part;
    },
  );

  app.post(
    "/parts/:id/return",
    {
      preHandler: guard(PERMISSIONS.PARTS_DEPLOY),
      schema: {
        tags: ["Cartridges"],
        summary: "Take a part off a device and book it into the workshop",
        description:
          "`outcome: faulty` is a decision, not a note: it is what reverses the points for " +
          "the service that preceded it when the part failed inside the company's window." +
          "\n\n`meterEnd` closes the pair started at install; `pagesPrinted` says the same " +
          "thing directly for a machine with no counter. Both optional, and a meter that " +
          "reads lower than it did at install is treated as a reset rather than as negative " +
          "pages.",
        params: idParams,
        body: returnPartSchema,
        response: { 200: returnedPartSchema },
      },
    },
    async (request) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const { part, reversal } = await parts.returnPart(
        request.params.id,
        companyId,
        request.ctx!.userId,
        request.body,
      );
      await recordAudit(request, request.ctx!, {
        action: "part.return",
        details: { id: part.id, outcome: request.body.outcome, pointsReversed: reversal.reversed },
      });
      return { ...part, pointsReversed: reversal.reversed };
    },
  );

  app.post(
    "/parts/:id/restock",
    {
      preHandler: guard(PERMISSIONS.PARTS_DEPLOY),
      schema: {
        tags: ["Cartridges"],
        summary: "Put a part back on the shelf without servicing it",
        description:
          "For one that came off working — a printer retired, a wrong fit spotted early. " +
          "Forcing a service event to move it would put points in the ledger for work nobody did.",
        params: idParams,
        body: z.object({ locationId: z.guid().nullable().optional() }),
        response: { 200: partSchema },
      },
    },
    async (request) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const part = await parts.restockPart(request.params.id, companyId, request.body.locationId);
      await recordAudit(request, request.ctx!, {
        action: "part.restock",
        details: { id: part.id },
      });
      return part;
    },
  );

  app.post(
    "/parts/:id/scrap",
    {
      preHandler: guard(PERMISSIONS.PARTS_MANAGE),
      schema: {
        tags: ["Cartridges"],
        summary: "Retire a part for good",
        description:
          "Refused while it is installed: a part inside a machine is still inside it, and " +
          "scrapping it would leave the device holding one the register says is gone.",
        params: idParams,
        response: { 200: partSchema },
      },
    },
    async (request) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const part = await parts.scrapPart(request.params.id, companyId);
      await recordAudit(request, request.ctx!, { action: "part.scrap", details: { id: part.id } });
      return part;
    },
  );
}
