// Author: Brijesh Dave <https://github.com/brijeshdave>
// What a person may pick on a form they are allowed to use.
//
// Reported from a real account: somebody holding `journal:create`, in a department
// in each of two companies, opened a new journal entry and was told "You are not
// in a department yet", with the site reading "Not set" and the category picker
// disabled behind it. Nothing was wrong with their placement — the form was asking
// the *administrative* endpoints for the lists (`/users/:id/departments` behind
// departments:read, `/locations` behind locations:read), and a person who may file
// an entry has no reason to hold either.
//
// So these two answer for the caller alone, and need nothing but a session.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const SUPERADMIN_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEMP_PW = "Str0ngTempPass!x";
const OWN_PW = "TheirOwnP4ss!ok";

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

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

async function superadmin(): Promise<string> {
  const password = await resetSuperadmin();
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: "admin@reportly.local", password },
  });
  return cookieFrom(res);
}

async function makeUser(
  admin: string,
  name: string,
  username: string,
  groupId: string,
): Promise<{ id: string; cookie: string }> {
  const created = await inject("POST", "/users", admin, {
    name,
    email: `${username}@reportly.test`,
    username,
    password: TEMP_PW,
  });
  const id = created.json().id as string;
  // Company access belongs to the person now, not to their group.
  await inject("PUT", `/users/${id}/companies`, admin, { ids: [DEMO_COMPANY_ID] });

  const assignments = (await inject("GET", `/groups/${groupId}/assignments`, admin)).json();
  await inject("PUT", `/groups/${groupId}/users`, admin, { ids: [...assignments.users, id] });

  const gated = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/username`,
    payload: { username, password: TEMP_PW },
  });
  await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/change-password`,
    headers: { cookie: cookieFrom(gated) },
    payload: { currentPassword: TEMP_PW, newPassword: OWN_PW },
  });
  const clean = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/username`,
    payload: { username, password: OWN_PW },
  });
  return { id, cookie: cookieFrom(clean) };
}

describe("what the caller may pick", () => {
  /** Somebody who may file an entry and administer nothing. */
  async function reporter(admin: string): Promise<{ id: string; cookie: string }> {
    const role = (
      await inject("POST", "/roles", admin, {
        name: "Files entries only",
        permissions: ["journal:read", "journal:create"],
      })
    ).json();
    const group = (await inject("POST", "/groups", admin, { name: "Reporters only" })).json();
    await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
    return makeUser(admin, "Only Files", "onlyfiles", group.id);
  }

  it("gives them their own departments without departments:read", async () => {
    const admin = await superadmin();
    const person = await reporter(admin);
    const dept = (await inject("POST", "/departments", admin, { name: "Maintenance" })).json();
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [{ userId: person.id, rank: "member", reportsToId: null }],
    });

    // The administrative list is still closed to them...
    expect((await inject("GET", "/departments", person.cookie)).statusCode).toBe(403);
    expect((await inject("GET", `/users/${person.id}/departments`, person.cookie)).statusCode).toBe(
      403,
    );

    // ...while their own placement is theirs to see, which is what the form needs.
    const mine = await inject("GET", "/me/departments", person.cookie);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().map((d: { name: string }) => d.name)).toEqual(["Maintenance"]);
  });

  it("gives them the sites they may file against without locations:read", async () => {
    const admin = await superadmin();
    const person = await reporter(admin);
    await inject("POST", "/locations", admin, { name: "Plant A" });

    expect((await inject("GET", "/locations", person.cookie)).statusCode).toBe(403);

    const mine = await inject("GET", "/me/locations", person.cookie);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().map((l: { name: string }) => l.name)).toContain("Plant A");
  });

  it("answers for the caller only — never for somebody else", async () => {
    const admin = await superadmin();
    const person = await reporter(admin);
    const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
    // The *admin* is in this department; the reporter is not.
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [{ userId: SUPERADMIN_USER_ID, rank: "member", reportsToId: null }],
    });

    const mine = await inject("GET", "/me/departments", person.cookie);
    expect(mine.json()).toEqual([]);
  });
});
