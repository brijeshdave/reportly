// Author: Brijesh Dave <https://github.com/brijeshdave>
// Comments on reports and tasks.
//
// There is **no comments permission**. Taking part is decided by whether the
// caller can open the record at all, which the service delegates to the report's
// or task's own visibility rule. A separate `comments:read` would be a second
// answer to a question already answered, and the two would eventually disagree.
//
// The route guard is therefore the read permission of the owning resource: you
// already need `reports:read` to be looking at a report.
import {
  PERMISSIONS,
  commentSchema,
  createCommentSchema,
  updateCommentSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import * as comments from "@/features/comments/service.js";

const idParams = z.object({ id: z.guid() });

export async function commentsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  // One pair of routes per owner rather than a polymorphic `/comments/:type/:id`:
  // the URL then says what it is about, the guard is the owning resource's own
  // permission, and the OpenAPI spec groups them where a reader expects them.
  for (const owner of [
    {
      type: "report" as const,
      path: "journal",
      permission: PERMISSIONS.JOURNAL_READ,
      tag: "Journal",
    },
    { type: "task" as const, path: "tasks", permission: PERMISSIONS.TASKS_READ, tag: "Tasks" },
  ]) {
    app.get(
      `/${owner.path}/:id/comments`,
      {
        preHandler: guard(owner.permission),
        schema: {
          tags: [owner.tag],
          summary: `The conversation on a ${owner.type}`,
          description:
            "Anyone who can open the record can read and post. Each comment carries whether " +
            "*this* caller may edit or delete it, so the UI never offers an action the API refuses.",
          params: idParams,
          response: { 200: z.array(commentSchema) },
        },
      },
      async (request) => comments.listComments(owner.type, request.params.id, request.ctx!),
    );

    app.post(
      `/${owner.path}/:id/comments`,
      {
        preHandler: guard(owner.permission),
        schema: {
          tags: [owner.tag],
          summary: `Add a comment to a ${owner.type}`,
          params: idParams,
          body: createCommentSchema,
          response: { 201: commentSchema },
        },
      },
      async (request, reply) => {
        const comment = await comments.addComment(
          owner.type,
          request.params.id,
          request.body,
          request.ctx!,
        );
        reply.status(201);
        return comment;
      },
    );
  }

  // Editing and deleting are keyed on the comment itself, so they need no owner in
  // the path — the service resolves the record and re-checks visibility.
  app.patch(
    "/comments/:id",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Reports"],
        summary: "Edit your own comment",
        params: idParams,
        body: updateCommentSchema,
        response: { 200: commentSchema },
      },
    },
    async (request) => comments.editComment(request.params.id, request.body.body, request.ctx!),
  );

  app.delete(
    "/comments/:id",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Reports"],
        summary: "Delete your own comment (a superadmin may remove any)",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await comments.removeComment(request.params.id, request.ctx!);
      // Audited because removing somebody else's words is a moderation act, and
      // the comment itself is gone afterwards.
      await recordAudit(request, request.ctx!, {
        action: "comment.delete",
        details: { commentId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );
}
