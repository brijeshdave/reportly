// Author: Brijesh Dave <https://github.com/brijeshdave>
// Background queues, as the Queues screen reads them: what each queue is, how much
// is sitting in it, and what one job looks like.
//
// The whole feature is off unless an operator switches it on (`QUEUE_ADMIN`), and
// the mode travels to the client alongside its permissions — so the screen shows
// what the server will actually accept, rather than a button that 404s.
import { z } from "zod";

/**
 * How much of the queue feature the server exposes at all.
 *
 * `off` is not "the routes answer 403" — the handlers are never registered, so
 * `/queues` is a 404 because there is nothing there. A disabled feature with a
 * live handler is a feature you are still exposed to.
 *
 * `read` mounts the GETs only. That way "somebody holding queues:manage on a
 * read-only install" is not a state anyone has to reason about: the route does
 * not exist to be called.
 */
export const QUEUE_ADMIN_MODES = ["off", "read", "manage"] as const;
export type QueueAdminMode = (typeof QUEUE_ADMIN_MODES)[number];
export const queueAdminModeSchema = z.enum(QUEUE_ADMIN_MODES);

/**
 * The BullMQ states worth showing.
 *
 * `waiting-children` and `prioritized` exist in BullMQ and are left out: nothing
 * in this app uses flows or priorities, so they would be two always-empty columns that
 * invite the question "what is that?" — add them with the first job that needs one.
 */
export const QUEUE_JOB_STATES = ["waiting", "active", "delayed", "completed", "failed"] as const;
export type QueueJobState = (typeof QUEUE_JOB_STATES)[number];
export const queueJobStateSchema = z.enum(QUEUE_JOB_STATES);

/** The states a bulk clean may touch. Never waiting or active — see the service. */
export const QUEUE_CLEANABLE_STATES = ["completed", "failed"] as const;
export type QueueCleanableState = (typeof QUEUE_CLEANABLE_STATES)[number];

export const queueCountsSchema = z.object({
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type QueueCounts = z.infer<typeof queueCountsSchema>;

export const queueSummarySchema = z.object({
  /** The BullMQ queue name, and the id every route takes. */
  id: z.string(),
  label: z.string(),
  /** What work it carries, in a sentence — the screen is read by people who did not build it. */
  description: z.string(),
  paused: z.boolean(),
  counts: queueCountsSchema,
});
export type QueueSummary = z.infer<typeof queueSummarySchema>;

/** A repeatable job registered on a queue — the "when does the backup run" answer. */
export const queueSchedulerSchema = z.object({
  key: z.string(),
  name: z.string().nullable(),
  /** A cron expression, when it has one. */
  pattern: z.string().nullable(),
  /** A fixed interval in milliseconds, when it has one instead. */
  every: z.number().int().nullable(),
  next: z.string().datetime().nullable(),
});
export type QueueScheduler = z.infer<typeof queueSchedulerSchema>;

export const queueDetailSchema = queueSummarySchema.extend({
  schedulers: z.array(queueSchedulerSchema),
});
export type QueueDetail = z.infer<typeof queueDetailSchema>;

/**
 * One job, without its payload.
 *
 * `data` is deliberately absent here and present only on the detail schema, and
 * only for a caller holding `queues:inspect`. An email job's payload is a real
 * address and a full message body, for every company on the installation — so the
 * list of a thousand jobs must not carry a thousand of them.
 */
export const queueJobSchema = z.object({
  id: z.string(),
  /** The job name within the queue — "send", "dispatch", "log-retention". */
  name: z.string(),
  state: queueJobStateSchema,
  attemptsMade: z.number().int().nonnegative(),
  /** When it was enqueued. */
  createdAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  /** When a delayed job is due to run. */
  delayedUntil: z.string().datetime().nullable(),
  /** One line, from the last failure. The stack trace is on the detail. */
  failedReason: z.string().nullable(),
  /** The request that caused it, when the producer recorded one — the trace id. */
  requestId: z.string().nullable(),
});
export type QueueJob = z.infer<typeof queueJobSchema>;

export const queueJobDetailSchema = queueJobSchema.extend({
  /**
   * The payload. Present ONLY when the caller holds `queues:inspect` — absent from
   * the response otherwise, rather than sent and hidden by the client, which is
   * how a payload ends up in a browser's network tab anyway.
   */
  data: z.unknown().optional(),
  stacktrace: z.array(z.string()),
});
export type QueueJobDetail = z.infer<typeof queueJobDetailSchema>;

export const queueJobsQuerySchema = z.object({
  state: queueJobStateSchema.default("failed"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type QueueJobsQuery = z.infer<typeof queueJobsQuerySchema>;

export const queueJobsPageSchema = z.object({
  items: z.array(queueJobSchema),
  /** How many are in that state right now — the count moves under a reader. */
  total: z.number().int().nonnegative(),
});
export type QueueJobsPage = z.infer<typeof queueJobsPageSchema>;

/**
 * A bounded bulk removal.
 *
 * Always an age and always a finished state. `drain()` and `obliterate()` are not
 * exposed anywhere: they discard waiting and active work, and answer no question
 * this does not, while being one mis-click from losing a day of mail with no
 * record of what was lost.
 */
export const queueCleanSchema = z.object({
  state: z.enum(QUEUE_CLEANABLE_STATES),
  /** Nothing younger than this is touched. */
  olderThanHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365),
  limit: z.number().int().min(1).max(10_000).default(1000),
});
export type QueueClean = z.infer<typeof queueCleanSchema>;

export const queueCleanResultSchema = z.object({ removed: z.number().int().nonnegative() });
export type QueueCleanResult = z.infer<typeof queueCleanResultSchema>;
