// Author: Brijesh Dave <https://github.com/brijeshdave>
// The queue endpoints — mounted according to `QUEUE_ADMIN`, guarded by permission.
//
// The env decides what EXISTS; the permission decides who may call it. With
// `QUEUE_ADMIN=off` this plugin registers nothing at all, so every path here is a
// 404 rather than a 403 — a disabled feature with a live handler is a feature you
// are still exposed to. With `read`, the mutating routes are not registered, so
// "somebody holding queues:manage on a read-only install" is not a state that can
// exist to be reasoned about.
//
// Audit rows never carry a job's data. They are readable by anyone with
// `audit:view`, so writing a payload into one would route straight around
// `queues:inspect` — the kind of leak that surfaces months later in an export.
import {
  PERMISSIONS,
  can,
  queueCleanResultSchema,
  queueCleanSchema,
  queueDetailSchema,
  queueJobDetailSchema,
  queueJobsPageSchema,
  queueJobsQuerySchema,
  queueSummarySchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { env } from "@/core/env.js";
import * as queues from "@/features/queues/service.js";

const queueParams = z.object({ id: z.string().min(1) });
const jobParams = z.object({ id: z.string().min(1), jobId: z.string().min(1) });

export async function queuesRoutes(fastify: FastifyInstance): Promise<void> {
  // Nothing is mounted at all. This is the switch doing its job.
  if (env.QUEUE_ADMIN === "off") return;

  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const viewGuard = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.QUEUES_VIEW),
  ];
  const manageGuard = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.QUEUES_MANAGE),
  ];

  app.get(
    "/queues",
    {
      preHandler: viewGuard,
      schema: {
        tags: ["Queues"],
        summary: "Every background queue with its counts",
        description:
          "Available only when the server runs with QUEUE_ADMIN set to `read` or `manage`; " +
          "otherwise these routes are not mounted and every path here is a 404.",
        response: { 200: z.array(queueSummarySchema) },
      },
    },
    async () => queues.listQueues(),
  );

  app.get(
    "/queues/:id",
    {
      preHandler: viewGuard,
      schema: {
        tags: ["Queues"],
        summary: "One queue: counts, whether it is paused, and its repeatable schedules",
        params: queueParams,
        response: { 200: queueDetailSchema },
      },
    },
    async (request) => queues.getQueue(request.params.id),
  );

  app.get(
    "/queues/:id/jobs",
    {
      preHandler: viewGuard,
      schema: {
        tags: ["Queues"],
        summary: "A page of jobs in one state, newest first",
        params: queueParams,
        querystring: queueJobsQuerySchema,
        response: { 200: queueJobsPageSchema },
      },
    },
    async (request) => queues.listJobs(request.params.id, request.query),
  );

  app.get(
    "/queues/:id/jobs/:jobId",
    {
      preHandler: viewGuard,
      schema: {
        tags: ["Queues"],
        summary: "One job, with its stack trace",
        description:
          "`data` — the job's payload — is included ONLY for a caller holding `queues:inspect`. " +
          "It is omitted from the response entirely otherwise, not sent and hidden by the client.",
        params: jobParams,
        response: { 200: queueJobDetailSchema },
      },
    },
    async (request) =>
      queues.getJob(
        request.params.id,
        request.params.jobId,
        can(request.ctx!, PERMISSIONS.QUEUES_INSPECT),
      ),
  );

  // Everything below is a mutation. On a `read` install they are never
  // registered, so there is no handler to reach.
  if (env.QUEUE_ADMIN !== "manage") return;

  app.post(
    "/queues/:id/jobs/:jobId/retry",
    {
      preHandler: manageGuard,
      schema: {
        tags: ["Queues"],
        summary: "Put a failed job back in the queue",
        params: jobParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await queues.retryJob(request.params.id, request.params.jobId);
      await recordAudit(request, request.ctx!, {
        action: "queue.job.retry",
        details: { queue: request.params.id, jobId: request.params.jobId },
      });
      reply.status(204);
      return null;
    },
  );

  app.post(
    "/queues/:id/jobs/:jobId/promote",
    {
      preHandler: manageGuard,
      schema: {
        tags: ["Queues"],
        summary: "Run a delayed job now rather than at its scheduled time",
        params: jobParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await queues.promoteJob(request.params.id, request.params.jobId);
      await recordAudit(request, request.ctx!, {
        action: "queue.job.promote",
        details: { queue: request.params.id, jobId: request.params.jobId },
      });
      reply.status(204);
      return null;
    },
  );

  app.delete(
    "/queues/:id/jobs/:jobId",
    {
      preHandler: manageGuard,
      schema: {
        tags: ["Queues"],
        summary: "Remove one job. Refused while it is running.",
        params: jobParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await queues.removeJob(request.params.id, request.params.jobId);
      await recordAudit(request, request.ctx!, {
        action: "queue.job.remove",
        details: { queue: request.params.id, jobId: request.params.jobId },
      });
      reply.status(204);
      return null;
    },
  );

  app.post(
    "/queues/:id/pause",
    {
      preHandler: manageGuard,
      schema: {
        tags: ["Queues"],
        summary: "Stop a queue taking new work",
        description:
          "Pausing `email` stops every password reset and invitation until it is resumed. " +
          "Jobs already enqueued are kept, not discarded.",
        params: queueParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await queues.setPaused(request.params.id, true);
      await recordAudit(request, request.ctx!, {
        action: "queue.pause",
        details: { queue: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );

  app.post(
    "/queues/:id/resume",
    {
      preHandler: manageGuard,
      schema: {
        tags: ["Queues"],
        summary: "Let a paused queue take work again",
        params: queueParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await queues.setPaused(request.params.id, false);
      await recordAudit(request, request.ctx!, {
        action: "queue.resume",
        details: { queue: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );

  app.post(
    "/queues/:id/clean",
    {
      preHandler: manageGuard,
      schema: {
        tags: ["Queues"],
        summary: "Bulk-remove completed or failed jobs older than an age",
        description:
          "Finished states only, and always with an age. There is no drain or obliterate " +
          "endpoint: both discard waiting or active work with no record of what was lost.",
        params: queueParams,
        body: queueCleanSchema,
        response: { 200: queueCleanResultSchema },
      },
    },
    async (request) => {
      const removed = await queues.cleanQueue(request.params.id, request.body);
      await recordAudit(request, request.ctx!, {
        action: "queue.clean",
        details: {
          queue: request.params.id,
          state: request.body.state,
          olderThanHours: request.body.olderThanHours,
          removed,
        },
      });
      return { removed };
    },
  );
}
