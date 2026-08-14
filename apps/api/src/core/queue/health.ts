// Author: Brijesh Dave <https://github.com/brijeshdave>
// The hourly check that says "jobs are failing" out loud.
//
// This is the problem the whole queue feature exists for: a misconfigured relay
// makes every email fail three times into `failed`, where it sits for five
// hundred jobs and nobody ever sees it. The only signal today is a person saying
// they never got their password reset.
//
// It lives in `core/queue`, not in `features/queues`, on purpose. The admin
// screen is optional and switched off by default; noticing that mail has stopped
// is not. Keeping the watch here also keeps the feature's isolation guard honest —
// nothing outside `features/queues` may depend on it.
import { logger } from "@/core/logger.js";
import { env } from "@/core/env.js";
import { notify } from "@/core/queue/notifications.js";
import { QUEUE_REGISTRY } from "@/core/queue/registry.js";
import { redis } from "@/core/redis.js";

const MARK_PREFIX = "reportly:queue-health:";
/** A mark outlives a few missed runs but not a fortnight of downtime. */
const MARK_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Notify on the *increase*, not the total.
 *
 * A queue holding forty old failures is a fact about last week; forty new ones
 * since the last check is today's news. Alerting on the total would send the same
 * message every hour until somebody cleaned up, which trains people to ignore it —
 * and the messages that matter arrive on the same channel.
 */
export async function checkQueueHealth(): Promise<{ alerted: number }> {
  let alerted = 0;

  for (const entry of QUEUE_REGISTRY) {
    const markKey = `${MARK_PREFIX}${entry.id}`;
    try {
      const counts = await entry.get().getJobCounts("failed");
      const failed = counts.failed ?? 0;

      const previousRaw = await redis.get(markKey);
      // First run on a queue records where it stands without alerting: an install
      // that already had failures should not open with a message about history
      // nobody was going to act on.
      const previous = previousRaw === null ? failed : Number(previousRaw);
      await redis.set(markKey, String(failed), "EX", MARK_TTL_SECONDS);

      const added = failed - previous;
      if (added <= 0) continue;

      await notify({
        type: "queue.jobs-failing",
        companyId: null,
        actorUserId: null,
        title: `${added} job${added === 1 ? "" : "s"} failed in the ${entry.label} queue`,
        body:
          `${failed} failed job${failed === 1 ? "" : "s"} are waiting there now. ` +
          entry.description,
        // Only when there is a page to open. With QUEUE_ADMIN off the route is
        // not mounted, and a notification linking to a 404 is worse than one that
        // simply says what happened.
        link: env.QUEUE_ADMIN === "off" ? null : `/queues/${entry.id}`,
        entityKind: "queue",
        entityId: entry.id,
      });
      alerted += 1;
    } catch (error) {
      // Redis being unreachable is what a queue check finds out first, and it is
      // not a reason to abandon the sweep or crash the worker.
      logger.warn({ err: error, queue: entry.id }, "Could not check queue health");
    }
  }

  return { alerted };
}
