// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the self-serve points views. The rows are scoped to the caller's
// reporting line — a member sees only their own points, an unrelated member sees nothing
// of theirs, and a manager (who also holds analytics:view) sees the whole company.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
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

async function makeGroup(admin: string, name: string, roleName: string): Promise<string> {
  const group = (await inject("POST", "/groups", admin, { name })).json();
  const roles = (await inject("GET", "/roles", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
}

async function makeUser(admin: string, username: string, groupId: string) {
  const created = await inject("POST", "/users", admin, {
    name: username,
    email: `${username}@reportly.test`,
    username,
    password: TEMP_PW,
  });
  const id = created.json().id as string;
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

/** A manager (boss) with a direct report (ravi) who earns routine points, and an
 *  unrelated member (sam). Ravi finishes an occurrence, boss awards the month. */
async function fixtureWithPoints(admin: string) {
  const managerGroup = await makeGroup(admin, "Managers", "Manager");
  const memberGroup = await makeGroup(admin, "Members", "Member");
  const boss = await makeUser(admin, "boss", managerGroup);
  const ravi = await makeUser(admin, "ravi", memberGroup);
  const sam = await makeUser(admin, "sam", memberGroup);
  const dept = (await inject("POST", "/departments", admin, { name: "Ops" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [
      { userId: boss.id, rank: "lead", reportsToId: null },
      { userId: ravi.id, rank: "member", reportsToId: boss.id },
      { userId: sam.id, rank: "member", reportsToId: null },
    ],
  });

  const id = (
    await inject("POST", "/routines", boss.cookie, {
      title: "Boiler check",
      cadence: "daily",
      points: 2,
      startDate: "2020-01-01",
      departmentId: dept.id,
      assigneeIds: [ravi.id],
    })
  ).json().id;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  await inject("POST", `/routines/${id}/occurrences/${today}/finish`, ravi.cookie, {
    finishedAt: now.toISOString(),
  });
  await inject(
    "POST",
    `/routines/award?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
    boss.cookie,
  );

  return { boss, ravi, sam };
}

describe("points views", () => {
  it("a member sees their own points; an unrelated member sees none of them", async () => {
    const admin = await superadmin();
    const { ravi, sam } = await fixtureWithPoints(admin);

    const raviLedger = (await inject("GET", "/points/ledger?range=this_fy", ravi.cookie)).json();
    expect(
      raviLedger.rows.some(
        (r: { person: string; source: string }) => r.person === "ravi" && r.source === "routine",
      ),
    ).toBe(true);
    expect(raviLedger.total).toBeGreaterThanOrEqual(2);

    const raviSummary = (await inject("GET", "/points/summary?range=this_fy", ravi.cookie)).json();
    expect(
      raviSummary.rows.find((r: { name: string }) => r.name === "ravi").own,
    ).toBeGreaterThanOrEqual(2);

    // Sam is not on Ravi's line and has no points of their own — the ledger is empty.
    const samLedger = (await inject("GET", "/points/ledger?range=this_fy", sam.cookie)).json();
    expect(samLedger.rows).toHaveLength(0);
  });

  it("a manager (analytics viewer) sees the whole company's points", async () => {
    const admin = await superadmin();
    const { boss } = await fixtureWithPoints(admin);
    const ledger = (await inject("GET", "/points/ledger?range=this_fy", boss.cookie)).json();
    expect(ledger.rows.some((r: { person: string }) => r.person === "ravi")).toBe(true);
  });

  it("filters the ledger by source", async () => {
    const admin = await superadmin();
    const { ravi } = await fixtureWithPoints(admin);
    // Ravi's only points are from a routine, so a journal-only filter yields nothing.
    const journalOnly = (
      await inject("GET", "/points/ledger?range=this_fy&source=journal", ravi.cookie)
    ).json();
    expect(journalOnly.rows).toHaveLength(0);
    const routineOnly = (
      await inject("GET", "/points/ledger?range=this_fy&source=routine", ravi.cookie)
    ).json();
    expect(routineOnly.rows.length).toBeGreaterThanOrEqual(1);
  });
});
