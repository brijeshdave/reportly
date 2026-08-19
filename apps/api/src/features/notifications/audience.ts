// Author: Brijesh Dave <https://github.com/brijeshdave>
// Turning one event into the people it concerns.
//
// The audience is declared with the type in the shared catalogue, not chosen at
// each call site: "who gets told when an entry is rejected" has to have one
// answer, or the two routes that can reject one will disagree, and the difference
// will be invisible until somebody complains they were not told.
import { type NotificationTypeDef, findNotificationType } from "@reportly/shared";

import { uplineOf } from "@/features/departments/repo.js";
import {
  holdersOfPermissionAnywhere,
  membersOfCompany,
  membersOfDepartment,
} from "@/features/notifications/audience-repo.js";

/** What an emitter knows about the thing that happened. */
export interface NotificationEvent {
  type: string;
  /** Null for an event about the installation rather than a tenant. */
  companyId: string | null;
  /** Who caused it. Excluded from the audience — nobody needs telling what they just did. */
  actorUserId: string | null;
  /** The person the event is *about*: the author, the assignee, the subject of an upline walk. */
  subjectUserId?: string | null;
  departmentId?: string | null;
  /** Recipients the call site names itself, for `explicit` audiences. */
  userIds?: string[];
}

/**
 * How far up the reporting line "your team filed something" travels.
 *
 * Three is a judgement, not a discovery: far enough that a supervisor's absence
 * does not swallow the message, short enough that a filing at the bottom of a
 * deep organisation does not land on a director's phone. It is one constant so
 * that changing the policy is one edit.
 */
const UPLINE_DEPTH = 3;

/**
 * The user ids an event reaches, in the event's company.
 *
 * Two rules hold for every audience, which is why they live here and not in the
 * dozen places that emit:
 *
 *   - the actor is never their own recipient, unless the type asks for them back
 *     (`includeActor` — a failure needs to reach whoever caused it)
 *   - a recipient outside the event's company is not a recipient
 */
export async function resolveAudience(event: NotificationEvent): Promise<string[]> {
  const def = findNotificationType(event.type);
  if (!def) return [];

  const candidates = await candidatesFor(def, event);
  // The actor is excluded by default — nobody needs telling what they just did —
  // but a type may ask for them back. A failure is that case: whoever pressed the
  // button is exactly who must hear that it did not work.
  const keepActor = def.includeActor === true;
  const unique = [...new Set(candidates)].filter(
    (id) => id && (keepActor || id !== event.actorUserId),
  );

  // A system-wide event has no company to filter by, and its audience was already
  // resolved from a permission across the whole installation. Passing it through
  // the company gate would drop everyone.
  if (def.systemWide || !event.companyId) return unique;

  return membersOfCompany(unique, event.companyId);
}

async function candidatesFor(
  def: NotificationTypeDef,
  event: NotificationEvent,
): Promise<string[]> {
  switch (def.audience) {
    case "author":
    case "assignee":
      // Both name one person; which one is the emitter's business, and it passes
      // them as the subject. Keeping them as separate audiences is not redundant —
      // the catalogue is read by humans deciding whether a type is aimed at them.
      return event.subjectUserId ? [event.subjectUserId] : [];

    case "upline": {
      if (!event.subjectUserId) return [];
      const chain = await uplineOf(event.subjectUserId, UPLINE_DEPTH);
      return chain.map((row) => row.userId);
    }

    case "department":
      // A department belongs to a company, so an event without one cannot have a
      // department audience — and asking for it would be a bug in the emitter.
      return event.departmentId && event.companyId
        ? membersOfDepartment(event.departmentId, event.companyId)
        : [];

    case "explicit":
      return event.userIds ?? [];

    case "operators":
      return def.permission ? holdersOfPermissionAnywhere(def.permission) : [];
  }
}
