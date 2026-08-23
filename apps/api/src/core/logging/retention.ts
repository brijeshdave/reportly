// Author: Brijesh Dave <https://github.com/brijeshdave>
// Log retention: prune the log database and the rotated log files according to
// the `logging.retention` setting. Run periodically by the maintenance worker.
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { LOG_RETENTION, MESSAGE_RETENTION } from "@reportly/shared";
import { lt } from "drizzle-orm";

import { env } from "@/core/env.js";
import { logDb } from "@/core/logdb/index.js";
import { appLogs } from "@/core/logdb/schema.js";
import { getSystemSetting } from "@/core/settings/service.js";
import { pruneMessages, pruneMessagesOfType } from "@/features/messages/repo.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Delete log rows older than `days`; returns how many were removed. */
export async function cleanupLogDatabase(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const deleted = await logDb.delete(appLogs).where(lt(appLogs.ts, cutoff)).returning({
    id: appLogs.id,
  });
  return deleted.length;
}

/** Delete rotated log files older than `days`; returns how many were removed. */
export async function cleanupLogFiles(days: number): Promise<number> {
  const cutoff = Date.now() - days * DAY_MS;
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(env.LOG_DIR);
  } catch {
    return 0; // no log directory yet
  }
  for (const name of entries) {
    if (!name.endsWith(".log")) continue;
    const path = join(env.LOG_DIR, name);
    try {
      const info = await stat(path);
      if (info.mtimeMs < cutoff) {
        await rm(path);
        removed += 1;
      }
    } catch {
      // file vanished or is locked — skip it
    }
  }
  return removed;
}

/**
 * Prune the outbound message log, per channel.
 *
 * Runs with the log sweep because it is the same housekeeping on the same daily
 * rhythm — one more table for an existing job, rather than a new mechanism with
 * its own schedule to go wrong.
 *
 * `0` days means the channel is not logged at all, so there is nothing to prune.
 * Rows written before somebody switched it off are left alone: deleting a year of
 * history as a side effect of flipping a toggle is not what anybody asked for.
 */
export async function cleanupOutboundMessages(): Promise<number> {
  const { perType, ...channels } = await getSystemSetting(MESSAGE_RETENTION);
  const overridden = Object.keys(perType);
  let removed = 0;

  // The overrides first, each on its own clock.
  for (const [type, days] of Object.entries(perType)) {
    if (days <= 0) continue;
    removed += await pruneMessagesOfType(type, new Date(Date.now() - days * DAY_MS));
  }

  // Then the rest of each channel, skipping anything an override is keeping —
  // otherwise the channel's shorter clock would delete it first and the override
  // would be a setting that changed nothing.
  for (const [channel, days] of Object.entries(channels)) {
    if (days <= 0) continue;
    removed += await pruneMessages(channel, new Date(Date.now() - days * DAY_MS), overridden);
  }

  return removed;
}

export async function runLogRetention(): Promise<{
  database: number;
  files: number;
  messages: number;
}> {
  const retention = await getSystemSetting(LOG_RETENTION);
  return {
    database: await cleanupLogDatabase(retention.databaseDays),
    files: await cleanupLogFiles(retention.fileDays),
    messages: await cleanupOutboundMessages(),
  };
}
