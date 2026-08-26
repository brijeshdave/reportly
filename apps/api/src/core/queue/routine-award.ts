// Author: Brijesh Dave <https://github.com/brijeshdave>
// Routine-award queue: the month-end points run. At 00:00 on the 2nd of each month it
// awards the month that just closed, for every company, into the leaderboard ledger.
// Idempotent (already-awarded completions are skipped), so a re-run is safe. Lazy queue
// creation keeps Redis untouched when merely importing this.
import { Queue, Worker, type Job } from "bullmq";

import { logger } from "@/core/logger.js";
import { queueConnection } from "@/core/queue/connection.js";
import { timezoneFor } from "@/core/timezone.js";
import { awardAllCompaniesBefore, awardAllCompaniesForMonth } from "@/features/routines/service.js";

export const ROUTINE_AWARD_QUEUE = "routine-award";
export const ROUTINE_AWARD_JOB = "monthly-award";

let queue: Queue | null = null;

export function getRoutineAwardQueue(): Queue {
  queue ??= new Queue(ROUTINE_AWARD_QUEUE, {
    connection: queueConnection(),
    defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 },
  });
  return queue;
}

/**
 * Register the repeatable month-end award: 00:00 on the 2nd of every month.
 * Idempotent: the scheduler is keyed by id, so re-registering on every boot
 * updates the one schedule. See the note in queue/backup.ts.
 */
export async function scheduleRoutineAward(): Promise<void> {
  // Midnight on the 2nd **where the installation works**, not where its container
  // runs. A month-end job on UTC closes the month five and a half hours late for an
  // Indian installation — harmless on the 2nd, and wrong the moment somebody moves
  // it to the 1st.
  const tz = await timezoneFor(null);
  await getRoutineAwardQueue().upsertJobScheduler(
    ROUTINE_AWARD_JOB,
    { pattern: "0 0 2 * *", tz },
    {
      name: ROUTINE_AWARD_JOB,
    },
  );
}

/** The calendar month before the run — the one that has just closed. */
function closedMonth(now: Date): { year: number; month: number } {
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1–12
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function createRoutineAwardWorker(): Worker {
  return new Worker(
    ROUTINE_AWARD_QUEUE,
    async (job: Job) => {
      if (job.name !== ROUTINE_AWARD_JOB) return;
      const { year, month } = closedMonth(new Date());
      const result = await awardAllCompaniesForMonth(year, month);
      logger.info(
        { feature: "routine-award", year, month, ...result },
        "Monthly routine award completed",
      );
    },
    { connection: queueConnection() },
  );
}

/** The first day of the current month, YYYY-MM-DD, in server-local time. */
function currentMonthStart(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * On boot, award any still-unawarded completions from before this month — catching up a
 * scheduled run the server was down for (the repeatable job only fires while the process
 * is up). Idempotent, and never touches the open current month.
 */
export async function runAwardCatchUp(): Promise<void> {
  const result = await awardAllCompaniesBefore(currentMonthStart(new Date()));
  if (result.count > 0) {
    logger.info(
      { feature: "routine-award", ...result },
      "Startup routine-award catch-up completed",
    );
  }
}

export async function closeRoutineAwardQueue(): Promise<void> {
  if (queue) await queue.close();
}
