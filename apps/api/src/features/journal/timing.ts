// Author: Brijesh Dave <https://github.com/brijeshdave>
// What a report's status events add up to: when somebody picked it up, when it was
// fixed, and how long each took. Pure — it takes events and returns numbers, so
// every rule below is unit-testable without a database, which matters because the
// rules are judgement calls rather than arithmetic.
import type { ReportTiming } from "@reportly/shared";

/** The minimum an event must carry for the timing rules to decide anything. */
export interface TimingEvent {
  changedAt: Date;
  /** Whether the status moved *into* ends the report's life. */
  toIsTerminal: boolean;
}

const MINUTE = 60_000;

const minutesBetween = (from: Date, to: Date): number =>
  Math.max(0, (to.getTime() - from.getTime()) / MINUTE);

/**
 * Derive response and resolution times from one report's status events, oldest
 * first. The events are the truth; nothing here is stored.
 *
 * The rules, each of which is a decision rather than a calculation:
 *
 * - **The clock starts at the first event**, which the creation event guarantees
 *   exists. A report with no events at all is not "instant", it is unmeasured —
 *   every field comes back null.
 * - **Responded = the first status change after filing**, whatever it was. Not
 *   "the first move out of the `open` group", which is the obvious rule and the
 *   wrong one: the seeded ladder puts Unattended, Acknowledged, In progress, On
 *   hold and Partially completed *all* in group `open`. The group is a coarse
 *   bucket (open / resolved / rejected) for colouring a badge, not a workflow
 *   stage — so keying response off it would mean nothing counted as a response
 *   until the report was resolved, and response time would silently equal
 *   resolution time on every report in the system. "Somebody moved it" is the
 *   honest signal the data actually carries.
 * - **Resolved = entry into the terminal run the report is *currently* in.** Two
 *   consequences worth stating. A report that was fixed and then reopened is *not*
 *   resolved — `resolvedAt` is null, because it is open right now and claiming a
 *   resolution date for an open report is how a dashboard lies. And a report that
 *   went Completed → Closed resolved when it hit Completed, not when somebody
 *   filed the paperwork, so we walk back to the start of the terminal run rather
 *   than taking the last event.
 * - **Reopened is reported separately**, because a report that broke twice and was
 *   fixed twice has a resolution time measured from the original filing, and a
 *   reader deserves to know that is what they are looking at.
 */
export function computeTiming(events: TimingEvent[]): ReportTiming {
  const none: ReportTiming = {
    respondedAt: null,
    resolvedAt: null,
    timeToRespondMinutes: null,
    timeToResolveMinutes: null,
    reopened: false,
  };
  if (events.length === 0) return none;

  const ordered = [...events].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  const start = ordered[0]!.changedAt;

  // The second event: the first time anyone moved it after it was filed.
  const responded = ordered[1] ?? null;

  // Did it ever leave terminal after reaching it? That is a reopen, whoever did it
  // and whatever route they took — we read the transitions, not an intent flag.
  let everTerminal = false;
  let reopened = false;
  for (const e of ordered) {
    if (e.toIsTerminal) everTerminal = true;
    else if (everTerminal) reopened = true;
  }

  // Resolved only if it is terminal *now*; then walk back over the consecutive
  // terminal run to find when that run began.
  let resolvedAt: Date | null = null;
  if (ordered[ordered.length - 1]!.toIsTerminal) {
    let i = ordered.length - 1;
    while (i > 0 && ordered[i - 1]!.toIsTerminal) i--;
    resolvedAt = ordered[i]!.changedAt;
  }

  return {
    respondedAt: responded ? responded.changedAt.toISOString() : null,
    resolvedAt: resolvedAt ? resolvedAt.toISOString() : null,
    timeToRespondMinutes: responded ? minutesBetween(start, responded.changedAt) : null,
    timeToResolveMinutes: resolvedAt ? minutesBetween(start, resolvedAt) : null,
    reopened,
  };
}
