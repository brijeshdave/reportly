// Author: Brijesh Dave <https://github.com/brijeshdave>
// Telling a person's managers when they have gone quiet.
//
// Asked for from use: "need notification for such users to his all upper managers
// and those needs to be configurable channels of notifications."
//
// The question this answers is the Gone quiet report's, asked on a timer instead of
// on demand — so it reuses that report's query rather than growing a second opinion
// about what "logged something" means. A manager reading the report and a manager
// getting the alert must never disagree.
import { INACTIVITY_ALERTS, type InactivityAlertSettings } from "@reportly/shared";

import { db } from "@/core/db/index.js";
import { logger } from "@/core/logger.js";
import { getSystemSetting } from "@/core/settings/service.js";
import { companies, departmentUsers, departments } from "@/core/db/schema.js";
import { notify } from "@/core/queue/notifications.js";
import { SILENCE_KINDS, lastActivityFor } from "@/features/reports/silence-repo.js";
import * as repo from "@/features/reminders/repo.js";
import { eq } from "drizzle-orm";

/** Everybody who holds a department membership in a company — the people it is about. */
async function peopleIn(companyId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: departmentUsers.userId })
    .from(departmentUsers)
    .innerJoin(departments, eq(departments.id, departmentUsers.departmentId))
    .where(eq(departments.companyId, companyId));
  return rows.map((r) => r.userId);
}

/** Whole days between a moment and now, never negative. */
function daysSince(at: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
}

/**
 * One pass over every company, telling managers about the people who have gone quiet.
 *
 * **One alert per episode of silence, not one a day.** The reminder mark is keyed on
 * the date of the person's last activity, so the moment they do anything the key
 * changes and a new silence earns a new alert. Keyed on today instead, a manager
 * would hear about the same quiet fortnight fourteen times, which is the failure
 * that gets a feature muted — the same reasoning the reminder sweep already records.
 *
 * The mark is written **before** the notify, for the reason the sweep gives: dying
 * between the two loses one alert, and the other order repeats it for ever.
 */
export async function runInactivitySweep(now = new Date()): Promise<{ sent: number }> {
  const settings: InactivityAlertSettings = await getSystemSetting(INACTIVITY_ALERTS);
  if (!settings.enabled) return { sent: 0 };

  const watched = settings.kinds.length > 0 ? settings.kinds : SILENCE_KINDS;
  const rows = await db.select({ id: companies.id }).from(companies);

  let sent = 0;
  for (const company of rows) {
    const userIds = await peopleIn(company.id);
    if (userIds.length === 0) continue;

    const last = await lastActivityFor(userIds, company.id);
    const candidates: { userId: string; days: number | null; key: string }[] = [];

    for (const userId of userIds) {
      const seen = last.get(userId) ?? {};
      const newest = watched
        .map((kind) => seen[kind])
        .filter((at): at is Date => at !== undefined)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      const days = newest ? daysSince(newest, now) : null;
      if (days !== null && days < settings.afterDays) continue;
      candidates.push({
        userId,
        days,
        // The episode, not the day. See the note above.
        key: newest ? newest.toISOString().slice(0, 10) : "never",
      });
    }
    if (candidates.length === 0) continue;

    const keys = candidates.map((c) => ({
      userId: c.userId,
      type: "person.inactive",
      entityId: c.userId,
      occurrenceKey: c.key,
    }));
    const already = await repo.alreadySent(keys);
    const fresh = candidates.filter(
      (c) => !already.has(`${c.userId}|person.inactive|${c.userId}|${c.key}`),
    );
    if (fresh.length === 0) continue;

    await repo.markSent(
      fresh.map((c) => ({
        userId: c.userId,
        type: "person.inactive",
        entityId: c.userId,
        occurrenceKey: c.key,
        entityKind: "user",
      })),
    );

    for (const person of fresh) {
      const how =
        person.days === null
          ? "has logged nothing at all"
          : `has logged nothing for ${person.days} days`;
      await notify({
        type: "person.inactive",
        companyId: company.id,
        // Nobody caused this; the clock did. A name in the actor column would be a
        // person blamed for somebody else's silence.
        actorUserId: null,
        // The audience walks **up** from here: this is who it is about, not who
        // hears about it.
        subjectUserId: person.userId,
        uplineDepth: settings.uplineDepth,
        title: "Somebody in your team has gone quiet",
        body: `They ${how}.`,
        link: "/reports",
        entityKind: "user",
        entityId: person.userId,
      });
      sent += 1;
    }
  }

  if (sent > 0) logger.info({ feature: "reminders", sent }, "Inactivity sweep completed");
  return { sent };
}
