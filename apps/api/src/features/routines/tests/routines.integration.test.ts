// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for routine definitions: a manager creates one for their downline,
// cannot assign outside it, a member cannot manage, and the assigned/managed lists show
// the right routines.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { awardAllCompaniesBefore, awardAllCompaniesForMonth } from "@/features/routines/service.js";
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
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
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

/** A manager (boss) with one direct report (ravi) and an unrelated member (sam). */
async function fixture(admin: string) {
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
  return { boss, ravi, sam, dept };
}

const daily = (departmentId: string, assigneeIds: string[]) => ({
  title: "Boiler check",
  cadence: "daily",
  points: 2,
  startDate: "2026-08-01",
  departmentId,
  assigneeIds,
});

describe("routines", () => {
  it("a manager creates a routine for their downline; a member cannot manage", async () => {
    const admin = await superadmin();
    const { boss, ravi, dept } = await fixture(admin);

    const created = await inject("POST", "/routines", boss.cookie, daily(dept.id, [ravi.id]));
    expect(created.statusCode).toBe(201);
    expect(created.json().assignees.map((a: { userId: string }) => a.userId)).toEqual([ravi.id]);
    expect(created.json()).toMatchObject({ departmentId: dept.id, departmentName: "Ops" });

    // The member sees it in their assigned list, and the manager in their managed list.
    expect((await inject("GET", "/routines", ravi.cookie)).json()).toHaveLength(1);
    expect((await inject("GET", "/routines/managed", boss.cookie)).json().total).toBe(1);
    // The member has no manage rights.
    expect(
      (await inject("POST", "/routines", ravi.cookie, daily(dept.id, [ravi.id]))).statusCode,
    ).toBe(403);
  });

  it("logs a completion with user-entered times (on time), and shows a missed day", async () => {
    const admin = await superadmin();
    const { boss, ravi, dept } = await fixture(admin);
    // A daily routine starting a week ago, so there are past occurrences to miss.
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

    const dates = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const today = dates(0);

    // Ravi logs today's occurrence with the times he entered by hand.
    const finished = await inject(
      "POST",
      `/routines/${id}/occurrences/${today}/finish`,
      ravi.cookie,
      {
        startedAt: `${today}T08:00:00.000Z`,
        finishedAt: `${today}T09:00:00.000Z`,
        notes: "All good",
      },
    );
    expect(finished.json()).toMatchObject({ status: "completed", onTime: true, notes: "All good" });

    // Re-logging the same occurrence corrects it in place (no duplicate).
    const relog = await inject("POST", `/routines/${id}/occurrences/${today}/finish`, ravi.cookie, {
      finishedAt: `${today}T10:30:00.000Z`,
      notes: "Redone",
    });
    expect(relog.json()).toMatchObject({ id: finished.json().id, notes: "Redone" });

    // Someone not assigned cannot log it.
    expect(
      (
        await inject("POST", `/routines/${id}/occurrences/${today}/finish`, boss.cookie, {
          finishedAt: `${today}T09:00:00.000Z`,
        })
      ).statusCode,
    ).toBe(403);

    // The occurrence list shows today's as completed and a past day as missed.
    const occ = (
      await inject("GET", `/routines/occurrences?from=${dates(-3)}&to=${dates(1)}`, ravi.cookie)
    ).json();
    expect(occ.find((o: { date: string }) => o.date === today).state).toBe("completed");
    expect(occ.find((o: { date: string }) => o.date === dates(-3)).state).toBe("missed");
  });

  it("expires an occurrence past its grace window", async () => {
    const admin = await superadmin();
    const { boss, ravi, dept } = await fixture(admin);
    const id = (
      await inject("POST", "/routines", boss.cookie, {
        title: "Boiler check",
        cadence: "daily",
        points: 2,
        startDate: "2020-01-01",
        departmentId: dept.id,
        graceDays: 1,
        assigneeIds: [ravi.id],
      })
    ).json().id;
    const dstr = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const now = new Date().toISOString();

    // Three days ago with a one-day grace: expired, so logging is refused.
    expect(
      (
        await inject("POST", `/routines/${id}/occurrences/${dstr(-3)}/finish`, ravi.cookie, {
          finishedAt: now,
        })
      ).statusCode,
    ).toBe(403);
    // Today is still open.
    expect(
      (
        await inject("POST", `/routines/${id}/occurrences/${dstr(0)}/finish`, ravi.cookie, {
          finishedAt: now,
        })
      ).statusCode,
    ).toBe(200);

    // The occurrence list marks the expired day locked, today's open.
    const occ = (
      await inject("GET", `/routines/occurrences?from=${dstr(-4)}&to=${dstr(1)}`, ravi.cookie)
    ).json();
    expect(occ.find((o: { date: string }) => o.date === dstr(-3)).locked).toBe(true);
    expect(occ.find((o: { date: string }) => o.date === dstr(0)).locked).toBe(false);
  });

  it("awards a month's points (on-time full, late half), idempotently, and reports it", async () => {
    const admin = await superadmin();
    const { boss, ravi, dept } = await fixture(admin);
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

    const dstr = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const now = new Date();
    // Today finished now = on time; yesterday finished now = late.
    await inject("POST", `/routines/${id}/occurrences/${dstr(0)}/finish`, ravi.cookie, {
      finishedAt: now.toISOString(),
    });
    await inject("POST", `/routines/${id}/occurrences/${dstr(-1)}/finish`, ravi.cookie, {
      finishedAt: now.toISOString(),
    });

    // Both occurrences fall in the current month only if today is not the 1st; guard.
    const sameMonth = new Date(dstr(-1)).getMonth() === now.getMonth();
    const award = await inject(
      "POST",
      `/routines/award?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
      boss.cookie,
    );
    expect(award.statusCode).toBe(200);
    // Today on-time (2) plus yesterday late (1) when both are this month.
    expect(award.json().count).toBe(sameMonth ? 2 : 1);
    expect(award.json().points).toBe(sameMonth ? 3 : 2);
    // Idempotent: a second run awards nothing more.
    expect(
      (
        await inject(
          "POST",
          `/routines/award?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
          boss.cookie,
        )
      ).json().count,
    ).toBe(0);

    // The routine log shows the completions.
    const log = await inject("POST", "/reports/run", boss.cookie, {
      definition: {
        source: "routine_log",
        range: "custom",
        from: `${dstr(-1)}T00:00:00.000Z`,
        to: `${dstr(1)}T00:00:00.000Z`,
        grouping: "none",
        columns: ["date"],
        filters: {},
      },
    });
    expect(log.json().groups.flatMap((g: { rows: unknown[] }) => g.rows)).toHaveLength(2);

    // Compliance: 2 due, 2 completed, 0 missed for Ravi.
    const comp = await inject("POST", "/reports/run", boss.cookie, {
      definition: {
        source: "routine_compliance",
        range: "custom",
        from: `${dstr(-1)}T00:00:00.000Z`,
        to: `${dstr(1)}T00:00:00.000Z`,
        grouping: "none",
        columns: ["person"],
        filters: {},
      },
    });
    const row = comp
      .json()
      .groups.flatMap((g: { rows: { cells: Record<string, string> }[] }) => g.rows)
      .find((r: { cells: Record<string, string> }) => r.cells.person === "ravi");
    expect(row).toMatchObject({
      cells: expect.objectContaining({ due: "2", completed: "2", missed: "0" }),
    });
  });

  it("the monthly run awards every company's routine points, idempotently", async () => {
    const admin = await superadmin();
    const { boss, ravi, dept } = await fixture(admin);
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
    const today = new Date().toISOString().slice(0, 10);
    await inject("POST", `/routines/${id}/occurrences/${today}/finish`, ravi.cookie, {
      finishedAt: new Date().toISOString(),
    });

    const now = new Date();
    // The scheduled run (all companies) credits the pending completion.
    const run = await awardAllCompaniesForMonth(now.getFullYear(), now.getMonth() + 1);
    expect(run.count).toBeGreaterThanOrEqual(1);
    expect(run.points).toBeGreaterThanOrEqual(2);

    // A manual re-run for the same month now finds nothing left to award.
    const manual = await inject(
      "POST",
      `/routines/award?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
      boss.cookie,
    );
    expect(manual.json().count).toBe(0);
  });

  it("catches up an unawarded prior month, leaving the open month for the monthly run", async () => {
    const admin = await superadmin();
    const { boss, ravi, dept } = await fixture(admin);
    // A generous grace so a last-month occurrence is still loggable here (daily, so the
    // next-occurrence lock does not apply).
    const id = (
      await inject("POST", "/routines", boss.cookie, {
        title: "Boiler check",
        cadence: "daily",
        points: 2,
        startDate: "2020-01-01",
        departmentId: dept.id,
        graceDays: 366,
        assigneeIds: [ravi.id],
      })
    ).json().id;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const m = now.getMonth() === 0 ? 12 : now.getMonth(); // last month, 1-based
    const lastMonthDay = `${y}-${pad(m)}-15`;
    const today = now.toISOString().slice(0, 10);
    await inject("POST", `/routines/${id}/occurrences/${lastMonthDay}/finish`, ravi.cookie, {
      finishedAt: now.toISOString(),
    });
    await inject("POST", `/routines/${id}/occurrences/${today}/finish`, ravi.cookie, {
      finishedAt: now.toISOString(),
    });

    // Catch up everything before this month — awards last month, not the open one.
    const firstOfThisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    const caught = await awardAllCompaniesBefore(firstOfThisMonth);
    expect(caught.count).toBeGreaterThanOrEqual(1);

    // The current month's completion was left untouched — the monthly run still finds it.
    const thisMonth = await inject(
      "POST",
      `/routines/award?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
      boss.cookie,
    );
    expect(thisMonth.json().count).toBeGreaterThanOrEqual(1);
  });

  it("refuses to assign a routine outside the manager's downline", async () => {
    const admin = await superadmin();
    const { boss, sam, dept } = await fixture(admin);
    // Sam reports to nobody under boss, so boss may not assign to them.
    expect(
      (await inject("POST", "/routines", boss.cookie, daily(dept.id, [sam.id]))).statusCode,
    ).toBe(403);
  });

  it("edits a routine, and only its owner may", async () => {
    const admin = await superadmin();
    const { boss, ravi, dept } = await fixture(admin);
    const id = (await inject("POST", "/routines", boss.cookie, daily(dept.id, [ravi.id]))).json()
      .id;

    const updated = await inject("PATCH", `/routines/${id}`, boss.cookie, {
      title: "Boiler + pressure check",
      points: 3,
    });
    expect(updated.json()).toMatchObject({ title: "Boiler + pressure check", points: 3 });

    // Another manager cannot edit boss's routine.
    const other = await makeUser(admin, "otherboss", await makeGroup(admin, "M2", "Manager"));
    expect(
      (await inject("PATCH", `/routines/${id}`, other.cookie, { title: "Hijack" })).statusCode,
    ).toBe(403);
  });

  it("lists the routines a manager owns as a filtered, sorted, paged table", async () => {
    const admin = await superadmin();
    const { boss, ravi, dept } = await fixture(admin);

    // A second report for boss, and two sites to tell the two apart by.
    const priya = await makeUser(admin, "priya", await makeGroup(admin, "Members2", "Member"));
    const kim = (
      await inject("POST", "/locations", admin, { companyId: DEMO_COMPANY_ID, name: "Kim" })
    ).json();
    const kosamba = (
      await inject("POST", "/locations", admin, { companyId: DEMO_COMPANY_ID, name: "Kosamba" })
    ).json();
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [
        { userId: boss.id, rank: "lead", reportsToId: null, locationIds: [kim.id, kosamba.id] },
        { userId: ravi.id, rank: "member", reportsToId: boss.id, locationIds: [kim.id] },
        { userId: priya.id, rank: "member", reportsToId: boss.id, locationIds: [kosamba.id] },
      ],
    });

    await inject("POST", "/routines", boss.cookie, {
      ...daily(dept.id, [ravi.id]),
      title: "Boiler check",
    });
    await inject("POST", "/routines", boss.cookie, {
      ...daily(dept.id, [priya.id]),
      title: "Air filter swap",
      cadence: "weekly",
      anchorWeekday: 1,
    });

    const page = (await inject("GET", "/routines/managed?page=1&pageSize=5", boss.cookie)).json();
    expect(page).toMatchObject({ total: 2, page: 1, hasNext: false });
    // Default sort is by title, ascending.
    expect(page.data.map((r: { title: string }) => r.title)).toEqual([
      "Air filter swap",
      "Boiler check",
    ]);
    expect(page.data[0].assignees).toHaveLength(1);

    const filtered = async (filters: unknown) =>
      (
        await inject(
          "GET",
          `/routines/managed?filters=${encodeURIComponent(JSON.stringify(filters))}`,
          boss.cookie,
        )
      ).json();

    // A column filter, and the two that are not columns: who does it, and where they work.
    expect(
      (await filtered([{ field: "cadence", op: "eq", value: "weekly" }])).data.map(
        (r: { title: string }) => r.title,
      ),
    ).toEqual(["Air filter swap"]);
    expect(
      (await filtered([{ field: "assigneeId", op: "in", value: [ravi.id] }])).data.map(
        (r: { title: string }) => r.title,
      ),
    ).toEqual(["Boiler check"]);
    expect(
      (await filtered([{ field: "locationId", op: "in", value: [kosamba.id] }])).data.map(
        (r: { title: string }) => r.title,
      ),
    ).toEqual(["Air filter swap"]);

    // The page respects its size, and reports what is left.
    const first = (await inject("GET", "/routines/managed?pageSize=5&page=1", boss.cookie)).json();
    expect(first.data).toHaveLength(2);
    expect(first.totalPages).toBe(1);

    // Another manager's table is empty — the list is still what *you* manage.
    const other = await makeUser(admin, "othermgr", await makeGroup(admin, "M3", "Manager"));
    expect((await inject("GET", "/routines/managed", other.cookie)).json().total).toBe(0);
  });
});
