// Author: Brijesh Dave <https://github.com/brijeshdave>
// Backup queue: a daily tick that takes any backup that is due (per the per-kind schedule
// settings) and prunes expired ones to their retention. Mirrors the maintenance queue.
// Lazy queue creation keeps Redis untouched when merely importing this.
import { Queue, Worker, type Job } from "bullmq";

import { queueConnection } from "@/core/queue/connection.js";
import { runScheduledBackups } from "@/features/backups/service.js";

export const BACKUP_QUEUE = "backup";
export const BACKUP_SWEEP_JOB = "backup-sweep";

const DAILY_MS = 24 * 60 * 60 * 1000;

let queue: Queue | null = null;

export function getBackupQueue(): Queue {
  queue ??= new Queue(BACKUP_QUEUE, {
    connection: queueConnection(),
    defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 },
  });
  return queue;
}

/**
 * Register the repeatable daily sweep. Idempotent: the scheduler is keyed by id,
 * so a re-registration on every boot updates the one schedule rather than adding
 * another. (BullMQ 6 replaced `add(..., { repeat })` with job schedulers; the old
 * form silently produced a second repeatable when the interval changed.)
 */
export async function scheduleBackupSweep(): Promise<void> {
  await getBackupQueue().upsertJobScheduler(
    BACKUP_SWEEP_JOB,
    { every: DAILY_MS },
    {
      name: BACKUP_SWEEP_JOB,
    },
  );
}

export function createBackupWorker(): Worker {
  return new Worker(
    BACKUP_QUEUE,
    async (job: Job) => {
      if (job.name !== BACKUP_SWEEP_JOB) return;
      await runScheduledBackups();
    },
    { connection: queueConnection() },
  );
}

export async function closeBackupQueue(): Promise<void> {
  if (queue) await queue.close();
}
