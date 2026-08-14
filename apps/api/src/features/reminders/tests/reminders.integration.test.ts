// Author: Brijesh Dave <https://github.com/brijeshdave>
// The reminder sweep, and the one thing it has to get right: saying it once.
//
// Every other notification is caused by an action, so it happens as often as the
// action does. A reminder is caused by a fact that stays true, so the sweep sees
// the same overdue routine tomorrow, and the day after, and every day until it is
// done. Repeating it is not a small annoyance — it is what teaches somebody to
// mute the channel, and then they miss the ones that mattered.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { runReminderSweep } from "@/features/reminders/service.js";
import { alreadySent } from "@/features/reminders/repo.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

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

async function superadmin(): Promise<{ cookie: string; id: string }> {
  const password = await resetSuperadmin();
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: "admin@reportly.local", password },
  });
  const cookie = cookieFrom(res);
  const me = (await inject("GET", "/me", cookie)).json();
  return { cookie, id: me.user.id as string };
}

/** A task due inside the look-ahead window. */
async function taskDueIn(cookie: string, assigneeId: string, hours: number): Promise<string> {
  const dueAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const res = await inject("POST", "/tasks", cookie, {
    title: "Grease the bearings",
    assigneeId,
    dueAt,
    priority: "normal",
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("the reminder sweep", () => {
  it("says a due-soon task once, however often it runs", async () => {
    const admin = await superadmin();
    await taskDueIn(admin.cookie, admin.id, 6);

    const first = await runReminderSweep();
    expect(first.sent).toBe(1);

    // The fact is still true tomorrow, and the day after. The mark is what stops
    // it being said again.
    expect((await runReminderSweep()).sent).toBe(0);
    expect((await runReminderSweep()).sent).toBe(0);
  });

  it("leaves alone what is not due yet", async () => {
    const admin = await superadmin();
    // Well outside the 24-hour look-ahead: a warning nobody can act on is noise.
    await taskDueIn(admin.cookie, admin.id, 72);

    expect((await runReminderSweep()).sent).toBe(0);
  });

  it("records the mark against the occurrence, not just the thing", async () => {
    const admin = await superadmin();
    const taskId = await taskDueIn(admin.cookie, admin.id, 6);
    await runReminderSweep();

    // A different due date is a different reminder — moving a deadline is worth
    // saying, and a mark keyed only by the task would have swallowed it.
    const marks = await alreadySent([
      {
        userId: admin.id,
        type: "task.due-soon",
        entityId: taskId,
        occurrenceKey: "1999-01-01T00:00:00.000Z",
      },
    ]);
    expect([...marks].some((key) => key.includes(taskId))).toBe(true);
    expect(marks.has(`${admin.id}|task.due-soon|${taskId}|1999-01-01T00:00:00.000Z`)).toBe(false);
  });

  it("stops reminding once the work is done", async () => {
    const admin = await superadmin();
    const taskId = await taskDueIn(admin.cookie, admin.id, 6);

    const done = await inject("PATCH", `/tasks/${taskId}`, admin.cookie, { state: "done" });
    expect(done.statusCode).toBe(200);

    expect((await runReminderSweep()).sent).toBe(0);
  });
});
