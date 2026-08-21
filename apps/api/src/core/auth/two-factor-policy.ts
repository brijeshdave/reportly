// Author: Brijesh Dave <https://github.com/brijeshdave>
// Whether two-factor is compulsory for one person, and by when.
//
// Three sources can require it — the installation, the active company, and any group
// they are in — plus a switch for superadmins. They are ORed: a **floor, never a
// ceiling**. Nothing waives a requirement somebody else imposed, because precedence
// rules that let one level cancel another end in an argument about which won, and the
// argument is settled in the wrong direction the first time somebody is locked out.
//
// One function, so the rule is in one place and testable without a browser. The
// enforcement in `plugin.ts` and the banner the web app draws both read this.
import { TWO_FACTOR_SETTINGS, type AuthContext } from "@reportly/shared";
import { and, eq } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { groupUsers, groups, users } from "@/core/db/schema.js";
import { notify } from "@/core/queue/notifications.js";
import { getCompanySetting, getSystemSetting } from "@/core/settings/service.js";

export interface TwoFactorRequirement {
  /** Whether the caller must enrol at all. */
  required: boolean;
  /** Whether they already have. */
  enrolled: boolean;
  /** When it started applying to them; null when it does not apply. */
  since: Date | null;
  /** When the block starts biting. Null when not required. */
  deadline: Date | null;
  /** True once past the deadline and still not enrolled — the state that blocks. */
  overdue: boolean;
}

/** Any group they belong to that demands it. */
async function inRequiringGroup(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: groups.id })
    .from(groupUsers)
    .innerJoin(groups, eq(groups.id, groupUsers.groupId))
    .where(and(eq(groupUsers.userId, userId), eq(groups.requiresTwoFactor, true)))
    .limit(1);
  return row !== undefined;
}

/**
 * The company's own answer, when there is an active company.
 *
 * Read with `getCompanySetting` rather than the effective one so a company can only
 * be seen to *raise* the bar: the installation's answer is ORed in separately below,
 * and a company that says "optional" cannot talk it back down.
 */
async function companyRequires(companyId: string | null): Promise<boolean> {
  if (!companyId) return false;
  const setting = await getCompanySetting(TWO_FACTOR_SETTINGS, companyId);
  return setting?.mode === "required";
}

/**
 * Resolve the requirement, and keep the per-person clock up to date.
 *
 * The clock is stamped here rather than by whoever flips a switch, because the
 * moment it starts applying to somebody is not the moment a setting changes — it is
 * also the moment they join a required group, or a company they belong to turns it
 * on. Every one of those paths runs through here on the next request, which is the
 * only place that sees all of them.
 */
export async function twoFactorRequirement(
  ctx: Pick<AuthContext, "userId" | "companyId" | "isSuperadmin">,
): Promise<TwoFactorRequirement> {
  const [user] = await db
    .select({
      enrolled: users.twoFactorEnabled,
      since: users.twoFactorRequiredSince,
    })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);

  const settings = await getSystemSetting(TWO_FACTOR_SETTINGS);
  const bySystem = settings.mode === "required";
  const bySuperadmin = ctx.isSuperadmin && settings.requireForSuperadmins;

  const required =
    bySystem ||
    bySuperadmin ||
    (await companyRequires(ctx.companyId)) ||
    (await inRequiringGroup(ctx.userId));

  const enrolled = user?.enrolled ?? false;

  if (!required) {
    // Stopped applying — a group untickled, a company relaxing its own rule. Clear
    // the clock so that if it ever applies again they get the full grace period
    // rather than a deadline they have already missed.
    if (user?.since) {
      await db.update(users).set({ twoFactorRequiredSince: null }).where(eq(users.id, ctx.userId));
    }
    return { required: false, enrolled, since: null, deadline: null, overdue: false };
  }

  let since = user?.since ?? null;
  if (!since) {
    since = new Date();
    await db.update(users).set({ twoFactorRequiredSince: since }).where(eq(users.id, ctx.userId));

    // Told once, when it starts applying to them — not on every request, and not
    // only at the login screen a week later when they cannot get in.
    if (!enrolled) {
      const deadline = new Date(since.getTime() + settings.graceDays * 24 * 60 * 60 * 1000);
      await notify({
        type: "security.two-factor-required",
        companyId: ctx.companyId,
        actorUserId: null,
        userIds: [ctx.userId],
        title: "Two-factor authentication is now required on your account",
        body:
          settings.graceDays > 0
            ? `Set it up before ${deadline.toISOString().slice(0, 10)}; after that you will be asked for it before you can carry on.`
            : "Set it up to carry on using Reportly.",
        link: "/profile?tab=security",
        entityKind: "user",
        entityId: ctx.userId,
      });
    }
  }

  const deadline = new Date(since.getTime() + settings.graceDays * 24 * 60 * 60 * 1000);
  return {
    required: true,
    enrolled,
    since,
    deadline,
    overdue: !enrolled && Date.now() >= deadline.getTime(),
  };
}
