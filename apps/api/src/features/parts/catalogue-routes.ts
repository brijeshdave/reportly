// Author: Brijesh Dave <https://github.com/brijeshdave>
// The module's catalogues over HTTP: service kinds, consumables, part models,
// what each fits and what each pays.
//
// Every route asks two questions in order — does this company use the module at
// all, and may this caller do this. The first is `requireModule`, which answers
// 404 rather than 403: telling somebody "you may not" implies the feature is
// there and they need a grant, which sends them to their administrator asking for
// the wrong thing.
import {
  PERMISSIONS,
  consumableSchema,
  createConsumableSchema,
  createPartModelSchema,
  createServiceKindSchema,
  partModelSchema,
  serviceKindSchema,
  serviceRateSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import * as catalogue from "@/features/parts/catalogue-service.js";
import { requireModule } from "@/features/parts/module.js";

const idParams = z.object({ id: z.guid() });
const activeOnlyQuery = z.object({ activeOnly: z.coerce.boolean().optional() });
const statusPatch = { status: z.enum(["active", "inactive"]).optional() };

export async function partCatalogueRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  /* ---------------------------- service kinds ---------------------------- */

  app.get(
    "/part-service-kinds",
    {
      preHandler: guard(PERMISSIONS.PARTS_READ),
      schema: {
        tags: ["Cartridges"],
        summary: "What can be done to a part",
        querystring: activeOnlyQuery,
        response: { 200: z.array(serviceKindSchema) },
      },
    },
    async (request) =>
      catalogue.listServiceKinds(
        await requireModule(request.ctx!.companyId),
        request.query.activeOnly ?? false,
      ),
  );

  app.post(
    "/part-service-kinds",
    {
      preHandler: guard(PERMISSIONS.PARTS_CONFIGURE),
      schema: {
        tags: ["Cartridges"],
        summary: "Add a service kind",
        body: createServiceKindSchema,
        response: { 201: serviceKindSchema },
      },
    },
    async (request, reply) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const kind = await catalogue.createServiceKind(companyId, request.body);
      await recordAudit(request, request.ctx!, {
        action: "part-service-kind.create",
        details: { id: kind.id, name: kind.name },
      });
      reply.status(201);
      return kind;
    },
  );

  app.patch(
    "/part-service-kinds/:id",
    {
      preHandler: guard(PERMISSIONS.PARTS_CONFIGURE),
      schema: {
        tags: ["Cartridges"],
        summary: "Edit or retire a service kind",
        description:
          "Retiring sets `inactive`; it is never deleted. A kind that scored work has to " +
          "survive, or the history it scored stops meaning anything.",
        params: idParams,
        body: createServiceKindSchema.partial().extend(statusPatch),
        response: { 200: serviceKindSchema },
      },
    },
    async (request) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const kind = await catalogue.updateServiceKind(request.params.id, companyId, request.body);
      await recordAudit(request, request.ctx!, {
        action: "part-service-kind.update",
        details: { id: kind.id },
      });
      return kind;
    },
  );

  /* ------------------------------ consumables ---------------------------- */

  app.get(
    "/consumables",
    {
      preHandler: guard(PERMISSIONS.PARTS_READ),
      schema: {
        tags: ["Cartridges"],
        summary: "What gets used up servicing a part",
        description:
          "A catalogue of names and units. This module holds no stock levels, balances or " +
          "prices, and nothing here should be read as knowing what is in the store.",
        querystring: activeOnlyQuery,
        response: { 200: z.array(consumableSchema) },
      },
    },
    async (request) =>
      catalogue.listConsumables(
        await requireModule(request.ctx!.companyId),
        request.query.activeOnly ?? false,
      ),
  );

  app.post(
    "/consumables",
    {
      preHandler: guard(PERMISSIONS.PARTS_CONFIGURE),
      schema: {
        tags: ["Cartridges"],
        summary: "Add a consumable",
        body: createConsumableSchema,
        response: { 201: consumableSchema },
      },
    },
    async (request, reply) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const item = await catalogue.createConsumable(companyId, request.body);
      await recordAudit(request, request.ctx!, {
        action: "consumable.create",
        details: { id: item.id, name: item.name },
      });
      reply.status(201);
      return item;
    },
  );

  app.patch(
    "/consumables/:id",
    {
      preHandler: guard(PERMISSIONS.PARTS_CONFIGURE),
      schema: {
        tags: ["Cartridges"],
        summary: "Edit or retire a consumable",
        params: idParams,
        body: createConsumableSchema.partial().extend(statusPatch),
        response: { 200: consumableSchema },
      },
    },
    async (request) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const item = await catalogue.updateConsumable(request.params.id, companyId, request.body);
      await recordAudit(request, request.ctx!, {
        action: "consumable.update",
        details: { id: item.id },
      });
      return item;
    },
  );

  /* ------------------------------ part models ---------------------------- */

  app.get(
    "/part-models",
    {
      preHandler: guard(PERMISSIONS.PARTS_READ),
      schema: {
        tags: ["Cartridges"],
        summary: "The kinds of part, with what each one fits",
        querystring: activeOnlyQuery,
        response: { 200: z.array(partModelSchema) },
      },
    },
    async (request) =>
      catalogue.listPartModels(
        await requireModule(request.ctx!.companyId),
        request.query.activeOnly ?? false,
      ),
  );

  app.get(
    "/part-models/:id",
    {
      preHandler: guard(PERMISSIONS.PARTS_READ),
      schema: {
        tags: ["Cartridges"],
        summary: "One part model",
        params: idParams,
        response: { 200: partModelSchema },
      },
    },
    async (request) =>
      catalogue.getPartModel(request.params.id, await requireModule(request.ctx!.companyId)),
  );

  app.post(
    "/part-models",
    {
      preHandler: guard(PERMISSIONS.PARTS_CONFIGURE),
      schema: {
        tags: ["Cartridges"],
        summary: "Add a part model",
        description:
          "`compatibleDeviceTypeIds` is what it fits. A deploy to any other kind of device " +
          "is refused, so a model with an empty list can be registered but never installed.",
        body: createPartModelSchema,
        response: { 201: partModelSchema },
      },
    },
    async (request, reply) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const model = await catalogue.createPartModel(companyId, request.body);
      await recordAudit(request, request.ctx!, {
        action: "part-model.create",
        details: { id: model.id, name: model.name },
      });
      reply.status(201);
      return model;
    },
  );

  app.patch(
    "/part-models/:id",
    {
      preHandler: guard(PERMISSIONS.PARTS_CONFIGURE),
      schema: {
        tags: ["Cartridges"],
        summary: "Edit or retire a part model",
        params: idParams,
        body: createPartModelSchema.partial().extend(statusPatch),
        response: { 200: partModelSchema },
      },
    },
    async (request) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const model = await catalogue.updatePartModel(request.params.id, companyId, request.body);
      await recordAudit(request, request.ctx!, {
        action: "part-model.update",
        details: { id: model.id },
      });
      return model;
    },
  );

  /* --------------------------------- rates -------------------------------- */

  app.get(
    "/part-models/:id/rates",
    {
      preHandler: guard(PERMISSIONS.PARTS_READ),
      schema: {
        tags: ["Cartridges"],
        summary: "What this model pays per service kind",
        description: "Only the overrides. A kind that is absent pays the kind's own default.",
        params: idParams,
        response: { 200: z.array(serviceRateSchema) },
      },
    },
    async (request) =>
      catalogue.getRates(request.params.id, await requireModule(request.ctx!.companyId)),
  );

  app.put(
    "/part-models/:id/rates",
    {
      preHandler: guard(PERMISSIONS.PARTS_CONFIGURE),
      schema: {
        tags: ["Cartridges"],
        summary: "Set what this model pays",
        params: idParams,
        body: z.object({ rates: z.array(serviceRateSchema).max(50) }),
        response: { 200: z.array(serviceRateSchema) },
      },
    },
    async (request) => {
      const companyId = await requireModule(request.ctx!.companyId);
      const rates = await catalogue.setRates(request.params.id, companyId, request.body.rates);
      await recordAudit(request, request.ctx!, {
        action: "part-model.rates",
        details: { id: request.params.id, count: rates.length },
      });
      return rates;
    },
  );
}
