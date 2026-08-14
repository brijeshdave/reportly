// Author: Brijesh Dave <https://github.com/brijeshdave>
// The notification queue. Producers enqueue one *event*; the worker resolves who
// it concerns and delivers it.
//
// One job per event, not per recipient. Audience resolution is a recursive walk
// up a reporting line or a permission join, and it belongs behind the queue for
// two reasons: it must not sit on the request of the person who merely filed
// something, and a fan-out to forty people should cost one enqueue, not forty.
//
// The queue is created lazily and BullMQ owns its connections, so importing this
// never touches Redis — the same arrangement as the email queue, and what lets
// the app be built in tests with no infrastructure.
import { Queue, Worker, type Job } from "bullmq";

import { logger } from "@/core/logger.js";
import { queueConnection } from "@/core/queue/connection.js";
import { currentRequestId } from "@/core/request-context.js";
import { dispatch, type NotificationRequest } from "@/features/notifications/service.js";

export const NOTIFICATION_QUEUE = "notifications";

/** The event, plus the request that caused it, so the job's logs share a trace. */
export type NotificationJob = NotificationRequest & { requestId?: string };

let queue: Queue<NotificationJob> | null = null;

export function getNotificationQueue(): Queue<NotificationJob> {
  queue ??= new Queue<NotificationJob>(NOTIFICATION_QUEUE, {
    connection: queueConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
  return queue;
}

/**
 * Emit an event. Never throws.
 *
 * A notification is a consequence of an action, not part of it: a Redis blip must
 * not turn "your entry was filed" into a 500. The failure is logged and the thing
 * the user actually asked for still succeeds.
 */
export async function notify(request: NotificationRequest): Promise<void> {
  try {
    await getNotificationQueue().add("dispatch", { ...request, requestId: currentRequestId() });
  } catch (error) {
    logger.error({ err: error, type: request.type }, "Could not enqueue a notification");
  }
}

/** Start the worker that resolves and delivers events. Owned by the server. */
export function createNotificationWorker(): Worker<NotificationJob> {
  return new Worker<NotificationJob>(
    NOTIFICATION_QUEUE,
    async (job: Job<NotificationJob>) => {
      const log = logger.child({ feature: "notifications", reqId: job.data.requestId });
      const sent = await dispatch(job.data);
      log.debug({ jobId: job.id, type: job.data.type, sent }, "Notification job finished");
    },
    { connection: queueConnection() },
  );
}

export async function closeNotificationQueue(): Promise<void> {
  if (queue) await queue.close();
}
