// Author: Brijesh Dave <https://github.com/brijeshdave>
// Tasks — work handed to somebody. Reading and writing are gated on tasks:*, but the
// real rules live in the service: who may be assigned (your downline), and who may
// change what (the assignee moves the state; the assigner edits the rest). Member
// holds tasks:update so they can mark their own work done, which is exactly why the
// route guard alone is never the whole answer.
import {
  ERROR_CODES,
  PERMISSIONS,
  createTaskSchema,
  listQuerySchema,
  paginatedResult,
  taskPrefillSchema,
  taskRowSchema,
  taskSchema,
  updateTaskSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { AppError } from "@/core/errors.js";
import { trackChanges } from "@/core/history.js";
import * as tasks from "@/features/tasks/service.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";

const idParams = z.object({ id: z.guid() });

export async function tasksRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  app.get(
    "/tasks",
    {
      preHandler: guard(PERMISSIONS.TASKS_READ),
      schema: {
        tags: ["Tasks"],
        summary: "Tasks assigned to you, handed out by you, or on your downline's plate",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(taskRowSchema) },
      },
    },
    async (request) =>
      tasks.listTasks(await resolveListQuery(request.query, request.authUserId), request.ctx!),
  );

  // Registered before /tasks/:id so "assigned-open" is not read as an id. The
  // manager's "To review" oversight list: open work they handed out.
  app.get(
    "/tasks/assigned-open",
    {
      preHandler: guard(PERMISSIONS.TASKS_READ),
      schema: {
        tags: ["Tasks"],
        summary: "Open tasks you assigned to others — still to be completed",
        response: { 200: z.array(taskRowSchema) },
      },
    },
    async (request) => {
      const companyId = request.ctx!.companyId;
      if (!companyId) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_ERROR,
          "Pick a company first (X-Company-Id)",
        );
      }
      return tasks.assignedOpenTasks(request.ctx!, companyId);
    },
  );

  app.post(
    "/tasks",
    {
      preHandler: guard(PERMISSIONS.TASKS_CREATE),
      schema: {
        tags: ["Tasks"],
        summary: "Assign a task to yourself or someone below you in the reporting line",
        body: createTaskSchema,
        response: { 201: taskSchema },
      },
    },
    async (request, reply) => {
      const task = await tasks.createTask(request.body, request.ctx!);
      await recordAudit(request, request.ctx!, { action: "task.create", after: task });
      reply.status(201);
      return task;
    },
  );

  app.get(
    "/tasks/:id",
    {
      preHandler: guard(PERMISSIONS.TASKS_READ),
      schema: {
        tags: ["Tasks"],
        summary: "Get a task, with the work reports filed against it",
        params: idParams,
        response: { 200: taskSchema },
      },
    },
    async (request) => tasks.getTask(request.params.id, request.ctx!),
  );

  /**
   * What the report editor opens with when the assignee completes this task. Its own
   * route so the copied text and the task link are built from the task server-side.
   */
  app.get(
    "/tasks/:id/prefill",
    {
      preHandler: guard(PERMISSIONS.TASKS_READ),
      schema: {
        tags: ["Tasks"],
        summary: "The pre-filled work report for completing this task",
        params: idParams,
        response: { 200: taskPrefillSchema },
      },
    },
    async (request) => tasks.prefillFor(request.params.id, request.ctx!),
  );

  app.patch(
    "/tasks/:id",
    {
      preHandler: guard(PERMISSIONS.TASKS_UPDATE),
      schema: {
        tags: ["Tasks"],
        summary: "Move a task along (assignee), or re-assign and edit it (assigner)",
        params: idParams,
        body: updateTaskSchema,
        response: { 200: taskSchema },
      },
    },
    async (request) => {
      const before = await tasks.getTask(request.params.id, request.ctx!);
      const after = await tasks.updateTask(request.params.id, request.body, request.ctx!);
      await recordAudit(request, request.ctx!, { action: "task.update", before, after });
      await trackChanges(request, request.ctx!, "tasks", after.id, before, after);
      return after;
    },
  );

  app.delete(
    "/tasks/:id",
    {
      preHandler: guard(PERMISSIONS.TASKS_DELETE),
      schema: {
        tags: ["Tasks"],
        summary: "Delete a task. The reports it produced survive.",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await tasks.deleteTask(request.params.id, request.ctx!);
      await recordAudit(request, request.ctx!, {
        action: "task.delete",
        details: { taskId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );
}
