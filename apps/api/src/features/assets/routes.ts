// Author: Brijesh Dave <https://github.com/brijeshdave>
// Asset types (global vocabulary) and the per-company asset tree. Reading is open to
// anyone who files a report (so they can pick scope); maintaining is manager-and-up.
// Permission-gated and audited; Zod schemas validate + document.
import {
  ERROR_CODES,
  PERMISSIONS,
  assetNodeSchema,
  assetTypeRowSchema,
  createAssetSchema,
  createAssetTypeSchema,
  updateAssetSchema,
  updateAssetTypeSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { AppError } from "@/core/errors.js";
import * as assets from "@/features/assets/service.js";
import { buildExport, buildTemplate, parseCsv, parseXlsx } from "@/features/assets/import-parse.js";
import {
  buildExport as buildTypeExport,
  buildTemplate as buildTypeTemplate,
  parseCsv as parseTypeCsv,
  parseXlsx as parseTypeXlsx,
} from "@/features/assets/asset-type-import.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const idParams = z.object({ id: z.guid() });
const optionSchema = z.object({ id: z.guid(), name: z.string() });

function activeCompany(companyId: string | null): string {
  if (!companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  return companyId;
}

export async function assetsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  /* ---------------------------- asset types ------------------------------- */

  // Active types, for the type picker when building the tree. Before /:id.
  app.get(
    "/asset-types/options",
    {
      preHandler: guard(PERMISSIONS.ASSETS_READ),
      schema: {
        tags: ["Assets"],
        summary: "Active asset types, for the picker when building the tree",
        response: { 200: z.array(optionSchema) },
      },
    },
    async () => assets.typeOptions(),
  );

  app.get(
    "/asset-types",
    {
      preHandler: guard(PERMISSIONS.ASSETS_READ),
      schema: {
        tags: ["Assets"],
        summary: "List asset types with how many assets use each",
        response: { 200: z.array(assetTypeRowSchema) },
      },
    },
    async () => assets.listAssetTypes(),
  );

  app.post(
    "/asset-types",
    {
      preHandler: guard(PERMISSIONS.ASSETS_CREATE),
      schema: {
        tags: ["Assets"],
        summary: "Create an asset type",
        body: createAssetTypeSchema,
        response: { 201: assetTypeRowSchema },
      },
    },
    async (request, reply) => {
      const type = await assets.createAssetType(request.body);
      await recordAudit(request, request.ctx!, { action: "asset-type.create", after: type });
      reply.status(201);
      return type;
    },
  );

  // --- asset-type bulk export / import (static paths, before /:id) ---

  app.get(
    "/asset-types/export",
    {
      preHandler: guard(PERMISSIONS.ASSETS_READ),
      schema: { tags: ["Assets"], summary: "Export the asset-type vocabulary as an .xlsx" },
    },
    async (_request, reply) => {
      const buffer = await buildTypeExport(await assets.exportAssetTypes());
      reply
        .header("content-type", XLSX_MIME)
        .header("content-disposition", `attachment; filename="asset-types.xlsx"`)
        .header("content-length", String(buffer.length))
        .header("cache-control", "no-store");
      return reply.send(buffer);
    },
  );

  app.get(
    "/asset-types/import/template",
    {
      preHandler: guard(PERMISSIONS.ASSET_TYPES_IMPORT),
      schema: { tags: ["Assets"], summary: "Download the asset-type import template (.xlsx)" },
    },
    async (_request, reply) => {
      const buffer = await buildTypeTemplate();
      reply
        .header("content-type", XLSX_MIME)
        .header("content-disposition", `attachment; filename="asset-type-import-template.xlsx"`)
        .header("content-length", String(buffer.length))
        .header("cache-control", "no-store");
      return reply.send(buffer);
    },
  );

  app.post(
    "/asset-types/import",
    {
      preHandler: guard(PERMISSIONS.ASSET_TYPES_IMPORT),
      schema: {
        tags: ["Assets"],
        summary: "Create or update asset types in bulk from an .xlsx or .csv upload",
        description:
          "Types are matched by name; an existing type has its order/status updated and a new name is " +
          "created. All or nothing: if any row is wrong nothing is written, and every problem is returned " +
          "with its line number.",
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
      const part = await request.file();
      if (!part)
        throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Attach a .xlsx or .csv file");

      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch {
        throw new AppError(413, ERROR_CODES.VALIDATION_ERROR, "That file is too large");
      }

      const name = (part.filename ?? "").toLowerCase();
      const parsed = name.endsWith(".csv")
        ? parseTypeCsv(buffer.toString("utf8"))
        : await parseTypeXlsx(buffer);
      const outcome = await assets.importAssetTypes(parsed);
      if (outcome.created > 0 || outcome.updated > 0) {
        await recordAudit(request, request.ctx!, {
          action: "asset-type.import",
          after: { created: outcome.created, updated: outcome.updated },
        });
      }
      return outcome;
    },
  );

  app.patch(
    "/asset-types/:id",
    {
      preHandler: guard(PERMISSIONS.ASSETS_UPDATE),
      schema: {
        tags: ["Assets"],
        summary: "Rename an asset type, reorder it, or retire it",
        params: idParams,
        body: updateAssetTypeSchema,
        response: { 200: assetTypeRowSchema },
      },
    },
    async (request) => {
      const after = await assets.updateAssetType(request.params.id, request.body);
      await recordAudit(request, request.ctx!, { action: "asset-type.update", after });
      return after;
    },
  );

  app.delete(
    "/asset-types/:id",
    {
      preHandler: guard(PERMISSIONS.ASSETS_DELETE),
      schema: {
        tags: ["Assets"],
        summary: "Delete an asset type. Refused with 409 while assets use it — deactivate instead.",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await assets.deleteAssetType(request.params.id);
      await recordAudit(request, request.ctx!, {
        action: "asset-type.delete",
        details: { assetTypeId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );

  /* ------------------------------- assets --------------------------------- */

  app.get(
    "/assets",
    {
      preHandler: guard(PERMISSIONS.ASSETS_READ),
      schema: {
        tags: ["Assets"],
        summary: "List the active company's assets (flat; assemble the tree by parentId)",
        response: { 200: z.array(assetNodeSchema) },
      },
    },
    async (request) => assets.listAssets(activeCompany(request.ctx!.companyId), request.ctx!),
  );

  app.post(
    "/assets",
    {
      preHandler: guard(PERMISSIONS.ASSETS_CREATE),
      schema: {
        tags: ["Assets"],
        summary: "Create an asset in the active company",
        body: createAssetSchema,
        response: { 201: assetNodeSchema },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const asset = await assets.createAsset(companyId, request.body, request.ctx!);
      await recordAudit(request, request.ctx!, { action: "asset.create", after: asset });
      reply.status(201);
      return asset;
    },
  );

  // --- bulk export / import (before /assets/:id so the static paths win) ---

  app.get(
    "/assets/export",
    {
      preHandler: guard(PERMISSIONS.ASSETS_READ),
      schema: {
        tags: ["Assets"],
        summary: "Export the asset tree as an .xlsx (one row per asset, by path)",
      },
    },
    async (request, reply) => {
      const rows = await assets.exportAssets(activeCompany(request.ctx!.companyId), request.ctx!);
      const buffer = await buildExport(rows);
      reply
        .header("content-type", XLSX_MIME)
        .header("content-disposition", `attachment; filename="assets.xlsx"`)
        .header("content-length", String(buffer.length))
        .header("cache-control", "no-store");
      return reply.send(buffer);
    },
  );

  app.get(
    "/assets/import/template",
    {
      preHandler: guard(PERMISSIONS.ASSETS_IMPORT),
      schema: { tags: ["Assets"], summary: "Download the asset import template (.xlsx)" },
    },
    async (_request, reply) => {
      const buffer = await buildTemplate();
      reply
        .header("content-type", XLSX_MIME)
        .header("content-disposition", `attachment; filename="asset-import-template.xlsx"`)
        .header("content-length", String(buffer.length))
        .header("cache-control", "no-store");
      return reply.send(buffer);
    },
  );

  app.post(
    "/assets/import",
    {
      preHandler: guard(PERMISSIONS.ASSETS_IMPORT),
      schema: {
        tags: ["Assets"],
        summary: "Build or update the asset tree in bulk from an .xlsx or .csv upload",
        description:
          "Each row is a full path from the root; missing ancestors are created and an existing path has " +
          "its type/site/status updated. All or nothing: if any row is wrong nothing is written, and every " +
          "problem is returned with its line number.",
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
      const part = await request.file();
      if (!part)
        throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Attach a .xlsx or .csv file");

      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch {
        throw new AppError(413, ERROR_CODES.VALIDATION_ERROR, "That file is too large");
      }

      const name = (part.filename ?? "").toLowerCase();
      const parsed = name.endsWith(".csv")
        ? parseCsv(buffer.toString("utf8"))
        : await parseXlsx(buffer);
      const outcome = await assets.importAssets(companyId, parsed, request.ctx!);
      if (outcome.created > 0 || outcome.updated > 0) {
        await recordAudit(request, request.ctx!, {
          action: "asset.import",
          after: { created: outcome.created, updated: outcome.updated },
        });
      }
      return outcome;
    },
  );

  app.get(
    "/assets/:id",
    {
      preHandler: guard(PERMISSIONS.ASSETS_READ),
      schema: {
        tags: ["Assets"],
        summary: "Get an asset",
        params: idParams,
        response: { 200: assetNodeSchema },
      },
    },
    async (request) =>
      assets.getAsset(request.params.id, activeCompany(request.ctx!.companyId), request.ctx!),
  );

  app.patch(
    "/assets/:id",
    {
      preHandler: guard(PERMISSIONS.ASSETS_UPDATE),
      schema: {
        tags: ["Assets"],
        summary: "Rename, re-parent, retype or retire an asset",
        params: idParams,
        body: updateAssetSchema,
        response: { 200: assetNodeSchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const after = await assets.updateAsset(
        request.params.id,
        companyId,
        request.body,
        request.ctx!,
      );
      await recordAudit(request, request.ctx!, { action: "asset.update", after });
      return after;
    },
  );

  app.delete(
    "/assets/:id",
    {
      preHandler: guard(PERMISSIONS.ASSETS_DELETE),
      schema: {
        tags: ["Assets"],
        summary: "Delete an asset. Refused with 409 while it is in use — deactivate instead.",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      await assets.deleteAsset(request.params.id, companyId, request.ctx!);
      await recordAudit(request, request.ctx!, {
        action: "asset.delete",
        details: { assetId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );
}
