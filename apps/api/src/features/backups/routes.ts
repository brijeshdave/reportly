// Author: Brijesh Dave <https://github.com/brijeshdave>
// Backup endpoints, behind `backups:manage`: list, take one now, download, delete. The
// per-kind schedule and retention are ordinary settings (Settings → Backups). Restore is
// separate (restore-routes.ts) and superadmin-guarded.
import { ERROR_CODES, PERMISSIONS, backupKindSchema, backupSchema } from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { AppError } from "@/core/errors.js";
import * as backups from "@/features/backups/service.js";
import { restoreFromBackup, restoreFromUpload } from "@/features/backups/restore.js";

const confirmBody = z.object({ confirm: z.literal("RESTORE") });

export async function backupsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.BACKUPS_MANAGE),
  ];

  app.get(
    "/backups",
    {
      preHandler: guard,
      schema: {
        tags: ["Backups"],
        summary: "List backups (database and files), newest first",
        response: { 200: z.array(backupSchema) },
      },
    },
    async () => backups.listBackups(),
  );

  app.post(
    "/backups",
    {
      preHandler: guard,
      schema: {
        tags: ["Backups"],
        summary: "Take a backup now",
        querystring: z.object({ kind: backupKindSchema }),
        response: { 200: backupSchema },
      },
    },
    async (request) => {
      const backup = await backups.runBackup(request.query.kind, request.ctx!.userId);
      await recordAudit(request, request.ctx!, {
        action: "backup.create",
        details: { kind: request.query.kind, status: backup.status },
      });
      return backup;
    },
  );

  app.get(
    "/backups/:id/log",
    {
      preHandler: guard,
      schema: {
        tags: ["Backups"],
        summary: "What one backup attempt said — its captured output",
        description:
          "Plain text: when it ran, what was run, how it ended, and the tool's own output, " +
          "redacted of anything credential-shaped. Kept on the attempt rather than in the log " +
          "database, which is switchable and pruned.",
        params: z.object({ id: z.guid() }),
      },
    },
    async (request, reply) => {
      const { body, filename } = await backups.backupLog(request.params.id);
      reply
        .header("content-type", "text/plain; charset=utf-8")
        .header("content-disposition", `attachment; filename="${filename}"`)
        .header("cache-control", "no-store");
      return reply.send(body);
    },
  );

  app.get(
    "/backups/:id/download",
    {
      preHandler: guard,
      schema: {
        tags: ["Backups"],
        summary: "Download a backup's artifact",
        params: z.object({ id: z.guid() }),
      },
    },
    async (request, reply) => {
      const { body, filename } = await backups.downloadBackup(request.params.id);
      reply
        .header("content-type", "application/octet-stream")
        .header("content-disposition", `attachment; filename="${filename}"`)
        .header("content-length", String(body.length))
        .header("cache-control", "no-store");
      return reply.send(body);
    },
  );

  app.delete(
    "/backups/:id",
    {
      preHandler: guard,
      schema: {
        tags: ["Backups"],
        summary: "Delete a backup",
        params: z.object({ id: z.guid() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await backups.deleteBackup(request.params.id);
      await recordAudit(request, request.ctx!, {
        action: "backup.delete",
        details: { backupId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );

  // --- restore (destructive, superadmin-only, typed confirmation) ---

  app.post(
    "/backups/:id/restore",
    {
      preHandler: guard,
      schema: {
        tags: ["Backups"],
        summary: "Restore a stored backup — replaces current data (superadmin, confirmed)",
        params: z.object({ id: z.guid() }),
        body: confirmBody,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      await restoreFromBackup(request.params.id, request.ctx!);
      await recordAudit(request, request.ctx!, {
        action: "backup.restore",
        details: { backupId: request.params.id, from: "stored" },
      });
      return { ok: true as const };
    },
  );

  app.post(
    "/backups/restore/upload",
    {
      preHandler: guard,
      schema: {
        tags: ["Backups"],
        summary:
          "Restore from an uploaded backup file — replaces current data (superadmin, confirmed)",
        querystring: z.object({ kind: backupKindSchema, confirm: z.literal("RESTORE") }),
      },
    },
    async (request) => {
      const part = await request.file();
      if (!part) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Attach a backup file");
      const buffer = await part.toBuffer();
      await restoreFromUpload(request.query.kind, buffer, request.ctx!);
      await recordAudit(request, request.ctx!, {
        action: "backup.restore",
        details: { kind: request.query.kind, from: "upload" },
      });
      return { ok: true as const };
    },
  );
}
