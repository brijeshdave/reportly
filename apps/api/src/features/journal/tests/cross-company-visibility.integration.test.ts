// Author: Brijesh Dave <https://github.com/brijeshdave>
// Can a journal entry be read from a company the caller has no access to?
//
// The question comes from reading the visibility rule rather than from a report.
// `isVisible` admits an entry when its author is in the caller's downline, and
// the downline is walked by `downlineUserIds`, which recurses `department_users`
// with **no company filter at all**. A single "reports to" edge is refused across
// companies — but a person who belongs to a department in each is a bridge the
// recursion crosses without noticing.
//
// So: A manages X in company A. X also manages J in company B. Does the recursion
// hand the manager somebody in a company they hold nothing in — and if it does,
// does anything else stop them reading that person's work?
//
// The unplaced case is the one to press. Location narrows visibility, but a NULL
// location is deliberately visible to everyone (it is what made SF-004's migration
// a no-op), so an entry with no site has only the reporting line defending it.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
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

function inject(method: string, url: string, cookie: string, company: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": company },
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

async function makeGroup(admin: string, name: string, roleName: string): Promise<string> {
  const group = (await inject("POST", "/groups", admin, COMPANY_A, { name })).json();
  const roles = (await inject("GET", "/roles", admin, COMPANY_A)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, COMPANY_A, { ids: [role.id] });
  return group.id as string;
}

async function makeUser(
  admin: string,
  name: string,
  username: string,
  groupId: string,
  companies: string[],
): Promise<{ id: string; cookie: string }> {
  const created = await inject("POST", "/users", admin, COMPANY_A, {
    name,
    email: `${username}@reportly.test`,
    username,
    password: TEMP_PW,
  });
  const id = created.json().id as string;
  await inject("PUT", `/users/${id}/companies`, admin, COMPANY_A, { ids: companies });

  const assignments = (
    await inject("GET", `/groups/${groupId}/assignments`, admin, COMPANY_A)
  ).json();
  await inject("PUT", `/groups/${groupId}/users`, admin, COMPANY_A, {
    ids: [...assignments.users, id],
  });

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

describe("a reporting line that bridges two companies", () => {
  it("does not hand a manager an entry from a company they hold nothing in", async () => {
    const admin = await superadmin();

    // A second company, which `manager` will never be given access to.
    const companyB = (
      await inject("POST", "/companies", admin, COMPANY_A, { name: "Beta Ltd" })
    ).json();

    const staff = await makeGroup(admin, "Staff", "Manager");

    // The manager: company A only.
    const manager = await makeUser(admin, "Meera Manager", "meera", staff, [COMPANY_A]);
    // The bridge: a real person who works for both companies.
    const bridge = await makeUser(admin, "Bridge Person", "bridge", staff, [
      COMPANY_A,
      companyB.id,
    ]);
    // The junior: company B only, and the author of the entry in question.
    const junior = await makeUser(admin, "Jai Junior", "jai", staff, [companyB.id]);

    // Company A's department: bridge reports to manager.
    const deptA = (await inject("POST", "/departments", admin, COMPANY_A, { name: "IT A" })).json();
    await inject("PUT", `/departments/${deptA.id}/members`, admin, COMPANY_A, {
      members: [
        { userId: manager.id, rank: "hod", reportsToId: null, locationIds: [] },
        { userId: bridge.id, rank: "member", reportsToId: manager.id, locationIds: [] },
      ],
    });

    // Company B's department: junior reports to the same bridge person.
    const deptB = (
      await inject("POST", "/departments", admin, companyB.id, { name: "IT B" })
    ).json();
    await inject("PUT", `/departments/${deptB.id}/members`, admin, companyB.id, {
      members: [
        { userId: bridge.id, rank: "hod", reportsToId: null, locationIds: [] },
        { userId: junior.id, rank: "member", reportsToId: bridge.id, locationIds: [] },
      ],
    });

    // The junior files a work log in company B, with no site on it — the case
    // where the location rule deliberately does not narrow anything.
    const filed = await inject("POST", "/journal", junior.cookie, companyB.id, {
      kind: "work",
      title: "Company B internal work",
      summary: "Nothing to do with company A",
      reportDate: new Date().toISOString().slice(0, 10),
      state: "submitted",
    });
    expect(filed.statusCode, JSON.stringify(filed.json())).toBe(201);
    const entryId = filed.json().id as string;

    // The manager holds no access to company B whatsoever.
    const asManagerInB = await inject("GET", `/journal/${entryId}`, manager.cookie, companyB.id);
    expect(asManagerInB.statusCode).not.toBe(200);

    // And asking with their own company in the header must not launder it either:
    // the id is the caller's to supply, and the company header is not a permission.
    const asManagerInA = await inject("GET", `/journal/${entryId}`, manager.cookie, COMPANY_A);
    expect(
      asManagerInA.statusCode,
      `manager read a company-B entry: ${JSON.stringify(asManagerInA.json())}`,
    ).toBe(404);
  });
});
