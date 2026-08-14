// Author: Brijesh Dave <https://github.com/brijeshdave>
// Comments, handover and participants.
//
// The things that must be exactly right:
//   - who may take part is the record's OWN visibility rule, not a second copy —
//     so a colleague up the line can join in and an outsider gets a 404
//   - a locked (scored) report can still be discussed; the lock freezes the
//     work, not the conversation
//   - handover is append-only and records who moved it, from whom, to whom
//   - assignment obeys the same downline walk tasks use
//   - participants are the membership; the points each worker earns are scored
//     separately, in two tiers (self split, management review)
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

async function makeGroup(admin: string, name: string, roleName: string): Promise<string> {
  const group = (await inject("POST", "/groups", admin, { name })).json();
  const roles = (await inject("GET", "/roles", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
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

/** author → manager, plus a colleague outside the line. */
async function buildTeam(admin: string) {
  const memberGroup = await makeGroup(admin, "Reporters", "Member");
  const managerGroup = await makeGroup(admin, "Line managers", "Manager");

  const manager = await makeUser(admin, "Ravi Lead", "ravi", managerGroup);
  const author = await makeUser(admin, "Sam Operator", "sam", memberGroup);
  const mate = await makeUser(admin, "Mo Operator", "moe", memberGroup);
  const outsider = await makeUser(admin, "Nina Outside", "nina", memberGroup);

  const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [
      { userId: manager.id, rank: "lead" },
      { userId: author.id, rank: "member", reportsToId: manager.id },
      { userId: mate.id, rank: "member", reportsToId: manager.id },
    ],
  });

  return { manager, author, mate, outsider, dept };
}

async function fileReport(cookie: string, title = "Belt snapped"): Promise<string> {
  const res = await inject("POST", "/journal", cookie, {
    kind: "issue",
    title,
    state: "submitted",
    issueSummary: "It snapped",
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

/**
 * Move a report to the first finished status.
 *
 * Scoring now requires it: points are for finished work, and a report still in
 * progress has not finished being done. Every test that scores a report goes
 * through here rather than repeating the lookup.
 */
async function finish(cookie: string, reportId: string): Promise<void> {
  const statuses = (await inject("GET", "/journal-statuses", cookie)).json();
  const resolved = statuses.find((s: { name: string }) => s.name === "Resolved");
  const res = await inject("PATCH", `/journal/${reportId}/status`, cookie, {
    statusId: resolved.id,
  });
  expect(res.statusCode).toBe(200);
}

/** Score a report's workers in points — the tier follows from the cookie. */
async function score(
  cookie: string,
  reportId: string,
  entries: { userId: string; points: number }[],
): Promise<void> {
  const res = await inject("PUT", `/journal/${reportId}/scores`, cookie, { scores: entries });
  expect(res.statusCode).toBe(200);
}

const ownPoints = async (cookie: string): Promise<number> =>
  (await inject("GET", "/journal/points", cookie)).json().own;

describe("comments", () => {
  it("lets everyone who can open the report take part, and nobody else", async () => {
    const admin = await superadmin();
    const { manager, author, outsider } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    // The author writes; their manager, who can see it up the line, replies. No
    // comments permission was granted to either — being able to open the record is
    // the whole rule.
    const first = await inject("POST", `/journal/${reportId}/comments`, author.cookie, {
      body: "Replaced the belt, but the tensioner looks worn.",
    });
    expect(first.statusCode).toBe(201);

    const reply = await inject("POST", `/journal/${reportId}/comments`, manager.cookie, {
      body: "Order a tensioner and log it against this.",
      parentId: first.json().id,
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().parentId).toBe(first.json().id);

    const thread = (await inject("GET", `/journal/${reportId}/comments`, author.cookie)).json();
    expect(thread).toHaveLength(2);
    expect(thread.map((c: { authorName: string }) => c.authorName)).toEqual([
      "Sam Operator",
      "Ravi Lead",
    ]);

    // Somebody outside the reporting line cannot see the report, so they cannot
    // read or join its conversation — and get a 404, not a 403, so the comment
    // routes cannot be used to discover that a report exists.
    expect((await inject("GET", `/journal/${reportId}/comments`, outsider.cookie)).statusCode).toBe(
      404,
    );
    expect(
      (await inject("POST", `/journal/${reportId}/comments`, outsider.cookie, { body: "hi" }))
        .statusCode,
    ).toBe(404);
  });

  it("keeps the conversation open after the report is locked by scoring", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    await finish(manager.cookie, reportId);
    await score(manager.cookie, reportId, [{ userId: author.id, points: 8 }]);
    const locked = (await inject("GET", `/journal/${reportId}`, author.cookie)).json();
    expect(locked.lockedAt).not.toBeNull();

    // Editing the report itself is refused now...
    expect(
      (await inject("PATCH", `/journal/${reportId}`, author.cookie, { title: "Changed" }))
        .statusCode,
    ).toBe(409);

    // ...but the lock freezes the work, not the discussion of it. A locked report
    // is exactly when people most need to talk about it.
    expect(
      (
        await inject("POST", `/journal/${reportId}/comments`, author.cookie, {
          body: "Noted, thanks — the tensioner arrives Friday.",
        })
      ).statusCode,
    ).toBe(201);
  });

  it("lets a Member correct their own comment but not erase it", async () => {
    const admin = await superadmin();
    const { author } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    // The seeded Member holds `comments:update` and not `comments:delete`. The
    // split is deliberate: fixing a typo keeps the record accurate and leaves an
    // "edited" mark behind, while erasing a remark takes something out of the
    // record and leaves nothing in its place.
    const mine = (
      await inject("POST", `/journal/${reportId}/comments`, author.cookie, { body: "Original" })
    ).json();
    expect(mine.canEdit).toBe(true);
    expect(mine.canDelete).toBe(false);

    expect(
      (await inject("PATCH", `/comments/${mine.id}`, author.cookie, { body: "Corrected" }))
        .statusCode,
    ).toBe(200);
    expect((await inject("DELETE", `/comments/${mine.id}`, author.cookie)).statusCode).toBe(403);
  });

  it("lets a holder of comments:update edit their own words, and marks the edit", async () => {
    const admin = await superadmin();
    const { manager } = await buildTeam(admin);
    const reportId = await fileReport(manager.cookie);

    // Manager holds comments:update and comments:delete for their own remarks.
    const mine = (
      await inject("POST", `/journal/${reportId}/comments`, manager.cookie, { body: "Original" })
    ).json();
    expect(mine.canEdit).toBe(true);

    const edited = await inject("PATCH", `/comments/${mine.id}`, manager.cookie, {
      body: "Corrected",
    });
    expect(edited.statusCode).toBe(200);
    // Visible as an edit, so a revised remark is not mistaken for the one people
    // replied to.
    expect(edited.json().editedAt).not.toBeNull();
  });

  it("never lets anyone rewrite somebody else's comment, moderator or not", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    const theirs = (
      await inject("POST", `/journal/${reportId}/comments`, author.cookie, { body: "Their words" })
    ).json();

    // Not the manager, who holds comments:update...
    expect(
      (await inject("PATCH", `/comments/${theirs.id}`, manager.cookie, { body: "No" })).statusCode,
    ).toBe(403);
    // ...and not a superadmin, who holds everything including moderate. Removing a
    // remark is a moderator's job; rewriting one puts words in another person's
    // mouth, and no role can do that.
    expect(
      (await inject("PATCH", `/comments/${theirs.id}`, admin, { body: "No" })).statusCode,
    ).toBe(403);
    expect((await inject("GET", `/journal/${reportId}/comments`, admin)).json()[0].canEdit).toBe(
      false,
    );
  });

  it("lets a moderator remove somebody else's comment", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    const theirs = (
      await inject("POST", `/journal/${reportId}/comments`, author.cookie, { body: "Their words" })
    ).json();

    // A manager holds delete for their OWN comments only, so not this one.
    expect((await inject("DELETE", `/comments/${theirs.id}`, manager.cookie)).statusCode).toBe(403);

    // A superadmin holds comments:moderate, which covers anybody's.
    expect((await inject("GET", `/journal/${reportId}/comments`, admin)).json()[0].canDelete).toBe(
      true,
    );
    expect((await inject("DELETE", `/comments/${theirs.id}`, admin)).statusCode).toBe(204);
    expect((await inject("GET", `/journal/${reportId}/comments`, admin)).json()).toHaveLength(0);
  });

  it("refuses a reply that belongs to a different record", async () => {
    const admin = await superadmin();
    const { author } = await buildTeam(admin);
    const first = await fileReport(author.cookie, "JournalEntry one");
    const second = await fileReport(author.cookie, "JournalEntry two");

    const onFirst = (
      await inject("POST", `/journal/${first}/comments`, author.cookie, { body: "On the first" })
    ).json();

    // Threading across records would surface a remark on a report it was never
    // about — and potentially on one the author cannot see.
    const crossed = await inject("POST", `/journal/${second}/comments`, author.cookie, {
      body: "Wrong thread",
      parentId: onFirst.id,
    });
    expect(crossed.statusCode).toBe(400);
  });

  it("carries a conversation on a task too", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);

    const task = (
      await inject("POST", "/tasks", manager.cookie, {
        title: "Check the tensioner",
        assigneeId: author.id,
      })
    ).json();

    expect(
      (await inject("POST", `/tasks/${task.id}/comments`, author.cookie, { body: "On it" }))
        .statusCode,
    ).toBe(201);
    expect((await inject("GET", `/tasks/${task.id}/comments`, manager.cookie)).json()).toHaveLength(
      1,
    );
  });
});

describe("handover", () => {
  it("records who moved the report, from whom and to whom", async () => {
    const admin = await superadmin();
    const { manager, author, mate } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    // Unassigned to start: filing something is not the same as holding it.
    expect(
      (await inject("GET", `/journal/${reportId}`, author.cookie)).json().assigneeId,
    ).toBeNull();

    await inject("POST", `/journal/${reportId}/assign`, manager.cookie, {
      assigneeId: author.id,
      reason: "You found it",
    });
    const handed = await inject("POST", `/journal/${reportId}/assign`, manager.cookie, {
      assigneeId: mate.id,
      reason: "Sam is off shift",
    });
    expect(handed.json().assigneeName).toBe("Mo Operator");

    const trail = (await inject("GET", `/journal/${reportId}/handovers`, author.cookie)).json();
    expect(trail).toHaveLength(2);
    // Nobody held it first, so the first handover comes from null.
    expect(trail[0].fromUserId).toBeNull();
    expect(trail[0].toUserName).toBe("Sam Operator");
    expect(trail[1].fromUserName).toBe("Sam Operator");
    expect(trail[1].toUserName).toBe("Mo Operator");
    expect(trail[1].byUserName).toBe("Ravi Lead");
    expect(trail[1].reason).toBe("Sam is off shift");
  });

  it("treats putting the report down as a real destination", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    await inject("POST", `/journal/${reportId}/assign`, manager.cookie, { assigneeId: author.id });
    // Work can be put down before the next person picks it up; forcing a successor
    // would make people assign it to somebody arbitrary.
    const dropped = await inject("POST", `/journal/${reportId}/assign`, manager.cookie, {
      assigneeId: null,
    });
    expect(dropped.statusCode).toBe(200);
    expect(dropped.json().assigneeId).toBeNull();

    const trail = (await inject("GET", `/journal/${reportId}/handovers`, manager.cookie)).json();
    expect(trail[trail.length - 1].toUserId).toBeNull();
  });

  it("does not log a handover when nothing moved", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    await inject("POST", `/journal/${reportId}/assign`, manager.cookie, { assigneeId: author.id });
    await inject("POST", `/journal/${reportId}/assign`, manager.cookie, { assigneeId: author.id });

    // Re-assigning to whoever already holds it would otherwise fill the trail with
    // entries recording that nothing happened.
    expect(
      (await inject("GET", `/journal/${reportId}/handovers`, manager.cookie)).json(),
    ).toHaveLength(1);
  });

  it("refuses to hand work sideways, out of the reporting line", async () => {
    const admin = await superadmin();
    const { author, outsider } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    // The same walk tasks use: yourself or someone below you. The outsider is
    // neither, so the author cannot dump work on them.
    const refused = await inject("POST", `/journal/${reportId}/assign`, author.cookie, {
      assigneeId: outsider.id,
    });
    expect(refused.statusCode).toBe(403);

    // Taking it themselves is always allowed.
    expect(
      (
        await inject("POST", `/journal/${reportId}/assign`, author.cookie, {
          assigneeId: author.id,
        })
      ).statusCode,
    ).toBe(200);
  });
});

describe("status changes", () => {
  async function statuses(admin: string) {
    const list = (await inject("GET", "/journal-statuses", admin)).json();
    const by = (name: string) => list.find((s: { name: string }) => s.name === name);
    return {
      open: by("Open"),
      inProgress: by("In progress"),
      resolved: by("Resolved"),
      duplicate: by("Duplicate"),
    };
  }

  it("moves freely among the open states and on to a finished one", async () => {
    const admin = await superadmin();
    const { author } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);
    const s = await statuses(admin);

    // Work does not run in a straight line, so the open states are not a ladder.
    expect(
      (
        await inject("PATCH", `/journal/${reportId}/status`, author.cookie, {
          statusId: s.inProgress.id,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await inject("PATCH", `/journal/${reportId}/status`, author.cookie, {
          statusId: s.open.id,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await inject("PATCH", `/journal/${reportId}/status`, author.cookie, {
          statusId: s.resolved.id,
        })
      ).statusCode,
    ).toBe(200);
  });

  it("refuses one finished state straight to another", async () => {
    const admin = await superadmin();
    const { author } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);
    const s = await statuses(admin);

    await inject("PATCH", `/journal/${reportId}/status`, author.cookie, {
      statusId: s.resolved.id,
    });

    // Marking a resolved report Duplicate would erase the fact that it was ever
    // resolved. The refusal says what to do instead.
    const refused = await inject("PATCH", `/journal/${reportId}/status`, author.cookie, {
      statusId: s.duplicate.id,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/Re-open/);

    // Re-opening first makes it legal, and the trail keeps both.
    await inject("PATCH", `/journal/${reportId}/status`, author.cookie, {
      statusId: s.inProgress.id,
    });
    expect(
      (
        await inject("PATCH", `/journal/${reportId}/status`, author.cookie, {
          statusId: s.duplicate.id,
        })
      ).statusCode,
    ).toBe(200);

    const timeline = (await inject("GET", `/journal/${reportId}/timeline`, author.cookie)).json();
    expect(timeline.events.length).toBeGreaterThanOrEqual(4);
  });

  it("still moves after the report is locked by scoring", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);
    const s = await statuses(admin);

    await finish(manager.cookie, reportId);
    await score(manager.cookie, reportId, [{ userId: author.id, points: 8 }]);
    // Editing the content is refused...
    expect(
      (await inject("PATCH", `/journal/${reportId}`, author.cookie, { title: "No" })).statusCode,
    ).toBe(409);
    // ...but the status still moves. A resolved-and-marked report that turns out
    // not to be fixed can be re-opened: the lock freezes the work, and a status is
    // not the work.
    expect(
      (
        await inject("PATCH", `/journal/${reportId}/status`, author.cookie, {
          statusId: s.inProgress.id,
        })
      ).statusCode,
    ).toBe(200);
  });

  it("lets the assignee and the line drive it, and refuses an outsider", async () => {
    const admin = await superadmin();
    const { manager, author, mate, outsider } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);
    const s = await statuses(admin);

    // The manager is above the author.
    expect(
      (
        await inject("PATCH", `/journal/${reportId}/status`, manager.cookie, {
          statusId: s.inProgress.id,
        })
      ).statusCode,
    ).toBe(200);

    // A colleague at the same level cannot even see it — 404, not 403, so the
    // status route cannot be used to discover that a report exists.
    expect(
      (
        await inject("PATCH", `/journal/${reportId}/status`, mate.cookie, {
          statusId: s.resolved.id,
        })
      ).statusCode,
    ).toBe(404);

    // Handing it to them makes it theirs to see and to move. Without that, an
    // assignment across the org chart would hand somebody work they cannot open.
    await inject("POST", `/journal/${reportId}/assign`, manager.cookie, { assigneeId: mate.id });
    expect((await inject("GET", `/journal/${reportId}`, mate.cookie)).statusCode).toBe(200);
    expect(
      (await inject("GET", "/journal", mate.cookie))
        .json()
        .data.some((x: { id: string }) => x.id === reportId),
    ).toBe(true);
    expect(
      (
        await inject("PATCH", `/journal/${reportId}/status`, mate.cookie, {
          statusId: s.resolved.id,
        })
      ).statusCode,
    ).toBe(200);

    // Somebody who cannot even see the report gets a 404, not a 403.
    expect(
      (
        await inject("PATCH", `/journal/${reportId}/status`, outsider.cookie, {
          statusId: s.open.id,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("tells the caller whether they may move it", async () => {
    const admin = await superadmin();
    const { author, mate } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    // Computed by the server, so the screen and the API cannot disagree.
    expect(
      (await inject("GET", `/journal/${reportId}`, author.cookie)).json().canChangeStatus,
    ).toBe(true);
    // `mate` is a peer with no involvement, so they cannot see it at all.
    expect((await inject("GET", `/journal/${reportId}`, mate.cookie)).statusCode).toBe(404);
  });
});

describe("participants and scoring", () => {
  it("puts the author on the list at creation, so a solo self-score pays them in full", async () => {
    const admin = await superadmin();
    const { author } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    const list = (await inject("GET", `/journal/${reportId}/participants`, author.cookie)).json();
    expect(list).toHaveLength(1);
    expect(list[0].userId).toBe(author.id);

    // The author is the only worker: their self score is their official figure.
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [{ userId: author.id, points: 8 }]);
    expect(await ownPoints(author.cookie)).toBe(8);
  });

  it("gives each worker the points the self split names them", async () => {
    const admin = await superadmin();
    const { author, mate } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    await inject("PUT", `/journal/${reportId}/participants`, author.cookie, {
      participants: [{ userId: author.id }, { userId: mate.id }],
    });
    await finish(author.cookie, reportId);
    // Real points, not a divided pot: the author scores each worker directly.
    await score(author.cookie, reportId, [
      { userId: author.id, points: 4 },
      { userId: mate.id, points: 4 },
    ]);

    expect(await ownPoints(author.cookie)).toBe(4);
    expect(await ownPoints(mate.cookie)).toBe(4);
  });

  it("lets the self split be uneven, in half-point steps", async () => {
    const admin = await superadmin();
    const { author, mate } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    await inject("PUT", `/journal/${reportId}/participants`, author.cookie, {
      participants: [{ userId: author.id }, { userId: mate.id }],
    });
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [
      { userId: author.id, points: 6 },
      { userId: mate.id, points: 2.5 },
    ]);

    expect(await ownPoints(author.cookie)).toBe(6);
    expect(await ownPoints(mate.cookie)).toBe(2.5);
  });

  it("lets the author name somebody without paying them", async () => {
    const admin = await superadmin();
    const { author, mate } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    await inject("PUT", `/journal/${reportId}/participants`, author.cookie, {
      participants: [{ userId: author.id }, { userId: mate.id }],
    });
    await finish(author.cookie, reportId);
    // Zero is a real statement: on the record as having taken part, and not paid.
    await score(author.cookie, reportId, [
      { userId: author.id, points: 8 },
      { userId: mate.id, points: 0 },
    ]);

    expect(await ownPoints(author.cookie)).toBe(8);
    expect(await ownPoints(mate.cookie)).toBe(0);
    expect(
      (await inject("GET", `/journal/${reportId}/participants`, author.cookie)).json(),
    ).toHaveLength(2);
  });

  it("rolls up to the manager on each worker's official points", async () => {
    const admin = await superadmin();
    const { manager, author, mate } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    await inject("PUT", `/journal/${reportId}/participants`, author.cookie, {
      participants: [{ userId: author.id }, { userId: mate.id }],
    });
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [
      { userId: author.id, points: 4 },
      { userId: mate.id, points: 4 },
    ]);

    // Both workers report to the same manager, who earns from each: 4 × 0.25 twice = 2.
    expect((await inject("GET", "/journal/points", manager.cookie)).json().rollup).toBeCloseTo(
      2,
      5,
    );
  });

  it("lets the review override the self split, and clears everything on re-open", async () => {
    const admin = await superadmin();
    const { manager, author, mate } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    await inject("PUT", `/journal/${reportId}/participants`, author.cookie, {
      participants: [{ userId: author.id }, { userId: mate.id }],
    });
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [
      { userId: author.id, points: 6 },
      { userId: mate.id, points: 2 },
    ]);
    expect(await ownPoints(author.cookie)).toBe(6);

    // The manager's review is the official figure — it overrides the self split.
    await score(manager.cookie, reportId, [
      { userId: author.id, points: 4 },
      { userId: mate.id, points: 4 },
    ]);
    expect(await ownPoints(author.cookie)).toBe(4);
    expect(await ownPoints(mate.cookie)).toBe(4);

    // Re-opening clears the scores: points are for finished work, and this is back
    // in progress until it is resolved and scored again.
    await inject("POST", `/journal/${reportId}/reopen`, author.cookie);
    expect(await ownPoints(author.cookie)).toBe(0);
    expect(await ownPoints(mate.cookie)).toBe(0);
  });

  it("caps a report at ten points across everyone who worked it", async () => {
    const admin = await superadmin();
    const { author, mate } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    await inject("PUT", `/journal/${reportId}/participants`, author.cookie, {
      participants: [{ userId: author.id }, { userId: mate.id }],
    });
    await finish(author.cookie, reportId);

    // Six and six is twelve — more than one report is worth. Refused.
    const over = await inject("PUT", `/journal/${reportId}/scores`, author.cookie, {
      scores: [
        { userId: author.id, points: 6 },
        { userId: mate.id, points: 6 },
      ],
    });
    expect(over.statusCode).toBe(400);

    // Ten in total is fine.
    await score(author.cookie, reportId, [
      { userId: author.id, points: 6 },
      { userId: mate.id, points: 4 },
    ]);
    expect(await ownPoints(author.cookie)).toBe(6);
  });

  it("locks the self split once a manager has reviewed it", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [{ userId: author.id, points: 5 }]);

    // The manager reviews it.
    await score(manager.cookie, reportId, [{ userId: author.id, points: 8 }]);

    // Now the author cannot move their own split out from under that review.
    const blocked = await inject("PUT", `/journal/${reportId}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 9 }],
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toMatch(/re-open/i);

    // The report tells the author their column is no longer theirs to write.
    expect(
      (await inject("GET", `/journal/${reportId}`, author.cookie)).json().myScoreTier,
    ).toBeNull();
  });

  it("lets a manager re-open a reviewed report by status, freeing the split again", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [{ userId: author.id, points: 5 }]);
    await score(manager.cookie, reportId, [{ userId: author.id, points: 8 }]);
    expect(await ownPoints(author.cookie)).toBe(8);

    // The manager moves it back to a working state — a re-open — which clears the
    // scores so the report can be worked and scored again.
    const statuses = (await inject("GET", "/journal-statuses", manager.cookie)).json();
    const working = statuses.find((s: { group: string }) => s.group === "open");
    expect(
      (
        await inject("PATCH", `/journal/${reportId}/status`, manager.cookie, {
          statusId: working.id,
        })
      ).statusCode,
    ).toBe(200);
    expect(await ownPoints(author.cookie)).toBe(0);

    // And the author may set the split again once it is resolved anew.
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [{ userId: author.id, points: 3 }]);
    expect(await ownPoints(author.cookie)).toBe(3);
  });

  it("keeps the author on the list even when a save leaves them off", async () => {
    const admin = await superadmin();
    const { author, mate } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    // The author sets a list that names only their mate — themselves left off. The
    // author is put back regardless, so the split always includes them and they can
    // always be scored.
    const saved = await inject("PUT", `/journal/${reportId}/participants`, author.cookie, {
      participants: [{ userId: mate.id }],
    });
    const ids = saved.json().map((p: { userId: string }) => p.userId);
    expect(ids).toContain(author.id);
    expect(ids).toContain(mate.id);

    // And so they can score themselves.
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [
      { userId: author.id, points: 5 },
      { userId: mate.id, points: 5 },
    ]);
    expect(await ownPoints(author.cookie)).toBe(5);
  });

  it("refuses someone outside the line from editing who worked it", async () => {
    const admin = await superadmin();
    const { author, outsider, mate } = await buildTeam(admin);
    const reportId = await fileReport(author.cookie);

    // They cannot even see the report, so this is a 404 rather than a 403.
    expect(
      (
        await inject("PUT", `/journal/${reportId}/participants`, outsider.cookie, {
          participants: [{ userId: mate.id }],
        })
      ).statusCode,
    ).toBe(404);
  });
});
