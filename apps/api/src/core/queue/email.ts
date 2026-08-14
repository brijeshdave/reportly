// Author: Brijesh Dave <https://github.com/brijeshdave>
// Email delivery queue (BullMQ). Producers enqueue; the worker (started by the
// server) sends via the mailer with retries. The queue is created lazily and
// BullMQ owns its Redis connections, so importing this never touches Redis
// (e.g. building the app in tests without infra).
import { Queue, Worker, type Job } from "bullmq";

import { logger } from "@/core/logger.js";
import { type OutgoingEmail, sendEmail } from "@/core/mail/mailer.js";
import { queueConnection } from "@/core/queue/connection.js";
import { currentRequestId } from "@/core/request-context.js";

export const EMAIL_QUEUE = "email";

/** Job payload: the email plus the request id that caused it (for tracing). */
export type EmailJob = OutgoingEmail & { requestId?: string };

let queue: Queue<EmailJob> | null = null;

export function getEmailQueue(): Queue<EmailJob> {
  queue ??= new Queue<EmailJob>(EMAIL_QUEUE, {
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

export async function enqueueEmail(email: OutgoingEmail): Promise<void> {
  // Carry the originating request id so the job's logs share the same trace.
  await getEmailQueue().add("send", { ...email, requestId: currentRequestId() });
}

/** Start the worker that delivers queued emails. Owned by the server process. */
export function createEmailWorker(): Worker<EmailJob> {
  return new Worker<EmailJob>(
    EMAIL_QUEUE,
    async (job: Job<EmailJob>) => {
      const log = logger.child({ feature: "email", reqId: job.data.requestId });
      await sendEmail(job.data);
      log.info({ jobId: job.id, to: job.data.to }, "Email sent");
    },
    { connection: queueConnection() },
  );
}

export async function closeEmailQueue(): Promise<void> {
  if (queue) await queue.close();
}
