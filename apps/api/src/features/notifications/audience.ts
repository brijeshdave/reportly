// Author: Brijesh Dave <https://github.com/brijeshdave>
// Turning one event into the people it concerns.
//
// The audience is declared with the type in the shared catalogue, not chosen at
// each call site: "who gets told when an entry is rejected" has to have one
// answer, or the two routes that can reject one will disagree, and the difference
// will be invisible until somebody complains they were not told.
import {
  NOTIFICATION_DELIVERY,
  type NotificationTypeDef,
  findNotificationType,
} from "@reportly/shared";

import { getSystemSetting } from "@/core/settings/service.js";

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
  /**
   * How far up the line this one event climbs, overriding the installation's
   * default.
   *
   * There is one case for it and it is deliberate: the default is **one** because a
   * filing at the bottom of a deep organisation should not land on a director.
   * Silence is the opposite — somebody having logged nothing for a fortnight is
   * exactly what the people further up want to know, and the ask was "his all upper
   * managers". A type that needs a different reach says so rather than moving the
   * number for everything.
   */
  uplineDepth?: number;
}

/**
 * How far up the reporting line "your team filed something" travels.
 *
 * This used to be a constant of three, with a comment admitting the number was a
 * judgement. It is a setting now, defaulting to **one** — your own direct reports —
 * because the judgement turned out to be wrong in use: "as HOD I am being shown this
 * type of applications from even the team that is not in my direct reporting line."
 */
async function uplineRules(): Promise<{ depth: number; sameBranchOnly: boolean }> {
  const { uplineDepth, uplineSameBranchOnly } = await getSystemSetting(NOTIFICATION_DELIVERY);
  return { depth: uplineDepth, sameBranchOnly: uplineSameBranchOnly };
}

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
      const { depth, sameBranchOnly } = await uplineRules();
      const chain = await uplineOf(event.subjectUserId, event.uplineDepth ?? depth, {
        sameBranchOnly,
        // The department the event belongs to, where the emitter knows it. Starting
        // from the subject's membership *there* is the difference between "my team
        // filed something" and "somebody I share a department with filed something".
        departmentId: event.departmentId ?? null,
      });
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
