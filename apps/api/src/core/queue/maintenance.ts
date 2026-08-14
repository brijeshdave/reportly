// Author: Brijesh Dave <https://github.com/brijeshdave>
// Maintenance queue: scheduled housekeeping — the daily log-retention sweep and
// the notification prune. Lazy queue creation keeps DB/Redis untouched when
// merely importing this.
import { Queue, Worker, type Job } from "bullmq";

import { NOTIFICATION_DELIVERY } from "@reportly/shared";

import { logger } from "@/core/logger.js";
import { runLogRetention } from "@/core/logging/retention.js";
import { queueConnection } from "@/core/queue/connection.js";
import { checkQueueHealth } from "@/core/queue/health.js";
import { getSystemSetting } from "@/core/settings/service.js";
import { pruneRead } from "@/features/notifications/repo.js";
import { pruneReminderMarks, runReminderSweep } from "@/features/reminders/service.js";

export const MAINTENANCE_QUEUE = "maintenance";
export const LOG_RETENTION_JOB = "log-retention";
export const NOTIFICATION_PRUNE_JOB = "notification-prune";
export const REMINDER_SWEEP_JOB = "reminder-sweep";
export const QUEUE_HEALTH_JOB = "queue-health";

const DAILY_MS = 24 * 60 * 60 * 1000;

let queue: Queue | null = null;

export function getMaintenanceQueue(): Queue {
  queue ??= new Queue(MAINTENANCE_QUEUE, {
    connection: queueConnection(),
    defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 },
  });
  return queue;
}

/**
 * Register the repeatable retention sweep. Idempotent: the scheduler is keyed by
 * id, so re-registering on every boot updates the one schedule. See the note in
 * queue/backup.ts — BullMQ 6 replaced `add(..., { repeat })` with job schedulers.
 */
export async function scheduleLogRetention(): Promise<void> {
  await getMaintenanceQueue().upsertJobScheduler(
    LOG_RETENTION_JOB,
    { every: DAILY_MS },
    {
      name: LOG_RETENTION_JOB,
    },
  );
}

/** Register the daily notification prune, alongside the log sweep. */
export async function scheduleNotificationPrune(): Promise<void> {
  await getMaintenanceQueue().upsertJobScheduler(
    NOTIFICATION_PRUNE_JOB,
    { every: DAILY_MS },
    {
      name: NOTIFICATION_PRUNE_JOB,
    },
  );
}

/**
 * Delete read notifications past the retention window.
 *
 * Read ones only, and `0` days means never. An inbox that quietly deletes what
 * you have not opened is worse than a long inbox — the point of the bell is that
 * nothing goes missing while you are away.
 */
async function runNotificationPrune(): Promise<{ deleted: number }> {
  const { retentionDays } = await getSystemSetting(NOTIFICATION_DELIVERY);
  if (retentionDays <= 0) return { deleted: 0 };
  const before = new Date(Date.now() - retentionDays * DAILY_MS);
  return { deleted: await pruneRead(before) };
}

/**
 * Register the hourly queue-health check.
 *
 * Hourly rather than daily: "your mail stopped a day ago" is not a useful thing
 * to be told. It runs whatever `QUEUE_ADMIN` is set to — noticing that jobs are
 * failing is not the optional part.
 */
export async function scheduleQueueHealth(): Promise<void> {
  await getMaintenanceQueue().upsertJobScheduler(
    QUEUE_HEALTH_JOB,
    { every: 60 * 60 * 1000 },
    {
      name: QUEUE_HEALTH_JOB,
    },
  );
}

/**
 * Register the daily reminder sweep.
 *
 * Daily, and deliberately not hourly: these say "due tomorrow" and "overdue",
 * neither of which changes within a day, so a second run could only repeat itself.
 */
export async function scheduleReminderSweep(): Promise<void> {
  await getMaintenanceQueue().upsertJobScheduler(
    REMINDER_SWEEP_JOB,
    { every: DAILY_MS },
    {
      name: REMINDER_SWEEP_JOB,
    },
  );
}

export function createMaintenanceWorker(): Worker {
  return new Worker(
    MAINTENANCE_QUEUE,
    async (job: Job) => {
      if (job.name === LOG_RETENTION_JOB) {
        const result = await runLogRetention();
        logger.info({ feature: "maintenance", ...result }, "Log retention completed");
        return;
      }
      if (job.name === NOTIFICATION_PRUNE_JOB) {
        const result = await runNotificationPrune();
        logger.info({ feature: "maintenance", ...result }, "Notification prune completed");
        return;
      }
      if (job.name === QUEUE_HEALTH_JOB) {
        const result = await checkQueueHealth();
        logger.info({ feature: "maintenance", ...result }, "Queue health check completed");
        return;
      }
      if (job.name === REMINDER_SWEEP_JOB) {
        const result = await runReminderSweep();
        // Pruned in the same pass: the marks exist only to suppress this job, so
        // there is no other moment at which anybody would think to tidy them.
        const forgotten = await pruneReminderMarks();
        logger.info({ feature: "maintenance", ...result, forgotten }, "Reminder sweep completed");
      }
    },
    { connection: queueConnection() },
  );
}

export async function closeMaintenanceQueue(): Promise<void> {
  if (queue) await queue.close();
}
