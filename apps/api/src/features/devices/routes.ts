// Author: Brijesh Dave <https://github.com/brijeshdave>
// Devices — the flat, searchable registry. Reading is open to anyone who files a
// report (they pick devices as scope); maintaining is manager-and-up. Permission-
// gated and audited; Zod schemas validate + document.
import {
  ERROR_CODES,
  PERMISSIONS,
  createDeviceSchema,
  deviceSchema,
  listQuerySchema,
  paginatedResult,
  updateDeviceSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { trackChanges } from "@/core/history.js";
import { AppError } from "@/core/errors.js";
import { sendXlsx } from "@/core/spreadsheet/http.js";
import * as devices from "@/features/devices/service.js";
import {
  buildExport,
  buildTemplate,
  parseCsv,
  parseXlsx,
} from "@/features/devices/import-parse.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";

const idParams = z.object({ id: z.guid() });

function activeCompany(companyId: string | null): string {
  if (!companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  return companyId;
}

export async function devicesRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  app.get(
    "/devices",
    {
      preHandler: guard(PERMISSIONS.DEVICES_READ),
      schema: {
        tags: ["Devices"],
        summary: "Search the device registry of the active company",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(deviceSchema) },
      },
    },
    async (request) =>
      devices.listDevices(
        activeCompany(request.ctx!.companyId),
        await resolveListQuery(request.query, request.authUserId),
        request.ctx!,
      ),
  );

  app.post(
    "/devices",
    {
      preHandler: guard(PERMISSIONS.DEVICES_CREATE),
      schema: {
        tags: ["Devices"],
        summary: "Register a device in the active company",
        body: createDeviceSchema,
        response: { 201: deviceSchema },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const device = await devices.createDevice(companyId, request.body, request.ctx!);
      await recordAudit(request, request.ctx!, { action: "device.create", after: device });
      reply.status(201);
      return device;
    },
  );

  app.get(
    "/devices/:id",
    {
      preHandler: guard(PERMISSIONS.DEVICES_READ),
      schema: {
        tags: ["Devices"],
        summary: "Get a device",
        params: idParams,
        response: { 200: deviceSchema },
      },
    },
    async (request) =>
      devices.getDevice(request.params.id, activeCompany(request.ctx!.companyId), request.ctx!),
  );

  app.patch(
    "/devices/:id",
    {
      preHandler: guard(PERMISSIONS.DEVICES_UPDATE),
      schema: {
        tags: ["Devices"],
        summary: "Update a device — rename, re-tag, move it to an asset/department, or retire it",
        params: idParams,
        body: updateDeviceSchema,
        response: { 200: deviceSchema },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const before = await devices.getDevice(request.params.id, companyId, request.ctx!);
      const after = await devices.updateDevice(
        request.params.id,
        companyId,
        request.body,
        request.ctx!,
      );
      await recordAudit(request, request.ctx!, { action: "device.update", before, after });
      await trackChanges(request, request.ctx!, "devices", after.id, before, after);
      return after;
    },
  );

  app.delete(
    "/devices/:id",
    {
      preHandler: guard(PERMISSIONS.DEVICES_DELETE),
      schema: {
        tags: ["Devices"],
        summary: "Delete a device. Refused with 409 while it is referenced — deactivate instead.",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      await devices.deleteDevice(request.params.id, companyId, request.ctx!);
      await recordAudit(request, request.ctx!, {
        action: "device.delete",
        details: { deviceId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );

  // --- bulk export / import ---

  app.get(
    "/devices/export",
    {
      preHandler: guard(PERMISSIONS.DEVICES_READ),
      schema: {
        tags: ["Devices"],
        summary: "Export the device register as an .xlsx (the same columns the import reads)",
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const rows = await devices.exportDevices(companyId, request.ctx!);
      return sendXlsx(reply, await buildExport(rows), "devices.xlsx");
    },
  );

  // The template first: an empty file with the header row and one example, so the
  // expected shape is obvious without reading documentation.
  app.get(
    "/devices/import/template",
    {
      preHandler: guard(PERMISSIONS.DEVICES_IMPORT),
      schema: {
        tags: ["Devices"],
        summary: "Download the device import template (.xlsx)",
      },
    },
    async (_request, reply) => {
      const buffer = await buildTemplate();
      reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", `attachment; filename="device-import-template.xlsx"`)
        .header("content-length", String(buffer.length))
        .header("cache-control", "no-store");
      return reply.send(buffer);
    },
  );

  app.post(
    "/devices/import",
    {
      preHandler: guard(PERMISSIONS.DEVICES_IMPORT),
      schema: {
        tags: ["Devices"],
        summary: "Create devices in bulk from an .xlsx or .csv upload",
        description:
          "Every device goes into the chosen department (`departmentId`), and each row's type is " +
          "matched within that department. All or nothing: if any row is wrong nothing is written, and " +
          "every problem is returned with its line number so the file can be fixed and sent again.",
        // A device type belongs to a department, so the import is scoped to one; omit
        // for devices that belong to no department (their type column must be empty).
        querystring: z.object({ departmentId: z.guid().optional() }),
        response: {
          200: z.object({
            created: z.number().int(),
            problems: z.array(z.object({ line: z.number().int(), message: z.string() })),
          }),
        },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const part = await request.file();
      if (!part) {
        throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Attach a .xlsx or .csv file");
      }

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

      const outcome = await devices.importDevices(
        companyId,
        request.query.departmentId ?? null,
        parsed,
        request.ctx!,
      );

      // Always 200 with the outcome: a rejected file is a normal, expected result the
      // caller must read and act on (the counts and per-line problems are the point),
      // not a transport error. Only a written import is worth an audit entry.
      if (outcome.created > 0) {
        await recordAudit(request, request.ctx!, {
          action: "device.import",
          after: { created: outcome.created },
        });
      }
      return outcome;
    },
  );
}
