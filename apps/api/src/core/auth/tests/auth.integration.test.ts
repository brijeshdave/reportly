// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for authentication + context resolution, exercised through
// fastify.inject against the dedicated test database (see test/global-setup.ts).
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { API_PREFIX, buildApp } from "@/core/app.js";
import { db } from "@/core/db/index.js";
import { groupRoles, groupUsers, groups, roles, userCompanies } from "@/core/db/schema.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const SUPERADMIN_EMAIL = "admin@reportly.local";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDb();
});

/** Extract the `name=value` pairs from a response's Set-Cookie header. */
function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => String(c).split(";")[0]).join("; ");
}

async function signUp(email: string, password: string, name: string) {
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email, password, name },
  });
  return { res, cookie: cookieFrom(res), body: res.json() as { user?: { id?: string } } };
}

async function signIn(email: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email, password },
  });
  return { res, cookie: cookieFrom(res) };
}

function getMe(cookie: string, companyId?: string) {
  const headers: Record<string, string> = { cookie };
  if (companyId) headers["x-company-id"] = companyId;
  return app.inject({ method: "GET", url: `${API_PREFIX}/me`, headers });
}

describe("auth + /me", () => {
  it("rejects /me without a session", async () => {
    const res = await getMe("");
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("signs up, then /me shows the user with no groups or permissions", async () => {
    const { res, cookie } = await signUp("tech@acme.test", "S3curePass!23", "Tech");
    expect(res.statusCode).toBe(200);
    const me = await getMe(cookie);
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.user.email).toBe("tech@acme.test");
    expect(body.isSuperadmin).toBe(false);
    expect(body.permissions).toEqual([]);
    expect(body.companies).toEqual([]);
  });

  it("superadmin login resolves all permissions", async () => {
    const password = await resetSuperadmin();
    const { cookie } = await signIn(SUPERADMIN_EMAIL, password);
    const body = (await getMe(cookie, DEMO_COMPANY_ID)).json();
    expect(body.isSuperadmin).toBe(true);
    expect(body.permissions).toContain("users:reset-password");
    expect(body.permissions).toContain("roles:clone");
    expect(body.companies.map((c: { id: string }) => c.id)).toContain(DEMO_COMPANY_ID);
    expect(body.locationIds).toBe("all");
  });

  it("denies a company the user has no group in", async () => {
    const { cookie } = await signUp("outsider@acme.test", "S3curePass!23", "Outsider");
    const res = await getMe(cookie, DEMO_COMPANY_ID);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("resolves scoped permissions for a Member of a company", async () => {
    const { cookie, body } = await signUp("member@acme.test", "S3curePass!23", "Member");
    const userId = body.user!.id!;

    // Provision: a group with the seeded Member role, and the demo company on the
    // person — a group grants what they may do, the user record grants where.
    const [memberRole] = await db.select().from(roles).where(eq(roles.name, "Member"));
    const [group] = await db.insert(groups).values({ name: "Acme Members" }).returning();
    await db.insert(groupRoles).values({ groupId: group.id, roleId: memberRole.id });
    await db.insert(groupUsers).values({ groupId: group.id, userId });
    await db.insert(userCompanies).values({ userId, companyId: DEMO_COMPANY_ID });

    const me = (await getMe(cookie, DEMO_COMPANY_ID)).json();
    expect(me.isSuperadmin).toBe(false);
    expect(me.permissions).toContain("users:read");
    expect(me.permissions).not.toContain("users:reset-password");
    expect(me.locationIds).toBe("all");
  });
});
