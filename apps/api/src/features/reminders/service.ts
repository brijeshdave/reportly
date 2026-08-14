// Author: Brijesh Dave <https://github.com/brijeshdave>
// The daily reminder sweep: work about to come due, and work that has slipped.
//
// Every other notification in the app is caused by somebody doing something.
// These are not — nothing happens, and that is the point. So the sweep has to
// answer a question the event-driven ones never face: "have I already said this?"
// Without that it would repeat the same overdue routine every morning until the
// person filtered the whole channel away, and then the useful ones would go too.
//
// The answer lives in `notification_reminders`, keyed by the occurrence rather
// than the thing, so tomorrow's instance of the same routine is still worth
// mentioning.
import { notify } from "@/core/queue/notifications.js";
import { logger } from "@/core/logger.js";
import * as repo from "@/features/reminders/repo.js";
import { myOccurrences } from "@/features/routines/service.js";

/** How far ahead "due soon" looks. One day: a warning nobody can act on is noise. */
const LOOK_AHEAD_HOURS = 24;

/**
 * How far back the sweep looks for slipped routines.
 *
 * Seven days, not for ever. An occurrence missed in March is not news in
 * September, and a first run on an old database would otherwise send everybody a
 * year of reminders in one go — which is exactly the sort of thing that gets an
 * install's mail domain blocked.
 */
const OVERDUE_WINDOW_DAYS = 7;

/** YYYY-MM-DD, in UTC, offset by whole days. */
function isoDay(base: Date, offsetDays = 0): string {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface Pending {
  key: repo.ReminderKey & { entityKind: string };
  companyId: string;
  title: string;
  body: string;
  link: string;
}

/** Tasks reaching their due date within the look-ahead. */
async function pendingTaskReminders(now: Date): Promise<Pending[]> {
  const soon = new Date(now.getTime() + LOOK_AHEAD_HOURS * 60 * 60 * 1000);
  const due = await repo.tasksDueBetween(now, soon);

  return due.map((task) => ({
    key: {
      userId: task.assigneeId,
      type: "task.due-soon",
      entityId: task.id,
      // The due date, so a task whose deadline is moved is worth saying again.
      occurrenceKey: task.dueAt.toISOString(),
      entityKind: "task",
    },
    companyId: task.companyId,
    title: `Due soon: ${task.title}`,
    body: `It is due ${task.dueAt.toISOString().slice(0, 10)}.`,
    link: "/tasks",
  }));
}

/**
 * Routine occurrences due tomorrow, and ones already missed.
 *
 * Built per person because that is the shape the routines service offers, and
 * because the answer genuinely is per person: two people on the same routine can
 * be in different states on the same day.
 */
async function pendingRoutineReminders(now: Date): Promise<Pending[]> {
  const out: Pending[] = [];
  const from = isoDay(now, -OVERDUE_WINDOW_DAYS);
  const to = isoDay(now, 1);
  const today = isoDay(now);
  const tomorrow = isoDay(now, 1);

  for (const companyId of await repo.companiesWithRoutines()) {
    for (const userId of await repo.routineAssigneesIn(companyId)) {
      const occurrences = await myOccurrences(companyId, userId, from, to);

      for (const occurrence of occurrences) {
        // Anything already logged, or too old to log, is not worth a word:
        // telling somebody about work they can no longer do is only annoying.
        if (occurrence.state === "completed" || occurrence.state === "in_progress") continue;
        if (occurrence.locked) continue;

        const dueTomorrow = occurrence.date === tomorrow;
        const overdue = occurrence.date < today;
        if (!dueTomorrow && !overdue) continue;

        out.push({
          key: {
            userId,
            type: dueTomorrow ? "routine.due-soon" : "routine.overdue",
            entityId: occurrence.routineId,
            occurrenceKey: occurrence.date,
            entityKind: "routine",
          },
          companyId,
          title: dueTomorrow
            ? `Due tomorrow: ${occurrence.routineTitle}`
            : `Overdue: ${occurrence.routineTitle}`,
          body: `For ${occurrence.date}.`,
          link: "/routines",
        });
      }
    }
  }

  return out;
}

/**
 * Run the sweep.
 *
 * The mark is written **before** the notification is enqueued. If the process
 * dies between the two, one reminder is lost; the other order loses the mark and
 * sends the same reminder every day for ever. A missed reminder is a small
 * failure and a repeating one is the failure that gets the whole feature muted.
 */
export async function runReminderSweep(now = new Date()): Promise<{ sent: number }> {
  const pending = [...(await pendingTaskReminders(now)), ...(await pendingRoutineReminders(now))];
  if (pending.length === 0) return { sent: 0 };

  const sent = await repo.alreadySent(pending.map((p) => p.key));
  const fresh = pending.filter(
    (p) => !sent.has(`${p.key.userId}|${p.key.type}|${p.key.entityId}|${p.key.occurrenceKey}`),
  );
  if (fresh.length === 0) return { sent: 0 };

  await repo.markSent(fresh.map((p) => p.key));

  for (const item of fresh) {
    await notify({
      type: item.key.type,
      companyId: item.companyId,
      // Nobody caused this. Null keeps a person's name out of the actor column
      // for something the clock did.
      actorUserId: null,
      subjectUserId: item.key.userId,
      title: item.title,
      body: item.body,
      link: item.link,
      entityKind: item.key.entityKind,
      entityId: item.key.entityId,
    });
  }

  logger.info({ feature: "reminders", sent: fresh.length }, "Reminder sweep completed");
  return { sent: fresh.length };
}

/** Drop marks older than a year; see the repo for why they cannot live for ever. */
export async function pruneReminderMarks(now = new Date()): Promise<number> {
  const before = new Date(now.getTime());
  before.setUTCFullYear(before.getUTCFullYear() - 1);
  return repo.pruneMarks(before);
}
