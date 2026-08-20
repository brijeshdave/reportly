// Author: Brijesh Dave <https://github.com/brijeshdave>
// Deactivating a user is how an administrator removes someone's access. The
// column was written, displayed and documented — and read by nothing, so a
// deactivated user kept every permission and could sign in again. Each of the
// three ways back in is pinned here.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { db } from "@/core/db/index.js";
import { users } from "@/core/db/schema.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const EMAIL = "member@acme.test";
const PASSWORD = "Sup3rSecretPass";

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

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => String(c).split(";")[0]).join("; ");
}

const signIn = (email: string, password: string) =>
  app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email, password },
  });

async function superadmin(): Promise<string> {
  const password = await resetSuperadmin();
  return cookieFrom(await signIn("admin@reportly.local", password));
}

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

/** A signed-up member with real permissions, and their live session cookie. */
async function member(adminCookie: string): Promise<{ id: string; cookie: string }> {
  const signUp = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email: EMAIL, password: PASSWORD, name: "Member" },
  });
  const cookie = cookieFrom(signUp);
  const id = (signUp.json() as { user: { id: string } }).user.id;

  const group = (await inject("POST", "/groups", adminCookie, { name: "Staff" })).json();
  const manager = (await inject("GET", "/roles?pageSize=100", adminCookie))
    .json()
    .data.find((role: { name: string }) => role.name === "Manager");

  await inject("PUT", `/groups/${group.id}/roles`, adminCookie, { ids: [manager.id] });
  await inject("PUT", `/groups/${group.id}/users`, adminCookie, { ids: [id] });
  // Company access belongs to the person now, not to their group.
  await inject("PUT", `/users/${id}/companies`, adminCookie, { ids: [DEMO_COMPANY_ID] });

  return { id, cookie };
}

describe("an active user", () => {
  it("can use the permissions their groups grant", async () => {
    const admin = await superadmin();
    const { cookie } = await member(admin);

    expect((await inject("GET", "/users", cookie)).statusCode).toBe(200);
  });
});

describe("deactivation", () => {
  it("kills the session they already hold", async () => {
    const admin = await superadmin();
    const { id, cookie } = await member(admin);
    expect((await inject("GET", "/users", cookie)).statusCode).toBe(200);

    await inject("POST", `/users/${id}/deactivate`, admin);

    // Not "when the session expires" — now. The session is revoked outright, so
    // this reads as an ordinary missing session.
    expect((await inject("GET", "/users", cookie)).statusCode).toBe(401);
  });

  it("refuses a session that outlives revocation", async () => {
    // Defence in depth: if the status is changed without going through the
    // service — a manual UPDATE, a future endpoint — the live session must still
    // be refused rather than keep working until it expires.
    const admin = await superadmin();
    const { id, cookie } = await member(admin);

    await db.update(users).set({ status: "inactive" }).where(eq(users.id, id));

    const res = await inject("GET", "/users", cookie);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toContain("deactivated");
  });

  it("refuses even /me, which an expired password may still reach", async () => {
    const admin = await superadmin();
    const { id, cookie } = await member(admin);
    await inject("POST", `/users/${id}/deactivate`, admin);

    expect((await inject("GET", "/me", cookie)).statusCode).toBe(401);
  });

  it("stops them signing in again, even with the right password", async () => {
    const admin = await superadmin();
    const { id } = await member(admin);
    await inject("POST", `/users/${id}/deactivate`, admin);

    const res = await signIn(EMAIL, PASSWORD);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);

    // No session was issued, so nothing to carry.
    expect(cookieFrom(res)).not.toContain("session_token");
  });

  it("revokes every session, not just the one that was used", async () => {
    const admin = await superadmin();
    const { id, cookie } = await member(admin);
    // A second device.
    const other = cookieFrom(await signIn(EMAIL, PASSWORD));

    await inject("POST", `/users/${id}/deactivate`, admin);

    expect((await inject("GET", "/users", cookie)).statusCode).toBe(401);
    expect((await inject("GET", "/users", other)).statusCode).toBe(401);
  });

  it("gives back access on reactivation", async () => {
    const admin = await superadmin();
    const { id } = await member(admin);
    await inject("POST", `/users/${id}/deactivate`, admin);
    await inject("POST", `/users/${id}/reactivate`, admin);

    const cookie = cookieFrom(await signIn(EMAIL, PASSWORD));
    expect((await inject("GET", "/users", cookie)).statusCode).toBe(200);
  });

  it("never deactivates the last superadmin", async () => {
    const admin = await superadmin();
    const me = (await inject("GET", "/me", admin)).json();

    const res = await inject("POST", `/users/${me.user.id}/deactivate`, admin);
    expect(res.statusCode).toBe(400);
    expect((await inject("GET", "/users", admin)).statusCode).toBe(200);
  });
});

describe("placing a person from their own page", () => {
  it("sets their groups, and the effective access follows", async () => {
    const adminCookie = await superadmin();
    const { id } = await member(adminCookie);

    // They start in the group provisionMember put them in.
    const before = (await inject("GET", `/users/${id}/access`, adminCookie)).json();
    expect(before.roles.map((r: { name: string }) => r.name)).toContain("Manager");

    // Taking every group away leaves them with nothing — the effective view is
    // derived from the groups, so it must move with them.
    expect((await inject("PUT", `/users/${id}/groups`, adminCookie, { ids: [] })).statusCode).toBe(
      200,
    );
    const after = (await inject("GET", `/users/${id}/access`, adminCookie)).json();
    expect(after.roles).toEqual([]);
    expect(after.permissions).toEqual([]);
  });

  it("puts them in a department without disturbing anyone else in it", async () => {
    const adminCookie = await superadmin();
    const { id } = await member(adminCookie);
    const other = (
      await inject("POST", "/users/invite", adminCookie, {
        email: "other@acme.test",
        name: "Other",
      })
    ).json();

    const dept = (await inject("POST", "/departments", adminCookie, { name: "Assembly" })).json();
    await inject("PUT", `/departments/${dept.id}/members`, adminCookie, {
      members: [{ userId: other.id, rank: "lead" }],
    });

    // Adding one person from their own page must leave the lead exactly as they were.
    const res = await inject("PUT", `/users/${id}/departments`, adminCookie, {
      departments: [{ departmentId: dept.id, rank: "member" }],
    });
    expect(res.statusCode).toBe(200);

    const members = (await inject("GET", `/departments/${dept.id}/members`, adminCookie)).json();
    expect(members).toHaveLength(2);
    expect(members.find((m: { userId: string }) => m.userId === other.id).rank).toBe("lead");
    expect(members.find((m: { userId: string }) => m.userId === id).rank).toBe("member");
  });

  it("sets the reporting line and sites from the user's own page", async () => {
    // These used to be reachable only from the department's Members tab, so
    // setting one person up across three departments meant three screens.
    const adminCookie = await superadmin();
    const { id } = await member(adminCookie);
    const boss = (
      await inject("POST", "/users/invite", adminCookie, { email: "boss@acme.test", name: "Boss" })
    ).json();
    const site = (await inject("POST", "/locations", adminCookie, { name: "Plant 9" })).json();

    const dept = (await inject("POST", "/departments", adminCookie, { name: "Packing" })).json();
    await inject("PUT", `/departments/${dept.id}/members`, adminCookie, {
      members: [{ userId: boss.id, rank: "hod" }],
    });

    const res = await inject("PUT", `/users/${id}/departments`, adminCookie, {
      departments: [
        { departmentId: dept.id, rank: "member", reportsToId: boss.id, locationIds: [site.id] },
      ],
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);

    const members = (await inject("GET", `/departments/${dept.id}/members`, adminCookie)).json();
    const mine = members.find((m: { userId: string }) => m.userId === id);
    expect(mine.reportsToId).toBe(boss.id);
    expect(mine.locationIds).toEqual([site.id]);
  });

  it("leaves the line and the sites alone when they are not given", async () => {
    // The distinction the optional fields exist for: omitted is not null. A bulk
    // "put them in these departments" call must not flatten a reporting line
    // somebody built one department at a time.
    const adminCookie = await superadmin();
    const { id } = await member(adminCookie);
    const boss = (
      await inject("POST", "/users/invite", adminCookie, {
        email: "chief@acme.test",
        name: "Chief",
      })
    ).json();
    const site = (await inject("POST", "/locations", adminCookie, { name: "Plant 10" })).json();

    const dept = (await inject("POST", "/departments", adminCookie, { name: "Dispatch" })).json();
    await inject("PUT", `/departments/${dept.id}/members`, adminCookie, {
      members: [
        { userId: boss.id, rank: "hod" },
        { userId: id, rank: "member", reportsToId: boss.id, locationIds: [site.id] },
      ],
    });

    // Only the rank is sent — a rename of their place, not of their line.
    await inject("PUT", `/users/${id}/departments`, adminCookie, {
      departments: [{ departmentId: dept.id, rank: "lead" }],
    });

    const members = (await inject("GET", `/departments/${dept.id}/members`, adminCookie)).json();
    const mine = members.find((m: { userId: string }) => m.userId === id);
    expect(mine.rank).toBe("lead");
    expect(mine.reportsToId).toBe(boss.id);
    expect(mine.locationIds).toEqual([site.id]);
  });
});
