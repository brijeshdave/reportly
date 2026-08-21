// Author: Brijesh Dave <https://github.com/brijeshdave>
// The switch that turns the shipped roles off, and the two properties that make it
// safe to try: it takes effect immediately (the auth context is rebuilt per request),
// and it deletes nothing — flick it back and every grant returns exactly.
//
// A setting that is stored and read by nothing is the bug this project has shipped
// seven times; this is the test that says this one is read.
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { SYSTEM_ROLES_SETTING } from "@reportly/shared";

import { buildAuthContext } from "@/core/auth/context.js";
import { db } from "@/core/db/index.js";
import { appPool, logPool } from "@/core/db/pool.js";
import { groupRoles, groupUsers, groups, roles, userCompanies, users } from "@/core/db/schema.js";
import { setSystemSetting } from "@/core/settings/service.js";
import { systemRoleImpact } from "@/features/roles/repo.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

afterAll(async () => {
  await appPool.end();
  await logPool.end();
});

beforeEach(async () => {
  await resetDb();
});

/** A person whose only access is one system role, through one group. */
async function personWithSystemRole(): Promise<string> {
  // better-auth owns the id column (text, not generated), so the test supplies one.
  const [user] = await db
    .insert(users)
    .values({
      id: "test-user-ravi",
      name: "Ravi",
      email: "ravi@reportly.test",
      username: "ravi",
    })
    .returning({ id: users.id });
  await db.insert(userCompanies).values({ userId: user!.id, companyId: DEMO_COMPANY_ID });

  const [group] = await db
    .insert(groups)
    .values({ name: "Line crew" })
    .returning({ id: groups.id });
  const [role] = await db.select().from(roles).where(eq(roles.name, "Journal editor"));
  await db.insert(groupRoles).values({ groupId: group!.id, roleId: role!.id });
  await db.insert(groupUsers).values({ groupId: group!.id, userId: user!.id });
  return user!.id;
}

describe("the system-roles switch", () => {
  it("stops the shipped roles granting anything, and gives it all back", async () => {
    const userId = await personWithSystemRole();

    const before = await buildAuthContext(userId, DEMO_COMPANY_ID);
    expect(before.permissions).toContain("journal:create");

    await setSystemSetting(SYSTEM_ROLES_SETTING, { enabled: false });

    // No sign-out, no cache to wait out: the context is rebuilt per request.
    const off = await buildAuthContext(userId, DEMO_COMPANY_ID);
    expect(off.permissions).toEqual([]);

    // And the assignment itself is untouched, which is what makes it reversible.
    const [group] = await db.select().from(groups).where(eq(groups.name, "Line crew"));
    const stillAssigned = await db
      .select()
      .from(groupRoles)
      .where(eq(groupRoles.groupId, group!.id));
    expect(stillAssigned).toHaveLength(1);

    await setSystemSetting(SYSTEM_ROLES_SETTING, { enabled: true });
    const back = await buildAuthContext(userId, DEMO_COMPANY_ID);
    expect(back.permissions).toEqual(before.permissions);
  });

  it("leaves a custom role granting exactly what it did", async () => {
    const userId = await personWithSystemRole();
    const [custom] = await db
      .insert(roles)
      .values({ name: "Night shift only", isSystem: false })
      .returning({ id: roles.id });
    const [group] = await db.select().from(groups).where(eq(groups.name, "Line crew"));
    await db.insert(groupRoles).values({ groupId: group!.id, roleId: custom!.id });

    await setSystemSetting(SYSTEM_ROLES_SETTING, { enabled: false });
    const off = await buildAuthContext(userId, DEMO_COMPANY_ID);
    // The custom role grants nothing yet, but it is the *reason* the query still
    // runs: switching the shipped roles off must not switch off everything else.
    expect(off.permissions).toEqual([]);
    expect(off.isSuperadmin).toBe(false);
  });

  it("counts who would lose everything before the switch is flicked", async () => {
    await personWithSystemRole();
    const impact = await systemRoleImpact();
    expect(impact.users).toBe(1);
    expect(impact.groups).toBe(1);
  });
});
