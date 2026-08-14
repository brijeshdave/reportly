// Author: Brijesh Dave <https://github.com/brijeshdave>
// Pure scheduling maths for backups — kept out of the service so "is a run due?" is
// testable without a database or a clock.

const DAY_MS = 24 * 60 * 60 * 1000;

/** The minimum age (days) between scheduled runs for each frequency. */
const EVERY_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 28 };

/**
 * Whether a scheduled backup is due: never when `off`, always when there has been no
 * successful run, otherwise once the last run is older than the frequency's interval.
 */
export function isBackupDue(frequency: string, lastAt: Date | null, now: Date): boolean {
  if (frequency === "off") return false;
  const every = EVERY_DAYS[frequency];
  if (every === undefined) return false;
  if (!lastAt) return true;
  return now.getTime() - lastAt.getTime() >= every * DAY_MS - 60_000; // small skew tolerance
}

/** The cutoff before which backups of a kind are expired. Null when retention is disabled (0). */
export function retentionCutoff(retentionDays: number, now: Date): Date | null {
  if (retentionDays <= 0) return null;
  return new Date(now.getTime() - retentionDays * DAY_MS);
}
