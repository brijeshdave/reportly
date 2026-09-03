// Author: Brijesh Dave <https://github.com/brijeshdave>
// The department workload reports: what each person did, and the days they were on
// the rota to do it in.
//
// Asked for as three views of one question — "which users has done how many issues,
// tasks, cartridges etc in seperate column with total", the same day by day, and
// "irregularity of a user if he has not worked for anything". The attribution rules
// are the whole report and none of them is visible in the output, which is why each
// one is pinned here: a unit of work counted twice, or for the wrong person, looks
// exactly like a busy month.
import { PARTS_MODULE } from "@reportly/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { setCompanySetting } from "@/core/settings/service.js";
import { resetDb } from "../../../../test/reset-db.js";
import { anySeverityId } from "../../../../test/seeded.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const TEMP_PW = "Str0ngTempPass!x";
const OWN_PW = "TheirOwnP4ss!ok";

let app: Awaited<ReturnType<typeof buildApp>>;
let admin: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
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

beforeEach(async () => {
  await resetDb();
  const password = await resetSuperadmin();
  admin = cookieFrom(
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/email`,
      payload: { email: "admin@reportly.local", password },
    }),
  );
  await setCompanySetting(PARTS_MODULE, DEMO_COMPANY_ID, { enabled: true, failureWindowDays: 14 });
});

async function makeUser(name: string, username: string, roleName: string) {
  const group = (await inject("POST", "/groups", admin, { name: `${username} group` })).json();
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });

  const created = await inject("POST", "/users", admin, {
    name,
    username,
    email: `${username}@reportly.test`,
    password: TEMP_PW,
  });
  const id = created.json().id as string;
  await inject("PUT", `/users/${id}/companies`, admin, { ids: [DEMO_COMPANY_ID] });
  const assignments = (await inject("GET", `/groups/${group.id}/assignments`, admin)).json();
  await inject("PUT", `/groups/${group.id}/users`, admin, { ids: [...assignments.users, id] });

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

/** A lead with two people under them, in one department. */
async function team() {
  const lead = await makeUser("Ravi Lead", "ravi", "Manager");
  const one = await makeUser("Sam Operator", "sam", "Member");
  const two = await makeUser("Anil Fitter", "anil", "Member");

  const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [
      { userId: lead.id, rank: "lead" },
      { userId: one.id, rank: "member", reportsToId: lead.id },
      { userId: two.id, rank: "member", reportsToId: lead.id },
    ],
  });
  return { lead, one, two, dept };
}

/** Put somebody in a group holding the workload reports, without widening the
 *  reporting line they read through. */
async function grantWorkloadReports(userId: string) {
  const group = (await inject("POST", "/groups", admin, { name: `Workload ${userId}` })).json();
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === "Workload reports viewer");
  expect(role, "the Workload reports viewer role should be seeded").toBeTruthy();
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  const assignments = (await inject("GET", `/groups/${group.id}/assignments`, admin)).json();
  await inject("PUT", `/groups/${group.id}/users`, admin, { ids: [...assignments.users, userId] });
}

/** Run a workload report over a window wide enough to hold anything filed today. */
async function run(cookie: string, source: string, extra: Record<string, unknown> = {}) {
  const now = new Date();
  const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const res = await inject("POST", "/reports/run", cookie, {
    definition: {
      source,
      range: "custom",
      from: from.toISOString(),
      to: to.toISOString(),
      grouping: "none",
      columns: ["person"],
      ...extra,
    },
  });
  return res;
}

/** Every row of every group, as a person → cells map. */
function rowsByPerson(body: {
  groups: { rows: { cells: Record<string, string> }[] }[];
}): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const group of body.groups) {
    for (const row of group.rows) out.set(row.cells.person!, row.cells);
  }
  return out;
}

/** File a resolved issue authored by `who`. */
async function fileIssue(who: { cookie: string }, title: string) {
  const filed = await inject("POST", "/journal", who.cookie, {
    kind: "issue",
    severityId: await anySeverityId(),
    title,
    state: "submitted",
    issueSummary: "It broke",
  });
  expect(filed.statusCode).toBe(201);
  return filed.json().id as string;
}

describe("the department workload report", () => {
  it("counts each kind of work in its own column, with a total", async () => {
    const { lead, one } = await team();
    await fileIssue(one, "Belt snapped");
    await fileIssue(one, "Bearing noise");

    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Grease the bearings",
        assigneeIds: [one.id],
      })
    ).json();
    await inject("PATCH", `/tasks/${task.id}`, one.cookie, { state: "done" });

    const res = await run(lead.cookie, "dept_workload");
    expect(res.statusCode).toBe(200);
    const rows = rowsByPerson(res.json());
    const sam = rows.get("Sam Operator");
    expect(sam?.issues).toBe("2");
    expect(sam?.tasks).toBe("1");
    // Total is the activity columns added up — and not the points, which are a
    // different unit entirely.
    expect(sam?.total).toBe("3");
  });

  it("counts a handed-over task for both people who worked it", async () => {
    // The same rule the points follow: somebody released by a handover did part of
    // the job, so the report says so rather than crediting only whoever finished.
    const { lead, one, two } = await team();
    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Rewire the panel",
        assigneeIds: [one.id],
      })
    ).json();
    await inject("POST", `/tasks/${task.id}/handover`, lead.cookie, {
      fromUserId: one.id,
      toUserId: two.id,
    });
    await inject("PATCH", `/tasks/${task.id}`, two.cookie, { state: "done" });

    const rows = rowsByPerson((await run(lead.cookie, "dept_workload")).json());
    expect(rows.get("Sam Operator")?.tasks).toBe("1");
    expect(rows.get("Anil Fitter")?.tasks).toBe("1");
  });

  it("counts nobody twice when a person is in two departments", async () => {
    // The fan-out that makes a report quietly wrong: one person, two memberships,
    // and every count doubled. One row per person, whatever they belong to.
    const { lead, one } = await team();
    const second = (await inject("POST", "/departments", admin, { name: "Utilities" })).json();
    await inject("PUT", `/departments/${second.id}/members`, admin, {
      members: [{ userId: one.id, rank: "member", reportsToId: lead.id }],
    });
    await fileIssue(one, "Only filed once");

    const body = (await run(lead.cookie, "dept_workload")).json();
    const sams = body.groups.flatMap((g: { rows: { cells: Record<string, string> }[] }) =>
      g.rows.filter((r) => r.cells.person === "Sam Operator"),
    );
    expect(sams).toHaveLength(1);
    expect(sams[0]!.cells.issues).toBe("1");
  });

  it("shows working days as a share of the group's rostered high", async () => {
    const { lead } = await team();
    const rows = rowsByPerson((await run(lead.cookie, "dept_workload")).json());
    // Nobody is on a rota in this fixture, so there is no high to compare against
    // and the cell is a bare count rather than a misleading "0 / 0".
    expect(rows.get("Sam Operator")?.workingDays).toBe("0");
  });

  it("is refused to somebody without the report's own permission", async () => {
    // Every report has its own key, and an ordinary member holds none of them.
    const { one } = await team();
    expect((await run(one.cookie, "dept_workload")).statusCode).toBe(403);
  });

  it("keeps a reader to their own reporting line", async () => {
    // The scope every people-shaped report shares. Holding the permission is not
    // holding a wider view: this reader may run the report and still only accounts
    // for themselves, because nobody reports to them.
    const { lead, one, two } = await team();
    await grantWorkloadReports(one.id);
    await fileIssue(two, "Not theirs to read");
    await fileIssue(one, "Their own");

    const rows = rowsByPerson((await run(one.cookie, "dept_workload")).json());
    expect([...rows.keys()]).toEqual(["Sam Operator"]);

    // Their lead, above both of them, accounts for the whole team.
    const asLead = rowsByPerson((await run(lead.cookie, "dept_workload")).json());
    expect([...asLead.keys()].sort()).toEqual(["Anil Fitter", "Ravi Lead", "Sam Operator"]);
  });
});

describe("the daily workload report", () => {
  it("puts each person's work on the day it happened", async () => {
    const { lead, one } = await team();
    await fileIssue(one, "Today's job");

    const res = await run(lead.cookie, "dept_workload_daily");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const rows = body.groups.flatMap((g: { rows: { cells: Record<string, string> }[] }) => g.rows);
    const withWork = rows.filter((r: { cells: Record<string, string> }) => r.cells.issues === "1");
    expect(withWork).toHaveLength(1);
    expect(withWork[0]!.cells.person).toBe("Sam Operator");
    expect(withWork[0]!.cells.date).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("the irregularity report", () => {
  it("lists the people below the threshold and leaves the busy ones out", async () => {
    const { lead, one } = await team();
    await fileIssue(one, "One");
    await fileIssue(one, "Two");
    // `two` did nothing at all.

    const res = await run(lead.cookie, "dept_irregularity", { irregularityThreshold: 1 });
    expect(res.statusCode).toBe(200);
    const rows = rowsByPerson(res.json());
    expect(rows.has("Anil Fitter")).toBe(true);
    expect(rows.has("Sam Operator")).toBe(false);
    expect(rows.get("Anil Fitter")?.total).toBe("0");
  });

  it("raising the threshold pulls in the quiet ones too", async () => {
    const { lead, one } = await team();
    await fileIssue(one, "The only thing all week");

    expect(
      rowsByPerson((await run(lead.cookie, "dept_irregularity")).json()).has("Sam Operator"),
    ).toBe(false);
    const stricter = await run(lead.cookie, "dept_irregularity", { irregularityThreshold: 5 });
    expect(rowsByPerson(stricter.json()).has("Sam Operator")).toBe(true);
  });

  it("says a dash rather than 0.00 for somebody with no rota", async () => {
    // Dividing by no rostered days is not a performance figure, and printing one
    // invites a conversation about a number that measures nothing.
    const { lead } = await team();
    const rows = rowsByPerson((await run(lead.cookie, "dept_irregularity")).json());
    expect(rows.get("Anil Fitter")?.perDay).toBe("—");
  });
});

/**
 * The denominator: "18 / 24".
 *
 * The headline of the summary report, and the half that is easy to get wrong
 * silently. The numerator counts days rostered **working** — a day off, a leave day
 * and a public holiday are all on the rota and none of them is a working day, which
 * is the whole point ("so that W/O or Leave do not counts"). The denominator is the
 * most anybody in the same group was rostered, which is what makes two rows
 * comparable.
 */
describe("working days", () => {
  /** A rota for this month with `entries` applied to it. */
  async function rota(
    dept: { id: string },
    entries: { userId: string; date: string; state: string }[],
  ) {
    const site = (await inject("GET", "/locations", admin)).json()[0];
    const shift = (
      await inject("POST", "/shifts", admin, {
        name: "Morning",
        code: "M",
        startMinute: 360,
        endMinute: 840,
      })
    ).json();
    const now = new Date();
    const created = await inject("POST", "/schedules", admin, {
      departmentId: dept.id,
      locationId: site.id,
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
    });
    expect(created.statusCode).toBe(201);
    for (const entry of entries) {
      const res = await inject("POST", `/schedules/${created.json().id}/assign`, admin, {
        date: entry.date,
        userId: entry.userId,
        // Only a working day carries a shift; leave and days off are explicitly
        // shiftless, which is exactly what the report has to tell apart.
        shiftId: entry.state === "working" ? shift.id : null,
        state: entry.state,
      });
      expect(res.statusCode).toBe(200);
    }
  }

  /** `n` days of this month, as YYYY-MM-DD, starting from the first. */
  const days = (n: number): string[] => {
    const now = new Date();
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), i + 1));
      return d.toISOString().slice(0, 10);
    });
  };

  /** The whole of this month, so every rostered day is inside the window. */
  async function runThisMonth(cookie: string) {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return inject("POST", "/reports/run", cookie, {
      definition: {
        source: "dept_workload",
        range: "custom",
        from: from.toISOString(),
        to: to.toISOString(),
        grouping: "none",
        columns: ["person"],
      },
    });
  }

  it("counts rostered days and measures them against the group's high", async () => {
    const { lead, one, two, dept } = await team();
    const [d1, d2, d3, d4] = days(4);
    await rota(dept, [
      { userId: one.id, date: d1!, state: "working" },
      { userId: one.id, date: d2!, state: "working" },
      { userId: one.id, date: d3!, state: "working" },
      { userId: one.id, date: d4!, state: "working" },
      { userId: two.id, date: d1!, state: "working" },
      { userId: two.id, date: d2!, state: "working" },
    ]);

    const rows = rowsByPerson((await runThisMonth(lead.cookie)).json());
    // Sam was on four days, which is the most anybody managed, so he is the bar.
    expect(rows.get("Sam Operator")?.workingDays).toBe("4 / 4");
    // Anil was available half as much, and the row says so rather than leaving it
    // to be inferred from a bare "2".
    expect(rows.get("Anil Fitter")?.workingDays).toBe("2 / 4");
  });

  it("does not count a day off, a leave day or a holiday", async () => {
    const { lead, one, dept } = await team();
    const [d1, d2, d3, d4] = days(4);
    await rota(dept, [
      { userId: one.id, date: d1!, state: "working" },
      { userId: one.id, date: d2!, state: "off" },
      { userId: one.id, date: d3!, state: "leave" },
      { userId: one.id, date: d4!, state: "holiday" },
    ]);

    // On the rota for four days, at work for one.
    const rows = rowsByPerson((await runThisMonth(lead.cookie)).json());
    expect(rows.get("Sam Operator")?.workingDays).toBe("1 / 1");
  });
});
