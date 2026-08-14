// Author: Brijesh Dave <https://github.com/brijeshdave>
// Attachments: upload, download, delete. Multipart in, bytes out.
//
// The upload route is the one place in the API that does not take a Zod body: the
// payload is a file, not JSON. Its schema still documents the shape for OpenAPI, and
// every value that matters (size, type, count) is checked in the service against the
// configured limits — never trusted from the part headers alone.
import {
  ERROR_CODES,
  PERMISSIONS,
  UPLOAD_LIMITS,
  attachmentSchema,
  uploadLimitsSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { AppError } from "@/core/errors.js";
import { getSystemSetting } from "@/core/settings/service.js";
import * as attachments from "@/features/attachments/service.js";

const idParams = z.object({ id: z.guid() });

/**
 * A filename from a browser is display text, not a path. Keep the leaf, drop the
 * control characters (they belong in no filename and wreck a header), and cap the
 * length. It never reaches the filesystem — the storage key is server-generated —
 * so this is about what is safe to store and echo back, not about traversal.
 */
function safeFilename(raw: string): string {
  const leaf = raw.split(/[/\\]/).pop() ?? "file";
  // eslint-disable-next-line no-control-regex
  return leaf.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "file";
}

export async function attachmentsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  /**
   * The limits an upload must satisfy, so the form can say them before somebody
   * spends four minutes uploading a file that was never going to be accepted.
   *
   * Its own endpoint rather than reading them out of `GET /settings`: that needs
   * `settings:read` and hands back every setting in the system to answer a question
   * about file sizes. This follows `/password-rules` — the rules a form needs are
   * not the settings administration surface.
   */
  app.get(
    "/upload-limits",
    {
      preHandler: [app.authenticate, app.companyContext],
      schema: {
        tags: ["Attachments"],
        summary: "The size, count and type limits an attachment must satisfy",
        response: { 200: uploadLimitsSchema },
      },
    },
    async () => getSystemSetting(UPLOAD_LIMITS),
  );

  /**
   * The list+upload pair for one kind of owner.
   *
   * Registered once per kind rather than behind a `/:ownerType/:ownerId/attachments`
   * catch-all: a wildcard at the root of the API is a route that quietly competes
   * with every other one. A factory rather than two copies, so the multipart
   * handling and the audit shape cannot drift between reports and tasks.
   */
  const registerOwner = (
    ownerType: "report" | "task" | "routine-completion",
    path: string,
    noun: string,
  ) => {
    app.get(
      `/${path}/:id/attachments`,
      {
        preHandler: guard(PERMISSIONS.ATTACHMENTS_READ),
        schema: {
          tags: ["Attachments"],
          summary: `The files on a ${noun}`,
          params: idParams,
          response: { 200: z.array(attachmentSchema) },
        },
      },
      async (request) =>
        attachments.listAttachments(ownerType, (request.params as { id: string }).id, request.ctx!),
    );

    app.post(
      `/${path}/:id/attachments`,
      {
        preHandler: guard(PERMISSIONS.ATTACHMENTS_WRITE),
        schema: {
          tags: ["Attachments"],
          summary: `Attach a file to a ${noun} (multipart/form-data, field name \`file\`)`,
          params: idParams,
          consumes: ["multipart/form-data"],
          response: { 201: attachmentSchema },
        },
      },
      async (request, reply) => {
        const part = await request.file();
        if (!part) {
          throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "No file in the request");
        }

        // toBuffer() throws once the part exceeds the configured multipart limit, so
        // an oversized upload is refused while it streams rather than after the whole
        // thing has been read into memory.
        let body: Buffer;
        try {
          body = await part.toBuffer();
        } catch {
          throw new AppError(
            413,
            ERROR_CODES.VALIDATION_ERROR,
            "That file is larger than this server accepts",
          );
        }

        const attachment = await attachments.upload(
          {
            ownerType,
            ownerId: (request.params as { id: string }).id,
            filename: safeFilename(part.filename),
            contentType: part.mimetype,
            body,
          },
          request.ctx!,
        );

        await recordAudit(request, request.ctx!, {
          action: "attachment.create",
          // The bytes are not audit material; what was attached to what is.
          details: {
            attachmentId: attachment.id,
            ownerType: attachment.ownerType,
            ownerId: attachment.ownerId,
            filename: attachment.filename,
            size: attachment.size,
          },
        });
        reply.status(201);
        return attachment;
      },
    );
  };

  // The journal domain lives at /journal; the owner type stays "report" because
  // that is the column value, not the URL.
  registerOwner("report", "journal", "journal entry");
  registerOwner("task", "tasks", "task");
  registerOwner("routine-completion", "routine-completions", "routine completion");

  app.get(
    "/attachments/:id",
    {
      preHandler: guard(PERMISSIONS.ATTACHMENTS_READ),
      schema: {
        tags: ["Attachments"],
        summary: "Download a file",
        params: idParams,
      },
    },
    async (request, reply) => {
      const { attachment, body } = await attachments.download(request.params.id, request.ctx!);

      // attachment;filename — never inline. An HTML or SVG file served inline from
      // our own origin would run its script with the session cookie right there.
      reply
        .header("content-type", attachment.contentType)
        .header(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        )
        .header("content-length", String(attachment.size))
        // The bytes never change under an id, but they are somebody's photo.
        .header("cache-control", "private, max-age=31536000, immutable")
        .header("x-content-type-options", "nosniff");
      return reply.send(body);
    },
  );

  app.delete(
    "/attachments/:id",
    {
      preHandler: guard(PERMISSIONS.ATTACHMENTS_WRITE),
      schema: {
        tags: ["Attachments"],
        summary: "Delete a file",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await attachments.remove(request.params.id, request.ctx!);
      await recordAudit(request, request.ctx!, {
        action: "attachment.delete",
        details: { attachmentId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );
}
