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
      assigneeIds: [operator.id],
      priority: "high",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().assignees.map((a: { name: string }) => a.name)).toEqual(["Sam Operator"]);
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
        assigneeIds: [operator.id],
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
      assigneeIds: [operator.id],
    });
    expect(sideways.statusCode).toBe(403);

    // And a task in someone else's chain is not theirs to see.
    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Replace the drive belt",
        assigneeIds: [operator.id],
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
        assigneeIds: [operator.id],
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
      assigneeIds: [outsider.id],
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
        assigneeIds: [operator.id],
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
        assigneeIds: [operator.id],
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
        assigneeIds: [operator.id],
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
        assigneeIds: [operator.id],
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
        assigneeIds: [operator.id],
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
        assigneeIds: [worker.id],
      })
    ).json();
    const somebodyElses = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Grease the bearings",
        assigneeIds: [operator.id],
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
      (await inject("PATCH", `/tasks/${mine.id}`, worker.cookie, { assigneeIds: [operator.id] }))
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
          assigneeIds: [operator.id],
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe("giving yourself work", () => {
  it("lets a member create a task for themselves", async () => {
    // Asked for from use: "a user should be alowed to create task for him self and
    // can not be assigned to others by him but his upper level can do so."
    const admin = await superadmin();
    const { operator } = await buildChain(admin);

    const created = await inject("POST", "/tasks", operator.cookie, {
      title: "Tidy the spares shelf",
      assigneeIds: [operator.id],
      priority: "normal",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().assignees.map((a: { id: string }) => a.id)).toEqual([operator.id]);
    expect(created.json().assignerId).toBe(operator.id);
  });

  it("refuses to let them hand it to anybody else", async () => {
    const admin = await superadmin();
    const { operator, lead } = await buildChain(admin);

    const refused = await inject("POST", "/tasks", operator.cookie, {
      title: "You do it",
      assigneeIds: [lead.id],
      priority: "normal",
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toContain("only create work for yourself");
  });

  it("refuses even for somebody below them in the line", async () => {
    // The reason this needed a second permission rather than a wider grant.
    // `tasks:create` means "yourself *or anyone below you*", so a member who
    // happens to have a person under them would have been able to hand work down
    // — the opposite of what was asked for.
    const admin = await superadmin();
    const { operator } = await buildChain(admin);

    // Give the operator somebody of their own, while they stay a plain Member.
    const memberGroup = await makeGroup(admin, "More reporters", "Member");
    const junior = await makeUser(admin, "Dev Junior", "dev", memberGroup);
    const dept = (await inject("POST", "/departments", admin, { name: "Spares" })).json();
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [
        { userId: operator.id, rank: "lead" },
        { userId: junior.id, rank: "member", reportsToId: operator.id },
      ],
    });

    const refused = await inject("POST", "/tasks", operator.cookie, {
      title: "Down the line",
      assigneeIds: [junior.id],
      priority: "normal",
    });
    expect(refused.statusCode).toBe(403);
  });

  it("leaves a manager assigning down the line exactly as before", async () => {
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);

    const created = await inject("POST", "/tasks", lead.cookie, {
      title: "Please check the pump",
      assigneeIds: [operator.id],
      priority: "normal",
    });
    expect(created.statusCode).toBe(201);
  });
});

/**
 * The three things a single `assignee_id` column could not say, all reported from
 * live use on the same day:
 *
 *   "tasks needs to be assigned to multiple users"
 *   "allow to create the task without any assign to so that i can create task in
 *    advance for my team and only assign when i need to based on priority"
 *   "allow the tasks to be handover as there may be a case when task was long and
 *    user's shoft was finished and he handedover it to someone else. In that case
 *    he need to tell his manager to handover the task and points needs to be
 *    splited acordingly"
 */
describe("who is on a task", () => {
  it("puts two people on one task, and it lands on both plates", async () => {
    const admin = await superadmin();
    const { lead, operator, dept } = await buildChain(admin);
    const memberGroup = await makeGroup(admin, "Reporters two", "Member");
    const mate = await makeUser(admin, "Anil Mate", "anil", memberGroup);
    // The second worker has to be under the same lead, or assigning to them is
    // refused — which is the rule this test must not accidentally bypass.
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [
        { userId: lead.id, rank: "lead" },
        { userId: operator.id, rank: "member", reportsToId: lead.id },
        { userId: mate.id, rank: "member", reportsToId: lead.id },
      ],
    });

    const created = await inject("POST", "/tasks", lead.cookie, {
      title: "Strip and rebuild the gearbox",
      assigneeIds: [operator.id, mate.id],
    });
    expect(created.statusCode).toBe(201);
    expect(
      created
        .json()
        .assignees.map((a: { name: string }) => a.name)
        .sort(),
    ).toEqual(["Anil Mate", "Sam Operator"]);

    // Both see it, and neither sees it twice — the join must not multiply the row.
    for (const who of [operator, mate]) {
      const mine = await inject("GET", "/tasks", who.cookie);
      expect(mine.json().data).toHaveLength(1);
      expect(mine.json().total).toBe(1);
    }
  });

  it("creates a task with nobody on it, tells nobody, and still shows it to its author", async () => {
    const admin = await superadmin();
    const { lead } = await buildChain(admin);

    const created = await inject("POST", "/tasks", lead.cookie, {
      title: "Order the replacement seals",
      assigneeIds: [],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().assignees).toEqual([]);

    // Planned work that vanished on save would be worse than not having the feature.
    const mine = await inject("GET", "/tasks", lead.cookie);
    expect(mine.json().data.map((t: { id: string }) => t.id)).toContain(created.json().id);

    // Nobody was given anything, so nobody was told anything.
    const bell = await inject("GET", "/notifications", lead.cookie);
    expect(
      (bell.json().data ?? []).filter((n: { type: string }) => n.type === "task.assigned"),
    ).toHaveLength(0);
  });

  it("finds the unassigned ones with the assignee filter", async () => {
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);
    await inject("POST", "/tasks", lead.cookie, {
      title: "Planned, nobody on it",
      assigneeIds: [],
    });
    await inject("POST", "/tasks", lead.cookie, {
      title: "Handed out",
      assigneeIds: [operator.id],
    });

    const filter = encodeURIComponent(
      JSON.stringify([{ field: "assigneeId", op: "eq", value: "none" }]),
    );
    const res = await inject("GET", `/tasks?filters=${filter}`, lead.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((t: { title: string }) => t.title)).toEqual([
      "Planned, nobody on it",
    ]);
  });

  it("hands a task on, keeping the first person on it for the points", async () => {
    const admin = await superadmin();
    const { lead, operator, dept } = await buildChain(admin);
    const memberGroup = await makeGroup(admin, "Night shift", "Member");
    const relief = await makeUser(admin, "Kiran Relief", "kiran", memberGroup);
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [
        { userId: lead.id, rank: "lead" },
        { userId: operator.id, rank: "member", reportsToId: lead.id },
        { userId: relief.id, rank: "member", reportsToId: lead.id },
      ],
    });

    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Rewire the panel",
        assigneeIds: [operator.id],
      })
    ).json();

    // The worker asks; the manager acts. The worker doing it themselves is refused.
    const bySelf = await inject("POST", `/tasks/${task.id}/handover`, operator.cookie, {
      fromUserId: operator.id,
      toUserId: relief.id,
    });
    expect(bySelf.statusCode).toBe(403);

    const done = await inject("POST", `/tasks/${task.id}/handover`, lead.cookie, {
      fromUserId: operator.id,
      toUserId: relief.id,
      reason: "Shift ended with the panel still open",
    });
    expect(done.statusCode).toBe(200);

    // The point of the whole thing: the first person is released, not removed.
    const people = done.json().assignees as { id: string; released: boolean }[];
    expect(people.find((p) => p.id === operator.id)?.released).toBe(true);
    expect(people.find((p) => p.id === relief.id)?.released).toBe(false);
    expect(done.json().handovers).toHaveLength(1);
    expect(done.json().handovers[0].reason).toBe("Shift ended with the panel still open");

    // It is off the first worker's plate but still theirs to read.
    expect((await inject("GET", `/tasks/${task.id}`, operator.cookie)).statusCode).toBe(200);
    const relieved = await inject("GET", "/tasks", relief.cookie);
    expect(relieved.json().data.map((t: { id: string }) => t.id)).toContain(task.id);
  });

  it("puts everybody who worked the task on the entry that logs it", async () => {
    // "author devides it" — the author sets each share, so the people have to be
    // there to divide between. Retyping the list from memory is how somebody who
    // handed over at the end of a shift silently gets nothing.
    const admin = await superadmin();
    const { lead, operator, dept } = await buildChain(admin);
    const memberGroup = await makeGroup(admin, "Late shift", "Member");
    const relief = await makeUser(admin, "Meera Relief", "meera", memberGroup);
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [
        { userId: lead.id, rank: "lead" },
        { userId: operator.id, rank: "member", reportsToId: lead.id },
        { userId: relief.id, rank: "member", reportsToId: lead.id },
      ],
    });

    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Change the bearing",
        assigneeIds: [operator.id],
      })
    ).json();
    await inject("POST", `/tasks/${task.id}/handover`, lead.cookie, {
      fromUserId: operator.id,
      toUserId: relief.id,
    });

    // The person who finished it writes it up.
    const prefill = await inject("GET", `/tasks/${task.id}/prefill`, relief.cookie);
    expect(prefill.statusCode).toBe(200);
    expect((prefill.json().participantIds as string[]).sort()).toEqual(
      [operator.id, relief.id].sort(),
    );

    const entry = await inject("POST", "/journal", relief.cookie, {
      kind: "issue",
      state: "draft",
      title: "Bearing changed",
      taskId: task.id,
    });
    expect(entry.statusCode).toBe(201);

    const people = (
      await inject("GET", `/journal/${entry.json().id}/participants`, relief.cookie)
    ).json() as { userId: string }[];
    expect(people.map((p) => p.userId).sort()).toEqual([operator.id, relief.id].sort());
  });
});

/**
 * What a task is worth, and who decides.
 *
 * Asked for after severity proved the wrong instrument: "each task should have a
 * points to earn based on how complex a task is and how much effert is needed...
 * lets say we need top cap of any task to be 100 but user can decide for each task
 * how much point should be given... but manager can change the cap of task."
 */
describe("what a task is worth", () => {
  it("takes the number the person raising it chose", async () => {
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);
    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Rebuild the gearbox",
        assigneeIds: [operator.id],
        maxPoints: 40,
      })
    ).json();
    expect(task.maxPoints).toBe(40);
  });

  it("defaults to ten rather than nothing", async () => {
    // A task worth zero cannot be scored at all, which is a strange thing to get
    // by saying nothing.
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);
    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Something ordinary",
        assigneeIds: [operator.id],
      })
    ).json();
    expect(task.maxPoints).toBe(10);
  });

  it("refuses a task worth more than the installation allows", async () => {
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);
    const res = await inject("POST", "/tasks", lead.cookie, {
      title: "Worth a thousand, apparently",
      assigneeIds: [operator.id],
      maxPoints: 1000,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/at most 100/);
  });

  it("lets a manager regrade an open task, and refuses the worker", async () => {
    // The point of the ceiling being a manager's to set: somebody may say what
    // their own new task is worth, and only their manager may change it after.
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);
    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Swap the bearing",
        assigneeIds: [operator.id],
      })
    ).json();

    const byWorker = await inject("PATCH", `/tasks/${task.id}`, operator.cookie, {
      maxPoints: 90,
    });
    expect(byWorker.statusCode).toBe(403);

    const byLead = await inject("PATCH", `/tasks/${task.id}`, lead.cookie, { maxPoints: 25 });
    expect(byLead.statusCode).toBe(200);
    expect(byLead.json().maxPoints).toBe(25);
  });

  it("is the ceiling of the entry filed against it, not the severity's", async () => {
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);
    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "A big job",
        assigneeIds: [operator.id],
        maxPoints: 30,
      })
    ).json();

    const entry = (
      await inject("POST", "/journal", operator.cookie, {
        kind: "work",
        title: "Did the big job",
        workSummary: "All of it.",
        state: "submitted",
        taskId: task.id,
      })
    ).json();

    // Severity would allow ten at most; the task says thirty, and the task wins.
    const detail = (await inject("GET", `/journal/${entry.id}`, operator.cookie)).json();
    expect(detail.pointsCeiling).toBe(30);

    const scored = await inject("PUT", `/journal/${entry.id}/scores`, operator.cookie, {
      scores: [{ userId: operator.id, points: 28 }],
    });
    expect(scored.statusCode).toBe(200);
  });

  it("takes the points back when a manager reopens the task", async () => {
    // "if any task again reopened by manager it's journal and points should also be
    // reverted." The entry stays — it is the record of what was done — but what it
    // paid does not.
    const admin = await superadmin();
    const { lead, operator } = await buildChain(admin);
    const task = (
      await inject("POST", "/tasks", lead.cookie, {
        title: "Looked finished",
        assigneeIds: [operator.id],
        maxPoints: 20,
      })
    ).json();
    const entry = (
      await inject("POST", "/journal", operator.cookie, {
        kind: "work",
        title: "Wrote it up",
        workSummary: "Done.",
        state: "submitted",
        taskId: task.id,
      })
    ).json();
    await inject("PUT", `/journal/${entry.id}/scores`, operator.cookie, {
      scores: [{ userId: operator.id, points: 8 }],
    });
    const scoredRows = (
      await inject("GET", `/journal/${entry.id}/scores`, operator.cookie)
    ).json() as { userId: string; self: number | null }[];
    expect(scoredRows.find((r) => r.userId === operator.id)?.self).toBe(8);

    // Filing completed the task; the manager sends it back to work.
    expect((await inject("GET", `/tasks/${task.id}`, lead.cookie)).json().state).toBe("done");
    const reopened = await inject("PATCH", `/tasks/${task.id}`, lead.cookie, {
      state: "in_progress",
    });
    expect(reopened.statusCode).toBe(200);

    // The entry is still there, and is worth nothing until the job is finished again.
    const after = await inject("GET", `/journal/${entry.id}`, operator.cookie);
    expect(after.statusCode).toBe(200);
    // The grid still lists whoever worked it — that is the membership, not the
    // payment. What was scored is gone.
    const cleared = (
      await inject("GET", `/journal/${entry.id}/scores`, operator.cookie)
    ).json() as {
      userId: string;
      self: number | null;
      review: number | null;
      official: number | null;
    }[];
    for (const row of cleared) {
      expect(row.self).toBeNull();
      expect(row.review).toBeNull();
      expect(row.official).toBeNull();
    }
  });
});
