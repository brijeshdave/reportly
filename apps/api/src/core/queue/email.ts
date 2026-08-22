// Author: Brijesh Dave <https://github.com/brijeshdave>
// Email delivery queue (BullMQ). Producers enqueue; the worker (started by the
// server) sends via the mailer with retries. The queue is created lazily and
// BullMQ owns its Redis connections, so importing this never touches Redis
// (e.g. building the app in tests without infra).
import type { MessageKind } from "@reportly/shared";
import { Queue, Worker, type Job } from "bullmq";

import { logger } from "@/core/logger.js";
import { maySend } from "@/core/messages/allowed.js";
import { markFailed, markSent, recordQueued } from "@/core/messages/record.js";
import { type OutgoingEmail, sendEmail } from "@/core/mail/mailer.js";
import { queueConnection } from "@/core/queue/connection.js";
import { currentRequestId } from "@/core/request-context.js";

export const EMAIL_QUEUE = "email";

/**
 * Job payload: the email, the request that caused it, and the log row it belongs
 * to — so the worker can say whether it actually arrived.
 */
export type EmailJob = OutgoingEmail & { requestId?: string; messageId?: string | null };

/** What the message was, for the outbound log. Every producer says which. */
export interface EmailMeta {
  kind: MessageKind;
  /** The notification type, when the kind is `notification`. */
  eventType?: string | null;
  toUserId?: string | null;
  companyId?: string | null;
}

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

/**
 * Queue an email, and record that it is on its way.
 *
 * The log row is written here rather than in the worker, so a message that never
 * reaches a worker at all — Redis down, queue paused — still leaves a trace saying
 * it was asked for. Losing the job silently is precisely what used to happen.
 */
export async function enqueueEmail(email: OutgoingEmail, meta: EmailMeta): Promise<void> {
  // An administrator may switch off a whole kind of message. Checked here rather
  // than at each call site, so a kind that is off cannot leave by another door.
  if (!(await maySend(meta.kind))) {
    logger.info({ kind: meta.kind }, "Not sending: this kind of message is switched off");
    return;
  }

  const messageId = await recordQueued({
    channel: "email",
    kind: meta.kind,
    eventType: meta.eventType ?? null,
    toUserId: meta.toUserId ?? null,
    companyId: meta.companyId ?? null,
    destination: email.to,
    subject: email.subject,
  });
  // Carry the originating request id so the job's logs share the same trace.
  await getEmailQueue().add("send", { ...email, requestId: currentRequestId(), messageId });
}

/** Start the worker that delivers queued emails. Owned by the server process. */
export function createEmailWorker(): Worker<EmailJob> {
  return new Worker<EmailJob>(
    EMAIL_QUEUE,
    async (job: Job<EmailJob>) => {
      const log = logger.child({ feature: "email", reqId: job.data.requestId });
      try {
        await sendEmail(job.data);
      } catch (error) {
        // Recorded, then rethrown: BullMQ owns the retrying, and swallowing the
        // error here would turn three attempts into one silent failure.
        await markFailed(job.data.messageId ?? null, error);
        throw error;
      }
      await markSent(job.data.messageId ?? null);
      log.info({ jobId: job.id, to: job.data.to }, "Email sent");
    },
    { connection: queueConnection() },
  );
}

export async function closeEmailQueue(): Promise<void> {
  if (queue) await queue.close();
}
