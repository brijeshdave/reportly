// Author: Brijesh Dave <https://github.com/brijeshdave>
// Session service: who the caller is, what they may do, and which companies they
// can act in. `/me` is the single source for permissions — the UI never infers them.
import type { Permission, QueueAdminMode } from "@reportly/shared";

import { http } from "@/services/http.js";

export interface SessionCompany {
  id: string;
  name: string;
  /** A deactivated company can be read, but refuses every write. */
  status: "active" | "inactive";
}

export interface SessionGroup {
  id: string;
  name: string;
}

export interface Session {
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    /** When their picture last changed; null when they have none. */
    avatarVersion: number | null;
    status: "active" | "inactive";
    twoFactorEnabled: boolean;
  };
  companyId: string | null;
  isSuperadmin: boolean;
  groups: SessionGroup[];
  companies: SessionCompany[];
  locationIds: string[] | "all";
  permissions: Permission[];
  /**
   * The password is past the configured expiry. Every endpoint except this one
   * refuses the caller until they change it, so the app must take them there.
   */
  passwordExpired: boolean;
  /**
   * How much of the queue feature this server exposes — `off`, `read`, `manage`.
   *
   * Read alongside permissions, never instead of them: the env is the ceiling and
   * the permission decides who acts within it. A person holding `queues:manage`
   * on a `read` install has no route to call, so the buttons must follow this as
   * well as their grants.
   */
  queueAdmin: QueueAdminMode;
  /**
   * Optional modules the ACTIVE company has switched on.
   *
   * A different kind of fact from a permission and from `queueAdmin`: not "may
   * this person", nor "does this server offer it", but "does this company do this
   * work at all". A company that does not refill cartridges should not have the
   * word in its sidebar, however its permissions read — so the nav filters on
   * this, and the API answers the routes with 404 rather than 403 to say the same
   * thing twice.
   *
   * Keyed rather than flat, because the next optional module gets a key here and
   * changes nothing else.
   */
  modules: { parts: boolean };
  /**
   * Whether this company still offers a second kind of entry beside a breakdown.
   *
   * Not a module and not a permission — just what the entry form offers. Off, and
   * everything filed is a breakdown, which is what most installations want: an
   * entry already records the work done on it.
   */
  plannedWork: boolean;
  /**
   * Whether the shipped system roles grant anything (Settings → Access).
   *
   * Not a permission: with them switched off a system role still exists and can
   * still be ticked, and would confer nothing. A picker that offers a choice which
   * does nothing is worse than one that says why it cannot.
   */
  systemRoles: boolean;
  /**
   * Whether this person must enrol in two-factor, and by when.
   *
   * `required` without `overdue` is the grace period: everything still works and the
   * app nags. `overdue` means the API is refusing everything but `/me` and the
   * enrolment endpoints, so the only screen worth drawing is the one that sets it up.
   */
  twoFactor: {
    required: boolean;
    enrolled: boolean;
    deadline: string | null;
    overdue: boolean;
  };
}

export function fetchSession(): Promise<Session> {
  return http.get<Session>("/me");
}

export async function signOut(): Promise<void> {
  await http.post("/auth/sign-out");
}
