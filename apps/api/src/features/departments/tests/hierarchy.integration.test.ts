// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the reporting line — the hierarchy report visibility will
// be computed from, so what it says has to be exactly right.
//
// The shape under test is the real one: Management above the Heads of Department,
// team leaders under an HOD (one of them covering two sites), and junior staff under
// the leaders.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const BOSS = "00000000-0000-0000-0000-000000000001"; // the seeded superadmin

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

async function superadmin(): Promise<string> {
  const password = await resetSuperadmin();
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: "admin@reportly.local", password },
  });
  return cookieFrom(res);
}

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

async function createDept(cookie: string, name: string, parentId?: string): Promise<string> {
  const res = await inject("POST", "/departments", cookie, { name, parentId });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

/** A user who can be put into the org. */
async function createUser(cookie: string, username: string): Promise<string> {
  const res = await inject("POST", "/users", cookie, {
    name: username,
    email: `${username}@reportly.test`,
    username,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

type Member = {
  userId: string;
  rank?: string;
  reportsToId?: string | null;
  locationIds?: string[];
};

function setMembers(cookie: string, departmentId: string, members: Member[]) {
  return inject("PUT", `/departments/${departmentId}/members`, cookie, { members });
}

describe("the reporting line", () => {
  it("builds Management → HOD → leads → juniors, and reports the whole downline", async () => {
    const cookie = await superadmin();

    const management = await createDept(cookie, "Exec Board");
    const engineering = await createDept(cookie, "Platform", management);

    const hod = await createUser(cookie, "asha");
    const leadA = await createUser(cookie, "ravi");
    const leadB = await createUser(cookie, "neha");
    const juniorA = await createUser(cookie, "sam");
    const juniorB = await createUser(cookie, "dev");

    // The boss sits in Management, reporting to nobody.
    expect((await setMembers(cookie, management, [{ userId: BOSS, rank: "hod" }])).statusCode).toBe(
      200,
    );

    // The HOD reports UP into Management — a different department, on purpose.
    const res = await setMembers(cookie, engineering, [
      { userId: hod, rank: "hod", reportsToId: BOSS },
      { userId: leadA, rank: "lead", reportsToId: hod },
      { userId: leadB, rank: "lead", reportsToId: hod },
      { userId: juniorA, rank: "member", reportsToId: leadA },
      { userId: juniorB, rank: "member", reportsToId: leadB },
    ]);
    expect(res.statusCode).toBe(200);

    // The boss sees everyone beneath him, at every depth — not just the HOD.
    const downline = (await inject("GET", `/users/${BOSS}/downline`, cookie)).json();
    const byUser = new Map(downline.map((d: { userId: string }) => [d.userId, d]));
    expect([...byUser.keys()].sort()).toEqual([hod, leadA, leadB, juniorA, juniorB].sort());
    expect(byUser.get(hod)).toMatchObject({ depth: 1, rank: "hod" });
    expect(byUser.get(leadA)).toMatchObject({ depth: 2, rank: "lead" });
    expect(byUser.get(juniorA)).toMatchObject({ depth: 3, rank: "member" });

    // A team leader sees only their own team.
    const leadDownline = (await inject("GET", `/users/${leadA}/downline`, cookie)).json();
    expect(leadDownline.map((d: { userId: string }) => d.userId)).toEqual([juniorA]);

    // A junior is below nobody.
    expect((await inject("GET", `/users/${juniorA}/downline`, cookie)).json()).toEqual([]);
  });

  it("lets one team leader cover several sites", async () => {
    const cookie = await superadmin();
    const dept = await createDept(cookie, "Support");
    const lead = await createUser(cookie, "priya");

    const sites = (await inject("GET", "/locations", cookie)).json();
    const [first, second] = sites.map((s: { id: string }) => s.id);

    const res = await setMembers(cookie, dept, [
      { userId: lead, rank: "lead", locationIds: [first, second] },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].locationIds.sort()).toEqual([first, second].sort());

    // No sites at all means "every site", not "no site".
    await setMembers(cookie, dept, [{ userId: lead, rank: "lead", locationIds: [] }]);
    const members = (await inject("GET", `/departments/${dept}/members`, cookie)).json();
    expect(members[0].locationIds).toEqual([]);
  });

  it("refuses a reporting line that loops", async () => {
    const cookie = await superadmin();
    const dept = await createDept(cookie, "Loops");
    const a = await createUser(cookie, "alfa");
    const b = await createUser(cookie, "bravo");

    // Straight to themselves.
    const self = await setMembers(cookie, dept, [{ userId: a, reportsToId: a }]);
    expect(self.statusCode).toBe(400);
    expect(self.json().error.message).toMatch(/cannot report to themselves/i);

    // Round in a circle: a → b → a.
    const circle = await setMembers(cookie, dept, [
      { userId: a, reportsToId: b },
      { userId: b, reportsToId: a },
    ]);
    expect(circle.statusCode).toBe(400);
    expect(circle.json().error.message).toMatch(/loops back/i);
  });

  it("refuses a manager who is not in the company's org, and a site that is not its own", async () => {
    const cookie = await superadmin();
    const dept = await createDept(cookie, "Strangers");
    const member = await createUser(cookie, "kiran");
    const outsider = await createUser(cookie, "nobody");

    // `outsider` exists as a user, but holds no membership anywhere in the company.
    const stranger = await setMembers(cookie, dept, [{ userId: member, reportsToId: outsider }]);
    expect(stranger.statusCode).toBe(400);
    expect(stranger.json().error.message).toMatch(/must belong to a department in this company/i);

    const foreignSite = await setMembers(cookie, dept, [
      { userId: member, locationIds: ["22222222-2222-2222-2222-2222222222ff"] },
    ]);
    expect(foreignSite.statusCode).toBe(400);
    expect(foreignSite.json().error.message).toMatch(/must be a location of this company/i);
  });

  it("drops the edge, not the people, when a manager leaves the department", async () => {
    const cookie = await superadmin();
    const dept = await createDept(cookie, "Churn");
    const lead = await createUser(cookie, "lead1");
    const junior = await createUser(cookie, "junior1");

    await setMembers(cookie, dept, [
      { userId: lead, rank: "lead" },
      { userId: junior, rank: "member", reportsToId: lead },
    ]);
    expect((await inject("GET", `/users/${lead}/downline`, cookie)).json()).toHaveLength(1);

    // Remove the lead; the junior stays, now reporting to nobody rather than to a
    // ghost — an edge pointing at somebody who has gone would silently drop them
    // out of every downline above them.
    await setMembers(cookie, dept, [{ userId: junior, rank: "member", reportsToId: null }]);

    const members = (await inject("GET", `/departments/${dept}/members`, cookie)).json();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: junior, reportsToId: null });
  });

  it("offers only people already in the org as manager candidates", async () => {
    const cookie = await superadmin();
    const dept = await createDept(cookie, "Roster");
    const inOrg = await createUser(cookie, "inorg");
    await createUser(cookie, "notinorg");

    await setMembers(cookie, dept, [{ userId: inOrg, rank: "member" }]);

    const people = (await inject("GET", "/departments/people", cookie)).json();
    const ids = people.map((p: { userId: string }) => p.userId);
    expect(ids).toContain(inOrg);
    expect(ids).not.toContain("notinorg");
    expect(people.find((p: { userId: string }) => p.userId === inOrg).departmentNames).toContain(
      "Roster",
    );
  });
});
