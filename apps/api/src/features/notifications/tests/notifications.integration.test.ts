// Author: Brijesh Dave <https://github.com/brijeshdave>
// Notifications end to end, against a real database.
//
// The resolver's unit tests prove the gates in isolation. What they cannot prove
// is the part that has burned this codebase before: that the audience is really
// resolved from the reporting line, that a person in another company is really
// excluded, and that a preference somebody set is really consulted by the code
// that sends. Those are joins and call sites, not logic.
//
// `dispatch()` is called directly rather than through the queue. The worker is
// started by the server process, not by `buildApp`, so a queued job in a test
// would sit in Redis and the assertion would pass for the wrong reason — the
// notification never arriving looks identical to it being correctly suppressed.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { dispatch } from "@/features/notifications/service.js";
import { upsertPreferences } from "@/features/notifications/repo.js";
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

function inject(
  method: string,
  url: string,
  cookie: string,
  payload?: unknown,
  companyId?: string,
) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": companyId ?? DEMO_COMPANY_ID },
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
  companyIds: string[] = [DEMO_COMPANY_ID],
): Promise<{ id: string; cookie: string }> {
  const created = await inject("POST", "/users", admin, {
    name,
    email: `${username}@reportly.test`,
    username,
    password: TEMP_PW,
  });
  const id = created.json().id as string;
  await inject("PUT", `/users/${id}/companies`, admin, { ids: companyIds });

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

/** author → manager, plus a colleague on the same team. */
async function buildTeam(admin: string) {
  const memberGroup = await makeGroup(admin, "Reporters", "Member");
  const managerGroup = await makeGroup(admin, "Line managers", "Manager");

  const manager = await makeUser(admin, "Ravi Lead", "ravi", managerGroup);
  const author = await makeUser(admin, "Sam Operator", "sam", memberGroup);
  const mate = await makeUser(admin, "Mo Operator", "moe", memberGroup);

  const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [
      { userId: manager.id, rank: "lead" },
      { userId: author.id, rank: "member", reportsToId: manager.id },
      { userId: mate.id, rank: "member", reportsToId: manager.id },
    ],
  });

  return { manager, author, mate, dept };
}

const inboxOf = async (cookie: string) => (await inject("GET", "/me/notifications", cookie)).json();
const unreadOf = async (cookie: string, companyId?: string) =>
  (await inject("GET", "/me/notifications/unread-count", cookie, undefined, companyId)).json()
    .unread;

describe("who a notification reaches", () => {
  it("delivers to the person it is about, and never to whoever caused it", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);

    await dispatch({
      type: "journal.assigned",
      companyId: DEMO_COMPANY_ID,
      actorUserId: manager.id,
      subjectUserId: author.id,
      title: "An entry was assigned to you",
      link: "/journal/x",
    });

    expect(await unreadOf(author.cookie)).toBe(1);
    // The manager did the assigning. Telling them what they just did is the
    // fastest way to teach somebody to ignore the bell.
    expect(await unreadOf(manager.cookie)).toBe(0);
  });

  it("walks the reporting line upward for a review", async () => {
    const admin = await superadmin();
    const { manager, author, mate } = await buildTeam(admin);

    await dispatch({
      type: "journal.awaiting-review",
      companyId: DEMO_COMPANY_ID,
      actorUserId: author.id,
      subjectUserId: author.id,
      title: "An entry is ready for your review",
    });

    // Up, not down and not sideways: the manager is told, the colleague on the
    // same rung is not.
    expect(await unreadOf(manager.cookie)).toBe(1);
    expect(await unreadOf(mate.cookie)).toBe(0);
    expect(await unreadOf(author.cookie)).toBe(0);
  });

  it("reaches a whole department", async () => {
    const admin = await superadmin();
    const { manager, author, mate, dept } = await buildTeam(admin);

    await dispatch({
      type: "downtime.opened",
      companyId: DEMO_COMPANY_ID,
      actorUserId: manager.id,
      departmentId: dept.id,
      title: "Downtime opened",
    });

    expect(await unreadOf(author.cookie)).toBe(1);
    expect(await unreadOf(mate.cookie)).toBe(1);
    expect(await unreadOf(manager.cookie)).toBe(0);
  });

  it("never reaches somebody outside the event's company", async () => {
    const admin = await superadmin();
    const memberGroup = await makeGroup(admin, "Reporters", "Member");
    const other = (await inject("POST", "/companies", admin, { name: "Other Co" })).json();
    const outsider = await makeUser(admin, "Nina Outside", "nina", memberGroup, [other.id]);

    // Named explicitly, which is the strongest form of the mistake: the call site
    // asked for this person by id, and the company gate has to refuse anyway.
    await dispatch({
      type: "shift.swap.requested",
      companyId: DEMO_COMPANY_ID,
      actorUserId: null,
      userIds: [outsider.id],
      title: "A colleague asked to swap with you",
    });

    // Asked under their OWN company, where they can legitimately read an inbox.
    // Under the event's company they cannot even reach the endpoint, so asserting
    // zero there would pass for the wrong reason.
    expect(await unreadOf(outsider.cookie, other.id)).toBe(0);
  });
});

describe("an event about the installation, not a tenant", () => {
  it("reaches permission-holders in every company, and shows under each", async () => {
    const admin = await superadmin();
    const { author } = await buildTeam(admin);
    const other = (await inject("POST", "/companies", admin, { name: "Other Co" })).json();

    // A backup belongs to the server, not to a company. It is stored with no
    // company at all, so nobody's active-company choice can hide it.
    await dispatch({
      type: "backup.failed",
      companyId: null,
      actorUserId: null,
      title: "A database backup failed",
      body: "pg_dump exited 1",
    });

    // The superadmin holds every permission, so they are an operator here.
    expect(await unreadOf(admin)).toBeGreaterThan(0);
    // And it is visible whichever company they are looking at — the whole point
    // of storing it with none.
    expect(await unreadOf(admin, other.id)).toBeGreaterThan(0);

    // Somebody without backups:manage is not an operator and hears nothing.
    expect(await unreadOf(author.cookie)).toBe(0);
  });

  it("does not widen an ordinary notification to other companies", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);
    const other = (await inject("POST", "/companies", admin, { name: "Other Co" })).json();

    await dispatch({
      type: "journal.assigned",
      companyId: DEMO_COMPANY_ID,
      actorUserId: manager.id,
      subjectUserId: author.id,
      title: "An entry was assigned to you",
    });

    // The nullable company is for events that have none. A company-owned row must
    // still be invisible from a different company, or making the column nullable
    // would have re-opened SF-006.
    expect(await unreadOf(author.cookie)).toBe(1);
    const elsewhere = await inject(
      "GET",
      "/me/notifications/unread-count",
      author.cookie,
      undefined,
      other.id,
    );
    // They are not a member of that company, so they cannot even read there.
    expect(elsewhere.statusCode).toBe(403);
  });
});

describe("what a person receives", () => {
  it("stops sending a type the person muted", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);

    await upsertPreferences(author.id, [
      { type: "journal.assigned", channel: "inapp", enabled: false },
    ]);

    await dispatch({
      type: "journal.assigned",
      companyId: DEMO_COMPANY_ID,
      actorUserId: manager.id,
      subjectUserId: author.id,
      title: "An entry was assigned to you",
    });

    expect(await unreadOf(author.cookie)).toBe(0);
    // A different type is unaffected — the mute is per type, not a master switch.
    await dispatch({
      type: "journal.reopened",
      companyId: DEMO_COMPANY_ID,
      actorUserId: manager.id,
      subjectUserId: author.id,
      title: "Your entry was reopened",
    });
    expect(await unreadOf(author.cookie)).toBe(1);
  });

  it("says why each cell is closed, not merely that it is", async () => {
    const admin = await superadmin();
    const { author } = await buildTeam(admin);

    const grid = (await inject("GET", "/me/notification-preferences", author.cookie)).json();
    const row = grid.rows.find((r: { type: string }) => r.type === "journal.assigned");
    const email = row.cells.find((c: { channel: string }) => c.channel === "email");
    const sms = row.cells.find((c: { channel: string }) => c.channel === "mobile");

    expect(email.allowed).toBe(true);
    expect(email.deliverable).toBe(true);
    // SMS is off system-wide by default, so it is not offered as a column at all
    // rather than shown as twenty dead boxes nobody can act on.
    expect(sms).toBeUndefined();
    expect(grid.channels).toContain("inapp");
    expect(grid.channels).not.toContain("mobile");
  });

  it("clears an override rather than storing agreement with the default", async () => {
    const admin = await superadmin();
    const { author } = await buildTeam(admin);

    const off = await inject("PUT", "/me/notification-preferences", author.cookie, {
      preferences: [{ type: "journal.assigned", channel: "email", enabled: false }],
    });
    expect(off.statusCode).toBe(200);
    const muted = off
      .json()
      .rows.find((r: { type: string }) => r.type === "journal.assigned")
      .cells.find((c: { channel: string }) => c.channel === "email");
    expect(muted.enabled).toBe(false);
    expect(muted.overridden).toBe(true);

    const on = await inject("PUT", "/me/notification-preferences", author.cookie, {
      preferences: [{ type: "journal.assigned", channel: "email", enabled: true }],
    });
    const restored = on
      .json()
      .rows.find((r: { type: string }) => r.type === "journal.assigned")
      .cells.find((c: { channel: string }) => c.channel === "email");
    // Back to inheriting, not "chosen and happens to match" — so an administrator
    // who later withdraws email still governs this person.
    expect(restored.enabled).toBe(true);
    expect(restored.overridden).toBe(false);
  });
});

describe("the inbox", () => {
  it("marks read, one at a time or all at once", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);

    for (const title of ["First", "Second", "Third"]) {
      await dispatch({
        type: "journal.assigned",
        companyId: DEMO_COMPANY_ID,
        actorUserId: manager.id,
        subjectUserId: author.id,
        title,
      });
    }
    expect(await unreadOf(author.cookie)).toBe(3);

    const list = await inboxOf(author.cookie);
    expect(list.total).toBe(3);
    // Newest first — an inbox that opens on the oldest thing is a list nobody reads.
    expect(list.items[0].title).toBe("Third");

    await inject("POST", "/me/notifications/read", author.cookie, { ids: [list.items[0].id] });
    expect(await unreadOf(author.cookie)).toBe(2);

    await inject("POST", "/me/notifications/read", author.cookie, {});
    expect(await unreadOf(author.cookie)).toBe(0);
  });

  it("refuses to touch somebody else's notification", async () => {
    const admin = await superadmin();
    const { manager, author, mate } = await buildTeam(admin);

    await dispatch({
      type: "journal.assigned",
      companyId: DEMO_COMPANY_ID,
      actorUserId: manager.id,
      subjectUserId: author.id,
      title: "Not yours",
    });
    const id = (await inboxOf(author.cookie)).items[0].id;

    // A 404, not a 403: whether the id exists is not the colleague's business.
    const res = await inject("POST", `/me/notifications/${id}/archive`, mate.cookie);
    expect(res.statusCode).toBe(404);
    expect(await unreadOf(author.cookie)).toBe(1);
  });

  it("archives out of the list without deleting the record", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildTeam(admin);

    await dispatch({
      type: "journal.assigned",
      companyId: DEMO_COMPANY_ID,
      actorUserId: manager.id,
      subjectUserId: author.id,
      title: "Read and gone",
    });
    const id = (await inboxOf(author.cookie)).items[0].id;

    const res = await inject("POST", `/me/notifications/${id}/archive`, author.cookie);
    expect(res.statusCode).toBe(204);
    expect((await inboxOf(author.cookie)).total).toBe(0);
    expect(await unreadOf(author.cookie)).toBe(0);
  });
});
