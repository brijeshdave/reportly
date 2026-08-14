// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reading and acting on the background queues.
//
// This module talks to BullMQ and the registry and to nothing else in the app.
// That is the whole basis of `QUEUE_ADMIN` being a safe switch: a queues service
// that reached into the journal or the users service could not honestly be called
// removable. `core/queue/tests/registry.test.ts` enforces it by reading imports.
//
// Retrying a job means handing it back to BullMQ. It never re-runs a handler
// here — a second code path that "does what the worker does" is a copy that
// drifts, and the worker is the thing that has been in production.
import {
  ERROR_CODES,
  type QueueCleanableState,
  type QueueCounts,
  type QueueDetail,
  type QueueJob,
  type QueueJobDetail,
  type QueueJobState,
  type QueueJobsPage,
  type QueueScheduler,
  type QueueSummary,
} from "@reportly/shared";
import type { Job, Queue } from "bullmq";

import { AppError } from "@/core/errors.js";
import { QUEUE_REGISTRY, findQueue, type QueueEntry } from "@/core/queue/registry.js";

/** A queue id that is not in the registry is a 404, never an empty page. */
function requireQueue(id: string): QueueEntry {
  const entry = findQueue(id);
  if (!entry) throw new AppError(404, ERROR_CODES.NOT_FOUND, `Unknown queue "${id}"`);
  return entry;
}

const iso = (value: number | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

async function countsOf(queue: Queue): Promise<QueueCounts> {
  const raw = await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed");
  return {
    waiting: raw.waiting ?? 0,
    active: raw.active ?? 0,
    delayed: raw.delayed ?? 0,
    completed: raw.completed ?? 0,
    failed: raw.failed ?? 0,
  };
}

async function summarize(entry: QueueEntry): Promise<QueueSummary> {
  const queue = entry.get();
  const [counts, paused] = await Promise.all([countsOf(queue), queue.isPaused()]);
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    paused,
    counts,
  };
}

/**
 * Every queue, with its counts.
 *
 * One failing queue must not blank the page: if Redis drops a connection midway,
 * the caller still needs to see the four that answered. A queue that could not be
 * read reports zeros and is not silently omitted — an absent row reads as "this
 * queue does not exist", which is a different and wrong statement.
 */
export async function listQueues(): Promise<QueueSummary[]> {
  return Promise.all(
    QUEUE_REGISTRY.map(async (entry) => {
      try {
        return await summarize(entry);
      } catch {
        return {
          id: entry.id,
          label: entry.label,
          description: entry.description,
          paused: false,
          counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 },
        } satisfies QueueSummary;
      }
    }),
  );
}

/** One queue, plus the repeatable schedules registered on it. */
export async function getQueue(id: string): Promise<QueueDetail> {
  const entry = requireQueue(id);
  const queue = entry.get();
  const [summary, schedulers] = await Promise.all([summarize(entry), queue.getJobSchedulers()]);

  return {
    ...summary,
    schedulers: schedulers.map((scheduler): QueueScheduler => ({
      key: scheduler.key,
      name: scheduler.name ?? null,
      pattern: scheduler.pattern ?? null,
      every: scheduler.every ? Number(scheduler.every) : null,
      next: iso(scheduler.next),
    })),
  };
}

/**
 * The request id the producers stamp on their payloads.
 *
 * Read defensively: this is the ONE field taken out of a job's data without
 * `queues:inspect`, because it is the trace id rather than content — it is what
 * lets somebody follow a failed email back to the request that caused it. Anything
 * that is not a string is ignored rather than coerced.
 */
function requestIdOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const value = (data as { requestId?: unknown }).requestId;
  return typeof value === "string" ? value : null;
}

function toJob(job: Job, state: QueueJobState): QueueJob {
  return {
    id: String(job.id),
    name: job.name,
    state,
    attemptsMade: job.attemptsMade,
    createdAt: new Date(job.timestamp).toISOString(),
    processedAt: iso(job.processedOn),
    finishedAt: iso(job.finishedOn),
    delayedUntil: job.delay ? new Date(job.timestamp + job.delay).toISOString() : null,
    failedReason: job.failedReason ?? null,
    requestId: requestIdOf(job.data),
  };
}

export async function listJobs(
  id: string,
  options: { state: QueueJobState; limit: number; offset: number },
): Promise<QueueJobsPage> {
  const queue = requireQueue(id).get();
  const [jobs, counts] = await Promise.all([
    // BullMQ's range is inclusive at both ends.
    queue.getJobs([options.state], options.offset, options.offset + options.limit - 1),
    countsOf(queue),
  ]);
  return {
    items: jobs.filter(Boolean).map((job) => toJob(job, options.state)),
    total: counts[options.state],
  };
}

/**
 * One job.
 *
 * `data` is attached only when the caller may inspect payloads. The decision is
 * made here rather than in the route so that no future handler can forget it: the
 * field is absent from the object, not present and filtered on the way out.
 */
export async function getJob(
  id: string,
  jobId: string,
  mayInspect: boolean,
): Promise<QueueJobDetail> {
  const queue = requireQueue(id).get();
  const job = await queue.getJob(jobId);
  if (!job) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Job not found");

  const state = (await job.getState()) as QueueJobState;
  return {
    ...toJob(job, state),
    ...(mayInspect ? { data: job.data as unknown } : {}),
    stacktrace: job.stacktrace ?? [],
  };
}

/* --------------------------------- actions -------------------------------- */

async function requireJob(id: string, jobId: string): Promise<Job> {
  const job = await requireQueue(id).get().getJob(jobId);
  if (!job) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Job not found");
  return job;
}

/** Put a failed job back in the queue. BullMQ refuses if it is not failed. */
export async function retryJob(id: string, jobId: string): Promise<void> {
  const job = await requireJob(id, jobId);
  const state = await job.getState();
  if (state !== "failed") {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      `Only a failed job can be retried — this one is ${state}.`,
    );
  }
  await job.retry();
}

/** Run a delayed job now, instead of at its scheduled time. */
export async function promoteJob(id: string, jobId: string): Promise<void> {
  const job = await requireJob(id, jobId);
  const state = await job.getState();
  if (state !== "delayed") {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      `Only a delayed job can be promoted — this one is ${state}.`,
    );
  }
  await job.promote();
}

/**
 * Remove one job.
 *
 * Refused while it is active: BullMQ would drop the record while a worker is
 * still running the handler, so the work continues with nothing tracking it and
 * no way to see how it ended.
 */
export async function removeJob(id: string, jobId: string): Promise<void> {
  const job = await requireJob(id, jobId);
  if ((await job.getState()) === "active") {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "That job is running. Wait for it to finish or fail before removing it.",
    );
  }
  await job.remove();
}

export async function setPaused(id: string, paused: boolean): Promise<void> {
  const queue = requireQueue(id).get();
  if (paused) await queue.pause();
  else await queue.resume();
}

/**
 * Bulk-remove finished jobs older than an age.
 *
 * Bounded on purpose. `drain()` discards waiting work and `obliterate()` destroys
 * the queue including active jobs; neither is exposed anywhere, because there is
 * no operational question they answer that this does not, and both are one
 * mis-click from losing a day of mail with no record of what was lost.
 */
export async function cleanQueue(
  id: string,
  options: { state: QueueCleanableState; olderThanHours: number; limit: number },
): Promise<number> {
  const queue = requireQueue(id).get();
  const graceMs = options.olderThanHours * 60 * 60 * 1000;
  const removed = await queue.clean(graceMs, options.limit, options.state);
  return removed.length;
}
