// Author: Brijesh Dave <https://github.com/brijeshdave>
// Process entry point: build the app, start the background workers, listen, and
// shut down gracefully.
import { reloadAuth } from "@/core/auth/auth.js";
import { buildApp } from "@/core/app.js";
import { reloadDebugConfig } from "@/core/debug/service.js";
import { env } from "@/core/env.js";
import { reloadLogging } from "@/core/logger.js";
import { startLogBufferFlusher } from "@/core/logging/buffer.js";
import { closeLogFile } from "@/core/logging/file-sink.js";
import { createEmailWorker } from "@/core/queue/email.js";
import { closeNotificationQueue, createNotificationWorker } from "@/core/queue/notifications.js";
import {
  closeMaintenanceQueue,
  createMaintenanceWorker,
  scheduleLogRetention,
  scheduleNotificationPrune,
  scheduleQueueHealth,
  scheduleReminderSweep,
} from "@/core/queue/maintenance.js";
import {
  closeRoutineAwardQueue,
  createRoutineAwardWorker,
  runAwardCatchUp,
  scheduleRoutineAward,
} from "@/core/queue/routine-award.js";
import { closeBackupQueue, createBackupWorker, scheduleBackupSweep } from "@/core/queue/backup.js";

async function main(): Promise<void> {
  const app = await buildApp();
  // Load logging + auth settings and enabled SSO providers from the settings store.
  await reloadLogging();
  await reloadAuth();
  await reloadDebugConfig();

  const emailWorker = createEmailWorker();
  emailWorker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "Email job failed");
  });

  const notificationWorker = createNotificationWorker();
  notificationWorker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "Notification job failed");
  });

  const maintenanceWorker = createMaintenanceWorker();
  maintenanceWorker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "Maintenance job failed");
  });
  await scheduleLogRetention();
  await scheduleNotificationPrune();
  await scheduleReminderSweep();
  await scheduleQueueHealth();

  const routineAwardWorker = createRoutineAwardWorker();
  routineAwardWorker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "Routine award job failed");
  });
  await scheduleRoutineAward();
  // Catch up any month-end award the process was down for. Fire-and-forget so a slow
  // pass never delays the server accepting requests.
  void runAwardCatchUp().catch((err) => app.log.error({ err }, "Routine award catch-up failed"));

  const backupWorker = createBackupWorker();
  backupWorker.on("failed", (job, err) => {
    app.log.error({ err, jobId: job?.id }, "Backup job failed");
  });
  await scheduleBackupSweep();

  const stopFlusher = startLogBufferFlusher();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "Shutting down");
    stopFlusher();
    await Promise.allSettled([
      emailWorker.close(),
      notificationWorker.close(),
      closeNotificationQueue(),
      maintenanceWorker.close(),
      closeMaintenanceQueue(),
      routineAwardWorker.close(),
      closeRoutineAwardQueue(),
      backupWorker.close(),
      closeBackupQueue(),
    ]);
    await app.close();
    closeLogFile();
    process.exit(0);
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void shutdown(signal));
  }

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (err) {
    app.log.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

void main();
