// Author: Brijesh Dave <https://github.com/brijeshdave>
// Compulsory two-factor: who it applies to, when it starts biting, and — the part
// that matters most — that it is a forced enrolment rather than a lockout.
//
// The grace period is the piece worth testing hardest. It is counted per person from
// when the requirement first applied to *them*, so somebody added to a required group
// months after the switch was flipped gets their own days rather than inheriting an
// expired deadline and finding themselves shut out on their first morning.
import { TWO_FACTOR_SETTINGS } from "@reportly/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { twoFactorRequirement } from "@/core/auth/two-factor-policy.js";
import { db } from "@/core/db/index.js";
import { appPool, logPool } from "@/core/db/pool.js";
import { groupUsers, groups, userCompanies, users } from "@/core/db/schema.js";
import { setCompanySetting, setSystemSetting } from "@/core/settings/service.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const DAY = 24 * 60 * 60 * 1000;

afterAll(async () => {
  await appPool.end();
  await logPool.end();
});

beforeEach(async () => {
  await resetDb();
});

async function person(id = "tf-user"): Promise<string> {
  await db.insert(users).values({
    id,
    name: "Ravi",
    email: `${id}@reportly.test`,
    username: id,
  });
  await db.insert(userCompanies).values({ userId: id, companyId: DEMO_COMPANY_ID });
  return id;
}

async function putInGroup(userId: string, name: string, requiresTwoFactor: boolean) {
  const [group] = await db
    .insert(groups)
    .values({ name, requiresTwoFactor })
    .returning({ id: groups.id });
  await db.insert(groupUsers).values({ groupId: group!.id, userId });
  return group!.id;
}

const resolve = (userId: string, companyId: string | null = DEMO_COMPANY_ID) =>
  twoFactorRequirement({ userId, companyId, isSuperadmin: false });

describe("compulsory two-factor", () => {
  it("asks nothing of anybody until somebody turns it on", async () => {
    const userId = await person();
    await putInGroup(userId, "Line crew", false);

    const requirement = await resolve(userId);
    expect(requirement).toMatchObject({ required: false, overdue: false, deadline: null });
  });

  it("applies to everybody in a group that demands it", async () => {
    const userId = await person();
    await putInGroup(userId, "Admins", true);

    const requirement = await resolve(userId);
    expect(requirement.required).toBe(true);
    expect(requirement.enrolled).toBe(false);
    // Seven days by default, and not overdue on day one.
    expect(requirement.overdue).toBe(false);
    expect(requirement.deadline!.getTime() - requirement.since!.getTime()).toBe(7 * DAY);
  });

  it("gives each person their own countdown, from when it started applying to them", async () => {
    // The bug this exists to prevent: a deadline measured from the setting change
    // would already have passed for somebody added to the group later, locking them
    // out on the day they joined.
    const early = await person("tf-early");
    const groupId = await putInGroup(early, "Admins", true);
    await resolve(early);

    // Rewind their clock a fortnight — as if they had been in the group all along.
    await db
      .update(users)
      .set({ twoFactorRequiredSince: new Date(Date.now() - 14 * DAY) })
      .where(eq(users.id, early));
    expect((await resolve(early)).overdue).toBe(true);

    // Somebody joining now starts from now.
    const late = await person("tf-late");
    await db.insert(groupUsers).values({ groupId, userId: late });
    const requirement = await resolve(late);
    expect(requirement.required).toBe(true);
    expect(requirement.overdue).toBe(false);
  });

  it("bites at once when the grace period is zero", async () => {
    await setSystemSetting(TWO_FACTOR_SETTINGS, {
      mode: "required",
      requireForSuperadmins: false,
      graceDays: 0,
    });
    const userId = await person();

    const requirement = await resolve(userId);
    expect(requirement.required).toBe(true);
    expect(requirement.overdue).toBe(true);
  });

  it("lets a company raise the bar, and never lower one already set", async () => {
    const userId = await person();

    // The company alone.
    await setCompanySetting(TWO_FACTOR_SETTINGS, DEMO_COMPANY_ID, {
      mode: "required",
      requireForSuperadmins: false,
      graceDays: 7,
    });
    expect((await resolve(userId)).required).toBe(true);
    // ...and not for somebody working in a different company today.
    expect((await resolve(userId, null)).required).toBe(false);

    // The installation requires it; the company says "optional" and is ignored.
    await setSystemSetting(TWO_FACTOR_SETTINGS, {
      mode: "required",
      requireForSuperadmins: false,
      graceDays: 7,
    });
    await setCompanySetting(TWO_FACTOR_SETTINGS, DEMO_COMPANY_ID, {
      mode: "optional",
      requireForSuperadmins: false,
      graceDays: 7,
    });
    expect((await resolve(userId)).required).toBe(true);
  });

  it("requires it of superadmins only when their own switch is on", async () => {
    const userId = await person();
    const asSuperadmin = () =>
      twoFactorRequirement({ userId, companyId: DEMO_COMPANY_ID, isSuperadmin: true });

    expect((await asSuperadmin()).required).toBe(false);

    await setSystemSetting(TWO_FACTOR_SETTINGS, {
      mode: "optional",
      requireForSuperadmins: true,
      graceDays: 7,
    });
    expect((await asSuperadmin()).required).toBe(true);
  });

  it("stops asking the moment they enrol, and forgets the clock if it stops applying", async () => {
    const userId = await person();
    const groupId = await putInGroup(userId, "Admins", true);
    await resolve(userId);

    await db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, userId));
    const enrolled = await resolve(userId);
    expect(enrolled).toMatchObject({ required: true, enrolled: true, overdue: false });

    // Requirement withdrawn: the clock is cleared, so if it ever comes back they get
    // the full grace period again rather than a deadline they have already missed.
    await db.update(users).set({ twoFactorEnabled: false }).where(eq(users.id, userId));
    await db.update(groups).set({ requiresTwoFactor: false }).where(eq(groups.id, groupId));
    expect(await resolve(userId)).toMatchObject({ required: false, since: null });

    const [row] = await db
      .select({ since: users.twoFactorRequiredSince })
      .from(users)
      .where(eq(users.id, userId));
    expect(row!.since).toBeNull();
  });
});
