// Author: Brijesh Dave <https://github.com/brijeshdave>
// What an entry is allowed to be worth, and which of the two ceilings decides.
//
// The severity ceiling has been enforced since severities gained `max_points`, and
// had no test — the exact shape this codebase keeps producing: a stored value that
// something reads, until one day it quietly does not.
//
// The second ceiling is new, asked for with multi-person tasks: an entry filed
// against a task is work somebody was already told to do, so it should not be able
// to earn what an unplanned three-in-the-morning breakdown earns. It caps the
// severity, it never raises it — **the lower of the two wins** — because two
// ceilings where the larger could lift the smaller would let a task marked Minor
// pay more than Minor allows.
import { TASK_POINTS } from "@reportly/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { setCompanySetting } from "@/core/settings/service.js";
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
  return cookieFrom(
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/email`,
      payload: { email: "admin@reportly.local", password },
    }),
  );
}

async function makeUser(admin: string, name: string, username: string, roleName: string) {
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

/** A manager over one worker, and a severity whose ceiling is exactly `maxPoints`. */
async function scene(maxPoints: number) {
  const admin = await superadmin();
  const manager = await makeUser(admin, "Ravi Lead", "ravi", "Manager");
  const author = await makeUser(admin, "Sam Operator", "sam", "Member");

  const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [
      { userId: manager.id, rank: "lead" },
      { userId: author.id, rank: "member", reportsToId: manager.id },
    ],
  });

  const severity = (
    await inject("POST", "/severities", admin, { name: "Capped", maxPoints })
  ).json();

  return { admin, manager, author, dept, severity };
}

/** File an entry, log the work, and move it to a terminal status so it can be scored. */
async function fileAndResolve(
  admin: string,
  author: { id: string; cookie: string },
  severityId: string,
  taskId?: string,
) {
  const filed = await inject("POST", "/journal", author.cookie, {
    kind: "issue",
    title: "Conveyor jam",
    state: "submitted",
    severityId,
    issueSummary: "Belt seized",
    ...(taskId ? { taskId } : {}),
  });
  expect(filed.statusCode).toBe(201);
  const reportId = filed.json().id as string;

  await inject("POST", `/journal/${reportId}/work`, author.cookie, {
    summary: "Replaced the belt",
  });
  const statuses = (await inject("GET", "/journal-statuses", admin)).json();
  const resolved = statuses.find((s: { name: string }) => s.name === "Resolved");
  await inject("PATCH", `/journal/${reportId}/status`, admin, { statusId: resolved.id });
  return reportId;
}

describe("what an entry may be worth", () => {
  it("refuses a score above the severity's ceiling, and allows one at it", async () => {
    const { admin, manager, author, severity } = await scene(4);
    const reportId = await fileAndResolve(admin, author, severity.id);

    const over = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 5 }],
    });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.message).toContain("at most 4");

    const at = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 4 }],
    });
    expect(at.statusCode).toBe(200);
  });

  it("caps an entry filed against a task at the task ceiling when that is lower", async () => {
    const { admin, manager, author, severity } = await scene(8);
    await setCompanySetting(TASK_POINTS, DEMO_COMPANY_ID, { enabled: true, maxPoints: 3 });

    const task = (
      await inject("POST", "/tasks", manager.cookie, {
        title: "Swap the belt",
        assigneeIds: [author.id],
      })
    ).json();
    const reportId = await fileAndResolve(admin, author, severity.id, task.id);

    // The severity would allow 8; the task ceiling is 3, and the lower one wins.
    const over = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 4 }],
    });
    expect(over.statusCode).toBe(400);
    // The message names the cap that actually bit, so nobody is sent to the
    // severities screen to change a number that was not the cause.
    expect(over.json().error.message).toContain("filed against a task");

    const at = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 3 }],
    });
    expect(at.statusCode).toBe(200);
  });

  it("never lifts a lower severity ceiling to the task ceiling", async () => {
    // A cap only ever caps. A task marked Minor stays worth Minor.
    const { admin, manager, author, severity } = await scene(2);
    await setCompanySetting(TASK_POINTS, DEMO_COMPANY_ID, { enabled: true, maxPoints: 9 });

    const task = (
      await inject("POST", "/tasks", manager.cookie, {
        title: "Tighten the guard",
        assigneeIds: [author.id],
      })
    ).json();
    const reportId = await fileAndResolve(admin, author, severity.id, task.id);

    const over = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 3 }],
    });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.message).toContain("at most 2");
  });

  it("does nothing at all while the cap is switched off", async () => {
    // The default. Installing the setting must not quietly lower anybody's points.
    const { admin, manager, author, severity } = await scene(7);
    await setCompanySetting(TASK_POINTS, DEMO_COMPANY_ID, { enabled: false, maxPoints: 1 });

    const task = (
      await inject("POST", "/tasks", manager.cookie, {
        title: "Check the guard",
        assigneeIds: [author.id],
      })
    ).json();
    const reportId = await fileAndResolve(admin, author, severity.id, task.id);
    const at = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 7 }],
    });
    expect(at.statusCode).toBe(200);
  });

  it("leaves entries with no task alone", async () => {
    const { admin, manager, author, severity } = await scene(7);
    await setCompanySetting(TASK_POINTS, DEMO_COMPANY_ID, { enabled: true, maxPoints: 1 });

    const reportId = await fileAndResolve(admin, author, severity.id);
    const at = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 7 }],
    });
    expect(at.statusCode).toBe(200);
  });
});

/**
 * Which entries have to name a severity before they can be submitted.
 *
 * Asked for as "severity is missing... require severity to submit", and shipped
 * applying to every kind — which was wrong in a way no test caught: the editor
 * only sends a severity for a breakdown, so submitting planned work, or the entry
 * that completing a task opens, answered 400 with no field on the screen able to
 * clear it.
 */
describe("submitting without a severity", () => {
  it("refuses a breakdown, because the severity is what sets its ceiling", async () => {
    const { author } = await scene(5);
    const res = await inject("POST", "/journal", author.cookie, {
      kind: "issue",
      title: "Conveyor jam",
      state: "submitted",
      issueSummary: "Belt seized",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("Choose a severity");
  });

  it("allows a draft breakdown, which is still being written", async () => {
    const { author } = await scene(5);
    const res = await inject("POST", "/journal", author.cookie, {
      kind: "issue",
      title: "Conveyor jam",
      state: "draft",
    });
    expect(res.statusCode).toBe(201);
  });

  it("allows planned work, which has no severity to name", async () => {
    const { author } = await scene(5);
    const res = await inject("POST", "/journal", author.cookie, {
      kind: "work",
      title: "Greased the bearings",
      workSummary: "Night shift round.",
      state: "submitted",
    });
    expect(res.statusCode).toBe(201);
  });
});
