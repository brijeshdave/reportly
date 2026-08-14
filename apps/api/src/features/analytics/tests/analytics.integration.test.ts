// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the analytics surfaces. The parts that must be exactly
// right here are:
//   - the permission matrix: analytics:view is Manager-and-up, NOT Member
//   - the roll-up: a line's figures include its stations and their devices
//   - the refusals: MTBF/MTTR are null when unmeasured, never a confident zero
//   - the timeline: response/resolution derived from real transitions
//   - my-day: sections omitted, not 403'd, when a permission is missing
//
// The permission tests are the point of this file. A unit test proving the maths
// would not have caught SF-004's shape — a rule that is written down and never
// consulted — so every gate below is exercised through a real signed-in caller.
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
  const roles = (await inject("GET", "/roles", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
}

/** author → manager, in one department. */
async function buildChain(admin: string) {
  const memberGroup = await makeGroup(admin, "Reporters", "Member");
  const managerGroup = await makeGroup(admin, "Line managers", "Manager");

  const manager = await makeUser(admin, "Ravi Lead", "ravi", managerGroup);
  const author = await makeUser(admin, "Sam Operator", "sam", memberGroup);

  const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [
      { userId: manager.id, rank: "lead" },
      { userId: author.id, rank: "member", reportsToId: manager.id },
    ],
  });

  return { manager, author, dept };
}

/** Line 3 → Station A, with a device standing at the station. */
async function buildAssets(admin: string) {
  const types = (await inject("GET", "/asset-types", admin)).json();
  const typeId = (Array.isArray(types) ? types : types.data)[0]?.id;

  const line = (await inject("POST", "/assets", admin, { name: "Line 3", typeId })).json();
  const station = (
    await inject("POST", "/assets", admin, { name: "Station A", typeId, parentId: line.id })
  ).json();
  const device = (
    await inject("POST", "/devices", admin, { name: "Welder 7", assetId: station.id })
  ).json();

  return { line, station, device };
}

/** A submitted issue scoped to one target. */
async function fileIssue(
  cookie: string,
  title: string,
  target: { kind: string; id: string },
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await inject("POST", "/journal", cookie, {
    kind: "issue",
    title,
    state: "submitted",
    issueSummary: "Something broke",
    targets: [target],
    ...extra,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

/** Open a downtime entry on a report's target, optionally already closed. */
async function logDowntime(
  cookie: string,
  reportId: string,
  target: { kind: string; id: string },
  startedAt: string,
  endedAt?: string,
): Promise<string> {
  const res = await inject("POST", "/downtime", cookie, {
    reportId,
    targetKind: target.kind,
    targetId: target.id,
    startedAt,
    ...(endedAt ? { endedAt } : {}),
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("analytics permissions", () => {
  it("refuses a Member and admits a Manager", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildChain(admin);
    const { line } = await buildAssets(admin);

    // The gate that matters: `analytics:view` is deliberately outside the seed's
    // `:read` filter, so Member — who holds every other read in the domain — must
    // not have it.
    expect((await inject("GET", `/analytics/assets/${line.id}`, author.cookie)).statusCode).toBe(
      403,
    );
    expect((await inject("GET", "/analytics/recurring", author.cookie)).statusCode).toBe(403);

    expect((await inject("GET", `/analytics/assets/${line.id}`, manager.cookie)).statusCode).toBe(
      200,
    );
    expect((await inject("GET", "/analytics/recurring", manager.cookie)).statusCode).toBe(200);
  });

  it("404s an asset in another company rather than leaking that it exists", async () => {
    const admin = await superadmin();
    const { manager } = await buildChain(admin);

    const other = (await inject("POST", "/companies", admin, { name: "Other Co" })).json();
    const types = (await inject("GET", "/asset-types", admin)).json();
    const typeId = (Array.isArray(types) ? types : types.data)[0]?.id;
    const foreign = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/assets`,
      headers: { cookie: admin, "x-company-id": other.id },
      payload: { name: "Their line", typeId },
    });

    const res = await inject("GET", `/analytics/assets/${foreign.json().id}`, manager.cookie);
    expect(res.statusCode).toBe(404);
  });
});

describe("asset reliability", () => {
  it("rolls a line's figures up from its stations and their devices", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildChain(admin);
    const { line, station, device } = await buildAssets(admin);

    // Two outages: one on the station, one on the device standing at it. Neither is
    // logged against the line itself — which is the point. Downtime is recorded on
    // the most specific thing that was down, and the line's total is the sum.
    const r1 = await fileIssue(author.cookie, "Station jam", { kind: "asset", id: station.id });
    await logDowntime(
      author.cookie,
      r1,
      { kind: "asset", id: station.id },
      "2026-07-10T08:00:00.000Z",
      "2026-07-10T09:00:00.000Z", // 60 min
    );

    const r2 = await fileIssue(author.cookie, "Welder down", { kind: "device", id: device.id });
    await logDowntime(
      author.cookie,
      r2,
      { kind: "device", id: device.id },
      "2026-07-11T08:00:00.000Z",
      "2026-07-11T08:30:00.000Z", // 30 min
    );

    const res = await inject(
      "GET",
      `/analytics/assets/${line.id}?from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z`,
      manager.cookie,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // The line never had an entry of its own, yet it reports both.
    expect(body.total.failures).toBe(2);
    expect(body.total.totalDowntimeMinutes).toBe(90);
    expect(body.total.mttrMinutes).toBe(45); // (60 + 30) / 2
    expect(body.total.mtbfHours).toBeGreaterThan(0);

    // And the child breaks it down: the station subtree carries both, because the
    // device lives at it.
    const stationRow = body.children.find((c: { assetId: string }) => c.assetId === station.id);
    expect(stationRow.failures).toBe(2);
    expect(stationRow.totalDowntimeMinutes).toBe(90);

    // The window is echoed back, because every figure above moves with it.
    expect(body.window.from).toBe("2026-07-01T00:00:00.000Z");
    expect(body.window.hours).toBe(720);
  });

  it("reports MTBF as null, not zero, for an asset that never failed", async () => {
    const admin = await superadmin();
    const { manager } = await buildChain(admin);
    const { line } = await buildAssets(admin);

    const body = (
      await inject(
        "GET",
        `/analytics/assets/${line.id}?from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z`,
        manager.cookie,
      )
    ).json();

    // Unmeasured, not perfect. Zero here would rank a healthy line as the worst in
    // the plant on any "sort by MTBF" screen.
    expect(body.total.failures).toBe(0);
    expect(body.total.mtbfHours).toBeNull();
    expect(body.total.mttrMinutes).toBeNull();
    expect(body.total.availabilityPct).toBe(100);
  });

  it("excludes a still-open outage from MTTR but counts it as a failure", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildChain(admin);
    const { line, station } = await buildAssets(admin);

    const r1 = await fileIssue(author.cookie, "Closed one", { kind: "asset", id: station.id });
    await logDowntime(
      author.cookie,
      r1,
      { kind: "asset", id: station.id },
      "2026-07-10T08:00:00.000Z",
      "2026-07-10T09:00:00.000Z",
    );
    const r2 = await fileIssue(author.cookie, "Still down", { kind: "asset", id: station.id });
    await logDowntime(
      author.cookie,
      r2,
      { kind: "asset", id: station.id },
      "2026-07-12T08:00:00.000Z",
    );

    const body = (
      await inject(
        "GET",
        `/analytics/assets/${line.id}?from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z`,
        manager.cookie,
      )
    ).json();

    expect(body.total.failures).toBe(2);
    expect(body.total.openCount).toBe(1);
    // The mean of the *finished* repairs only — an open outage has no duration yet,
    // and averaging in a partial one would report a repair time that keeps changing.
    expect(body.total.mttrMinutes).toBe(60);
  });
});

describe("recurring issues", () => {
  it("groups repeat issues by what they are about, and ignores one-offs", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildChain(admin);
    const { line, station, device } = await buildAssets(admin);

    // /departments returns a plain array, not a paginated envelope.
    const dept = (await inject("GET", "/departments", admin)).json()[0];
    const category = (
      await inject("POST", "/categories", admin, { departmentId: dept.id, name: "Mechanical" })
    ).json();

    // The station jams three times...
    for (const day of ["05", "12", "19"]) {
      await fileIssue(
        author.cookie,
        "Belt seized",
        { kind: "asset", id: station.id },
        { categoryId: category.id, reportDate: `2026-07-${day}T08:00:00.000Z` },
      );
    }
    // ...and the welder fails once. One is not a pattern.
    await fileIssue(
      author.cookie,
      "Tip burnt out",
      { kind: "device", id: device.id },
      { categoryId: category.id, reportDate: "2026-07-06T08:00:00.000Z" },
    );

    const body = (
      await inject(
        "GET",
        "/analytics/recurring?from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z",
        manager.cookie,
      )
    ).json();

    expect(body.items).toHaveLength(1);
    const [row] = body.items;
    expect(row.targetId).toBe(station.id);
    expect(row.targetLabel).toBe("Station A");
    expect(row.categoryName).toBe("Mechanical");
    expect(row.count).toBe(3);
    // 5th → 19th is 14 days across TWO gaps, so 7 — not 14/3. The off-by-one would
    // understate every interval and make everything look more urgent than it is.
    expect(row.meanGapDays).toBe(7);

    // Narrowing to the line's subtree still finds it: the station is under it.
    const scoped = (
      await inject(
        "GET",
        `/analytics/recurring?assetId=${line.id}&from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z`,
        manager.cookie,
      )
    ).json();
    expect(scoped.items).toHaveLength(1);
  });
});

describe("report timeline", () => {
  it("derives response and resolution from real transitions", async () => {
    const admin = await superadmin();
    const { author } = await buildChain(admin);

    // The seeded ladder: Open → Acknowledged → In progress → Resolved. Note that
    // every non-terminal status sits in group `open` — which is exactly why the
    // response rule counts any move rather than a move out of that group.
    const list = (await inject("GET", "/journal-statuses", admin)).json();
    const open = list.find((s: { name: string }) => s.name === "Open");
    const working = list.find((s: { name: string }) => s.name === "In progress");
    const done = list.find((s: { name: string }) => s.name === "Resolved");
    expect(open.group).toBe("open");
    expect(working.group).toBe("open"); // the coarse-group trap, pinned
    expect(done.isTerminal).toBe(true);

    const res = await inject("POST", "/journal", author.cookie, {
      kind: "issue",
      title: "Bearing noise",
      state: "submitted",
      issueSummary: "Grinding",
      statusId: open.id,
    });
    const id = res.json().id;

    // Creation alone: the clock has started, nothing else has happened.
    let timeline = (await inject("GET", `/journal/${id}/timeline`, author.cookie)).json();
    expect(timeline.events).toHaveLength(1);
    expect(timeline.events[0].fromStatusId).toBeNull();
    expect(timeline.timing.respondedAt).toBeNull();
    expect(timeline.timing.resolvedAt).toBeNull();

    await inject("PATCH", `/journal/${id}`, author.cookie, { statusId: working.id });
    await inject("PATCH", `/journal/${id}`, author.cookie, { statusId: done.id });

    timeline = (await inject("GET", `/journal/${id}/timeline`, author.cookie)).json();
    expect(timeline.events).toHaveLength(3);
    expect(timeline.timing.respondedAt).not.toBeNull();
    expect(timeline.timing.resolvedAt).not.toBeNull();
    expect(timeline.timing.reopened).toBe(false);
    expect(timeline.timing.timeToResolveMinutes).toBeGreaterThanOrEqual(0);

    // Reopening: it is open again, so it is NOT resolved — and the flag says why.
    await inject("PATCH", `/journal/${id}`, author.cookie, { statusId: working.id });
    timeline = (await inject("GET", `/journal/${id}/timeline`, author.cookie)).json();
    expect(timeline.timing.resolvedAt).toBeNull();
    expect(timeline.timing.reopened).toBe(true);
  });

  it("does not log a transition for an edit that never touched the status", async () => {
    const admin = await superadmin();
    const { author } = await buildChain(admin);

    const id = (
      await inject("POST", "/journal", author.cookie, {
        kind: "work",
        title: "Routine check",
        state: "draft",
        workSummary: "Looked at it",
      })
    ).json().id;

    await inject("PATCH", `/journal/${id}`, author.cookie, { title: "Routine check (am)" });

    const timeline = (await inject("GET", `/journal/${id}/timeline`, author.cookie)).json();
    // Still just the creation event: a title edit is not a status change.
    expect(timeline.events).toHaveLength(1);
  });

  it("hides a timeline from someone who cannot see the report", async () => {
    const admin = await superadmin();
    const { author } = await buildChain(admin);
    const otherGroup = await makeGroup(admin, "Outsiders", "Member");
    const outsider = await makeUser(admin, "Nina Outside", "nina", otherGroup);

    const id = (
      await inject("POST", "/journal", author.cookie, {
        kind: "work",
        title: "Not yours",
        state: "submitted",
        workSummary: "Done",
      })
    ).json().id;

    // The timeline says who touched the report and when — exactly as sensitive as
    // the report, and gated by the same rule rather than a copy of it.
    expect((await inject("GET", `/journal/${id}`, outsider.cookie)).statusCode).toBe(404);
    expect((await inject("GET", `/journal/${id}/timeline`, outsider.cookie)).statusCode).toBe(404);
  });
});

describe("my day", () => {
  it("omits sections the caller may not see, rather than failing", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildChain(admin);

    const asMember = await inject("GET", "/my-day", author.cookie);
    expect(asMember.statusCode).toBe(200);
    const member = asMember.json();

    // A Member holds reports:create and downtime:write but not reports:appraise —
    // so the "awaiting your mark" tile is ABSENT, not empty. An empty array would
    // tell them they are clear of work they can never be given.
    expect(member.pendingAppraisals).toBeUndefined();
    expect(member.points).toBeDefined();
    expect(member.openDowntimes).toBeDefined(); // downtime:read is granted to Member

    // A Manager appraises, so they get the tile.
    const asManager = (await inject("GET", "/my-day", manager.cookie)).json();
    expect(asManager.pendingAppraisals).toBeDefined();
  });

  it("counts the caller's own reports for their own local day", async () => {
    const admin = await superadmin();
    const { author } = await buildChain(admin);

    await inject("POST", "/journal", author.cookie, {
      kind: "work",
      title: "Filed just now",
      state: "submitted",
      workSummary: "Done",
    });
    await inject("POST", "/journal", author.cookie, {
      kind: "work",
      title: "Half typed",
      state: "draft",
    });

    const body = (await inject("GET", "/my-day?tzOffsetMinutes=330", author.cookie)).json();

    expect(body.myReports.length).toBeGreaterThanOrEqual(1);
    expect(body.myReports.some((r: { title: string }) => r.title === "Filed just now")).toBe(true);
    // Drafts are counted, never windowed: a forgotten draft from last week is the
    // one worth nagging about.
    expect(body.draftCount).toBe(1);

    // The day the server used is the caller's, and it contains 'now'.
    const now = Date.now();
    expect(new Date(body.dayStart).getTime()).toBeLessThanOrEqual(now);
    expect(new Date(body.dayEnd).getTime()).toBeGreaterThan(now);
  });

  it("shows the caller their own unclosed outage, not their team's", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildChain(admin);
    const { station } = await buildAssets(admin);

    const reportId = await fileIssue(author.cookie, "Jam", { kind: "asset", id: station.id });
    await logDowntime(
      author.cookie,
      reportId,
      { kind: "asset", id: station.id },
      new Date().toISOString(),
    );

    const authorDay = (await inject("GET", "/my-day", author.cookie)).json();
    expect(authorDay.openDowntimes).toHaveLength(1);
    expect(authorDay.openDowntimes[0].targetLabel).toBe("Station A");
    expect(authorDay.openDowntimes[0].openForMinutes).toBeGreaterThanOrEqual(0);

    // The manager can see this outage in the company pending queue — but their home
    // screen nags them about their own work, not their team's. A to-do list of other
    // people's jobs is a to-do list people stop reading.
    const managerDay = (await inject("GET", "/my-day", manager.cookie)).json();
    expect(managerDay.openDowntimes).toHaveLength(0);
  });
});

describe("insights charts", () => {
  /** A role by name, filtered rather than paged: there are thirty-odd now. */
  async function roleIdByName(admin: string, name: string): Promise<string> {
    const filters = encodeURIComponent(JSON.stringify([{ field: "name", op: "eq", value: name }]));
    const body = (await inject("GET", `/roles?filters=${filters}`, admin)).json();
    return body.data[0].id as string;
  }

  it("returns every series for the caller's company", async () => {
    const admin = await superadmin();
    await buildAssets(admin);

    const res = await inject("GET", "/insights", admin);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // The window travels with the figures — a chart that cannot state its period
    // invites the reader to assume the wrong one.
    expect(body.window.from).toBeTruthy();
    expect(body.window.to).toBeTruthy();
    for (const key of [
      "issuesOverTime",
      "issuesByCategory",
      "downtimeByAsset",
      "pointsByPerson",
      "pointsByDepartment",
      "entriesByStatus",
    ]) {
      expect(Array.isArray(body[key]), `${key} should be an array`).toBe(true);
    }
  });

  it("refuses a caller who holds analytics:view but not insights:view", async () => {
    // The whole reason the permission is its own: an organisation can hand out the
    // reliability figures without the charts, and the other way round.
    const admin = await superadmin();
    const group = (await inject("POST", "/groups", admin, { name: "Analytics only" })).json();
    const role = (
      await inject("POST", "/roles", admin, {
        name: "Analytics only",
        permissions: ["analytics:view", "journal:read"],
      })
    ).json();
    await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });

    const signUp = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-up/email`,
      payload: { email: "charts@acme.test", password: "Ch4rtsOnly!pass", name: "Charts Only" },
    });
    const cookie = cookieFrom(signUp);
    const filters = encodeURIComponent(
      JSON.stringify([{ field: "email", op: "eq", value: "charts@acme.test" }]),
    );
    const person = (await inject("GET", `/users?filters=${filters}`, admin)).json().data[0];
    await inject("PUT", `/users/${person.id}/groups`, admin, { ids: [group.id] });
    await inject("PUT", `/users/${person.id}/companies`, admin, { ids: [DEMO_COMPANY_ID] });

    // Analytics is open to them; Insights is not.
    expect((await inject("GET", "/analytics/recurring", cookie)).statusCode).toBe(200);
    expect((await inject("GET", "/insights", cookie)).statusCode).toBe(403);

    // Grant it and the same caller gets through — proving the guard is the
    // permission and not something incidental about the account.
    const insightsRole = await roleIdByName(admin, "Insights viewer");
    await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id, insightsRole] });
    expect((await inject("GET", "/insights", cookie)).statusCode).toBe(200);
  });
});
