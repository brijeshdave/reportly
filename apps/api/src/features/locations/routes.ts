// Author: Brijesh Dave <https://github.com/brijeshdave>
// Locations CRUD, scoped to the active company (X-Company-Id -> ctx.companyId).
// Permission-gated and audited; Zod schemas provide validation + OpenAPI docs.
import {
  ERROR_CODES,
  PERMISSIONS,
  locationSchema,
  nameSchema,
  updateLocationSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { trackChanges } from "@/core/history.js";
import { AppError } from "@/core/errors.js";
import { parseUpload, sendXlsx } from "@/core/spreadsheet/http.js";
import * as locations from "@/features/locations/service.js";
import {
  buildExport,
  buildTemplate,
  parseCsv,
  parseXlsx,
} from "@/features/locations/import-parse.js";

const idParams = z.object({ id: z.guid() });
const createBody = z.object({ name: nameSchema });
/** A group that references a location. Enough for the UI to name and link it. */
const referenceSchema = z.object({ id: z.guid(), name: z.string() });

function activeCompany(companyId: string | null): string {
  if (!companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "X-Company-Id header is required");
  }
  return companyId;
}

export async function locationsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  app.get(
    "/locations",
    {
      preHandler: guard(PERMISSIONS.LOCATIONS_READ),
      schema: {
        tags: ["Locations"],
        summary: "List locations in the active company",
        response: { 200: z.array(locationSchema) },
      },
    },
    async (request) => locations.listLocations(activeCompany(request.ctx!.companyId), request.ctx!),
  );

  app.post(
    "/locations",
    {
      preHandler: guard(PERMISSIONS.LOCATIONS_CREATE),
      schema: {
        tags: ["Locations"],
        summary: "Create a location in the active company",
        body: createBody,
        response: { 201: locationSchema },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const location = await locations.createLocation(companyId, request.body.name);
      await recordAudit(request, request.ctx!, {
        action: "location.create",
        after: location,
      });
      reply.status(201);
      return location;
    },
  );

  // --- bulk export / import (static paths, before /:id) ---

  app.get(
    "/locations/export",
    {
      preHandler: guard(PERMISSIONS.LOCATIONS_READ),
      schema: { tags: ["Locations"], summary: "Export the company's sites as an .xlsx" },
    },
    async (request, reply) => {
      const rows = await locations.exportLocations(
        activeCompany(request.ctx!.companyId),
        request.ctx!,
      );
      return sendXlsx(reply, await buildExport(rows), "locations.xlsx");
    },
  );

  app.get(
    "/locations/import/template",
    {
      preHandler: guard(PERMISSIONS.LOCATIONS_IMPORT),
      schema: { tags: ["Locations"], summary: "Download the location import template (.xlsx)" },
    },
    async (_request, reply) =>
      sendXlsx(reply, await buildTemplate(), "location-import-template.xlsx"),
  );

  app.post(
    "/locations/import",
    {
      preHandler: guard(PERMISSIONS.LOCATIONS_IMPORT),
      schema: {
        tags: ["Locations"],
        summary: "Create or update sites in bulk from an .xlsx or .csv upload",
        description:
          "Sites are matched by name; an existing site has its status updated and a new name is created. " +
          "All or nothing: if any row is wrong nothing is written, and every problem is returned with its " +
          "line number.",
        response: {
          200: z.object({
            created: z.number().int(),
            updated: z.number().int(),
            problems: z.array(z.object({ line: z.number().int(), message: z.string() })),
          }),
        },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const parsed = await parseUpload(request, parseCsv, parseXlsx);
      const outcome = await locations.importLocations(companyId, parsed);
      if (outcome.created > 0 || outcome.updated > 0) {
        await recordAudit(request, request.ctx!, {
          action: "location.import",
          after: { created: outcome.created, updated: outcome.updated },
        });
      }
      return outcome;
    },
  );

  app.patch(
    "/locations/:id",
    {
      preHandler: guard(PERMISSIONS.LOCATIONS_UPDATE),
      schema: {
        tags: ["Locations"],
        summary: "Rename a location",
        params: idParams,
        body: updateLocationSchema,
        response: { 200: locationSchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const current = await locations.listLocations(companyId, request.ctx!);
      const before = current.find((l) => l.id === request.params.id);
      const updated = await locations.updateLocation(
        request.params.id,
        companyId,
        request.body.name ?? before?.name ?? "",
        request.ctx!,
      );
      await recordAudit(request, request.ctx!, {
        action: "location.update",
        before,
        after: updated,
      });
      await trackChanges(request, request.ctx!, "locations", updated.id, before, updated);
      return updated;
    },
  );

  // Deactivating is the reversible alternative to deleting: it keeps every group
  // scope that names this location.
  for (const [action, status] of [
    ["deactivate", "inactive"],
    ["reactivate", "active"],
  ] as const) {
    app.post(
      `/locations/:id/${action}`,
      {
        preHandler: guard(PERMISSIONS.LOCATIONS_UPDATE),
        schema: {
          tags: ["Locations"],
          summary: `${action[0]!.toUpperCase()}${action.slice(1)} a location`,
          params: idParams,
          response: { 200: locationSchema },
        },
      },
      async (request) => {
        const companyId = activeCompany(request.ctx!.companyId);
        const before = await locations.getLocation(request.params.id, companyId, request.ctx!);
        const location = await locations.setStatus(
          request.params.id,
          companyId,
          status,
          request.ctx!,
        );
        await recordAudit(request, request.ctx!, {
          action: `location.${action}`,
          before,
          after: location,
        });
        await trackChanges(request, request.ctx!, "locations", location.id, before, location);
        return location;
      },
    );
  }

  app.get(
    "/locations/:id/references",
    {
      preHandler: guard(PERMISSIONS.LOCATIONS_READ),
      schema: {
        tags: ["Locations"],
        summary: "Groups whose scope names this location (what a delete would drop)",
        params: idParams,
        response: { 200: z.object({ groups: z.array(referenceSchema) }) },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      return {
        groups: await locations.locationReferences(request.params.id, companyId, request.ctx!),
      };
    },
  );

  app.delete(
    "/locations/:id",
    {
      preHandler: guard(PERMISSIONS.LOCATIONS_DELETE),
      schema: {
        tags: ["Locations"],
        summary:
          "Delete a location. Refused with 409 while a group is scoped to it, unless cascade=true.",
        params: idParams,
        querystring: z.object({
          // Detaching a location from a group changes who can see what, so it is
          // never implicit.
          cascade: z.coerce.boolean().default(false),
        }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const { detachedFrom } = await locations.deleteLocation(
        request.params.id,
        companyId,
        request.ctx!,
        request.query.cascade,
      );
      await recordAudit(request, request.ctx!, {
        action: "location.delete",
        details: { locationId: request.params.id, detachedFrom },
      });
      reply.status(204);
      return null;
    },
  );
}
