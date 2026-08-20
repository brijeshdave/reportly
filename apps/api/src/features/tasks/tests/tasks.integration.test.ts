// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for tasks — the parts that decide who can hand work to whom, and
// that the work handed out ends up linked to the work recorded:
//   - a manager may assign down the reporting line, but never sideways or up
//   - the assignee may complete their task; only the assigner may re-assign it
//   - completing hands back a pre-filled work report, and filing it links the two
//   - a task is invisible to someone outside its line
//
// The harness builds a real reporting line — operator → lead — with real signed-in
// users, because that line is the only thing assignment is computed from.
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

async function makeGroup(admin: string, name: string, roleName: string): Promise<string> {
  const group = (await inject("POST", "/groups", admin, { name })).json();
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
}

/**
 * operator reports to lead; outsider is in the same company but a different chain,
 * which is what makes "not sideways" testable rather than assumed.
 */
async function buildChain(admin: string) {
  const memberGroup = await makeGroup(admin, "Reporters", "Member");
  const managerGroup = await makeGroup(admin, "Line managers", "Manager");

  const lead = await makeUser(admin, "Ravi Lead", "ravi", managerGroup);
  const operator = await makeUser(admin, "Sam Operator", "sam", memberGroup);
  const outsider = await makeUser(admin, "Priya Elsewhere", "priya", managerGroup);

  const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [
      { userId: lead.id, rank: "lead" },
      { userId: operator.id, rank: "member", reportsToId: lead.id },
      { userId: outsider.id, rank: "lead" },
    ],
  });

  return { lead, operator, outsider, dept };
}

describe("tasks", () => {
  it("a lead assigns down the line; the operator sees it on their plate", async () => {
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);

    const created = await inject("POST", "/tasks", lead.cookie, {
      title: "Replace the drive belt on Line 3",
      detail: "Spare is in the east store.",
      assigneeId: operator.id,
      priority: "high",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().assigneeName).toBe("Sam Operator");
    expect(created.json().assignerName).toBe("Ravi Lead");
    expect(created.json().state).toBe("open");

    const mine = await inject("GET", "/tasks", operator.cookie);
    expect(mine.json().data).toHaveLength(1);
    expect(mine.json().data[0].title).toBe("Replace the drive belt on Line 3");
  });

  it("lists the open tasks a manager handed out, dropping them once done", async () => {
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);

    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Inspect the guard on Line 3",
        assigneeId: operator.id,
      })
    ).json();

    // The lead assigned it, so it is on their "to review" oversight list.
    const leadOpen = (await inject("GET", "/tasks/assigned-open", lead.cookie)).json();
    expect(leadOpen.map((t: { id: string }) => t.id)).toEqual([task.id]);

    // The operator assigned nobody, so their oversight list is empty.
    expect((await inject("GET", "/tasks/assigned-open", operator.cookie)).json()).toHaveLength(0);

    // Once the operator completes it, it leaves the lead's list.
    await inject("PATCH", `/tasks/${task.id}`, operator.cookie, { state: "done" });
    expect((await inject("GET", "/tasks/assigned-open", lead.cookie)).json()).toHaveLength(0);
  });

  it("refuses to assign sideways, and hides the task from outside the line", async () => {
    const admin = await superadmin();
    const { lead, operator, outsider } = await buildChain(admin);

    // The outsider is nobody's manager here, so the operator is not theirs to task.
    const sideways = await inject("POST", "/tasks", outsider.cookie, {
      title: "Do my filing",
      assigneeId: operator.id,
    });
    expect(sideways.statusCode).toBe(403);

    // And a task in someone else's chain is not theirs to see.
    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Replace the drive belt",
        assigneeId: operator.id,
      })
    ).json();
    expect((await inject("GET", `/tasks/${task.id}`, outsider.cookie)).statusCode).toBe(404);
    expect((await inject("GET", "/tasks", outsider.cookie)).json().data).toHaveLength(0);
  });

  it("the assignee completes it but cannot re-assign it", async () => {
    const admin = await superadmin();
    const { lead, operator, outsider } = await buildChain(admin);

    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Replace the drive belt",
        assigneeId: operator.id,
      })
    ).json();

    // Moving it along is the assignee's to do — this is why Member holds tasks:update.
    const done = await inject("PATCH", `/tasks/${task.id}`, operator.cookie, { state: "done" });
    expect(done.statusCode).toBe(200);
    expect(done.json().state).toBe("done");
    // The stamp is derived from the state, never sent by the client.
    expect(done.json().completedAt).not.toBeNull();

    // Handing it to somebody else is not.
    const reassign = await inject("PATCH", `/tasks/${task.id}`, operator.cookie, {
      assigneeId: outsider.id,
    });
    expect(reassign.statusCode).toBe(403);
  });

  it("completing hands back a pre-filled work report, and filing it links the two", async () => {
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);

    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Replace the drive belt on Line 3",
        detail: "Spare is in the east store.",
        assigneeId: operator.id,
      })
    ).json();

    const prefill = await inject("GET", `/tasks/${task.id}/prefill`, operator.cookie);
    expect(prefill.statusCode).toBe(200);
    expect(prefill.json()).toMatchObject({
      taskId: task.id,
      kind: "work",
      title: "Replace the drive belt on Line 3",
      workSummary: "Spare is in the east store.",
    });

    const report = await inject("POST", "/journal", operator.cookie, {
      kind: "work",
      title: prefill.json().title,
      workSummary: "Belt replaced, line back up.",
      state: "submitted",
      taskId: task.id,
    });
    expect(report.statusCode).toBe(201);
    expect(report.json().taskId).toBe(task.id);
    expect(report.json().taskTitle).toBe("Replace the drive belt on Line 3");

    // The task now shows the record of the work done against it — and filing that
    // record is what completed it. Marking it done first, then hoping the form gets
    // filled in, is how a task ended up complete with nothing logged against it.
    const after = await inject("GET", `/tasks/${task.id}`, operator.cookie);
    expect(after.json().reports).toHaveLength(1);
    expect(after.json().reports[0].id).toBe(report.json().id);
    expect(after.json().state).toBe("done");
    expect(after.json().completedAt).not.toBeNull();
  });

  it("leaves the task open when no entry is filed, and a later entry still closes it", async () => {
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);

    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Grease the conveyor bearings",
        assigneeId: operator.id,
      })
    ).json();

    // Opening the form and walking away changes nothing: the task is still open,
    // which is the whole point — it used to be done, with no record and no way back.
    await inject("GET", `/tasks/${task.id}/prefill`, operator.cookie);
    expect((await inject("GET", `/tasks/${task.id}`, operator.cookie)).json().state).toBe("open");

    // Filing it later closes it just the same.
    await inject("POST", "/journal", operator.cookie, {
      kind: "work",
      title: "Greased the conveyor bearings",
      workSummary: "Done on the night shift.",
      state: "submitted",
      taskId: task.id,
    });
    const closed = (await inject("GET", `/tasks/${task.id}`, operator.cookie)).json();
    expect(closed.state).toBe("done");

    // A second entry against the same task leaves the completion date alone.
    await inject("POST", "/journal", operator.cookie, {
      kind: "work",
      title: "Checked the bearings again",
      workSummary: "Still fine.",
      state: "submitted",
      taskId: task.id,
    });
    const again = (await inject("GET", `/tasks/${task.id}`, operator.cookie)).json();
    expect(again.completedAt).toBe(closed.completedAt);
  });

  it("refuses to log work against somebody else's task", async () => {
    const admin = await superadmin();
    const { lead, operator, outsider } = await buildChain(admin);

    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Replace the drive belt",
        assigneeId: operator.id,
      })
    ).json();

    // taskId is a client-supplied id on a create. Without the check, the outsider's
    // work would appear on the operator's task as though they had done it.
    const stolen = await inject("POST", "/journal", outsider.cookie, {
      kind: "work",
      title: "I did this",
      taskId: task.id,
    });
    expect(stolen.statusCode).toBe(403);

    // And the prefill is not theirs to read either.
    expect((await inject("GET", `/tasks/${task.id}/prefill`, outsider.cookie)).statusCode).toBe(
      404,
    );
  });

  it("a lead cancels rather than deletes; deleting is an admin act", async () => {
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);

    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Replace the drive belt",
        assigneeId: operator.id,
      })
    ).json();

    // The Manager role holds no :delete anywhere in the app, and a task has a
    // `cancelled` state for exactly this — calling off work is not erasing it.
    expect((await inject("DELETE", `/tasks/${task.id}`, lead.cookie)).statusCode).toBe(403);
    const cancelled = await inject("PATCH", `/tasks/${task.id}`, lead.cookie, {
      state: "cancelled",
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().state).toBe("cancelled");
  });

  it("deleting a task keeps the report of the work done", async () => {
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);

    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Replace the drive belt",
        assigneeId: operator.id,
      })
    ).json();
    const report = (
      await inject("POST", "/journal", operator.cookie, {
        kind: "work",
        title: "Belt replaced",
        state: "submitted",
        taskId: task.id,
      })
    ).json();

    expect((await inject("DELETE", `/tasks/${task.id}`, admin)).statusCode).toBe(204);

    // The record of the work — and the points on it — must not go with the request.
    const still = await inject("GET", `/journal/${report.id}`, operator.cookie);
    expect(still.statusCode).toBe(200);
    expect(still.json().taskId).toBeNull();
  });

  it("the Tasks editor tier works its own tasks and hands work to nobody", async () => {
    // The tier that was asked for and did not exist: tasks:read + tasks:update, no
    // tasks:create. What makes it safe is not the missing key but the row rule —
    // update is refused on anybody else's task, so "editor" cannot quietly become
    // "edits everything".
    const admin = await superadmin();
    const { lead, operator, dept } = await buildChain(admin);
    const worker = await makeUser(
      admin,
      "Kiran Worker",
      "kiran",
      await makeGroup(admin, "Task workers", "Tasks editor"),
    );
    // Under the lead, or there would be nobody who may hand them a task.
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [
        { userId: lead.id, rank: "lead" },
        { userId: operator.id, rank: "member", reportsToId: lead.id },
        { userId: worker.id, rank: "member", reportsToId: lead.id },
      ],
    });

    const mine = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Check the guard interlock",
        assigneeId: worker.id,
      })
    ).json();
    const somebodyElses = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Grease the bearings",
        assigneeId: operator.id,
      })
    ).json();

    // Their own task moves along.
    expect(
      (await inject("PATCH", `/tasks/${mine.id}`, worker.cookie, { state: "in_progress" }))
        .statusCode,
    ).toBe(200);

    // But they cannot retitle it, reassign it, or touch anybody else's.
    expect(
      (await inject("PATCH", `/tasks/${mine.id}`, worker.cookie, { title: "Something else" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await inject("PATCH", `/tasks/${mine.id}`, worker.cookie, { assigneeId: operator.id }))
        .statusCode,
    ).toBe(403);
    // 404, not 403: a task outside their line is not theirs to know about, so the
    // API declines to confirm it exists.
    expect(
      (
        await inject("PATCH", `/tasks/${somebodyElses.id}`, worker.cookie, {
          state: "done",
        })
      ).statusCode,
    ).toBe(404);

    // And they cannot hand work out at all.
    expect(
      (
        await inject("POST", "/tasks", worker.cookie, {
          title: "Do this for me",
          assigneeId: operator.id,
        })
      ).statusCode,
    ).toBe(403);
  });
});
