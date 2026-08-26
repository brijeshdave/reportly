// Author: Brijesh Dave <https://github.com/brijeshdave>
// A reporting manager scoring their own team.
//
// Reported from use: "as HOD I am able to review all journal points but the
// reporting managers should also be able to do that — for them there is no way to
// enter points. Maybe their awaiting reviews are also not showing for their team."
//
// Both symptoms, one cause, and it was never the scoring rule: anyone above the
// author holding `journal:appraise` may review. That permission lived in exactly
// two roles — the Manager system role and "Journal admin" — while the area role a
// line manager would hold, "Journal editor", explicitly "does not score anyone".
// So a manager either became a journal administrator or could not score at all,
// and the Reviews page hides the queue entirely without the permission (it does not
// even fetch it), which is why their team's entries appeared to be missing too.
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
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  expect(role, `role ${roleName} should exist`).toBeTruthy();
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
}

async function makeUser(admin: string, name: string, username: string, groupId: string) {
  const created = await inject("POST", "/users", admin, {
    name,
    username,
    email: `${username}@reportly.test`,
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

/** A manager holding `roleName`, with one person reporting to them, and a finished entry. */
async function chainWith(roleName: string) {
  const admin = await superadmin();
  const managerGroup = await makeGroup(admin, `${roleName} group`, roleName);
  const memberGroup = await makeGroup(admin, "Reporters", "Journal editor");

  const manager = await makeUser(admin, "Ravi Lead", "ravi", managerGroup);
  const author = await makeUser(admin, "Sam Operator", "sam", memberGroup);

  const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [
      { userId: manager.id, rank: "lead" },
      { userId: author.id, rank: "member", reportsToId: manager.id },
    ],
  });

  const severities = (await inject("GET", "/severities", admin)).json();
  const filed = await inject("POST", "/journal", author.cookie, {
    kind: "issue",
    title: "Conveyor jam",
    state: "submitted",
    severityId: severities[0].id,
    issueSummary: "Belt seized",
  });
  expect(filed.statusCode).toBe(201);
  const reportId = filed.json().id as string;

  // Points are for finished work, so move it to a terminal status.
  const statuses = (await inject("GET", "/journal-statuses", admin)).json();
  const resolved = statuses.find((s: { name: string }) => s.name === "Resolved");
  await inject("PATCH", `/journal/${reportId}/status`, admin, { statusId: resolved.id });

  return { manager, author, reportId };
}

describe("a reporting manager who is not the HOD", () => {
  it("can score their own direct report with the reviewer role", async () => {
    const { manager, author, reportId } = await chainWith("Journal reviewer");

    const scored = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 4 }],
    });
    expect(scored.statusCode).toBe(200);

    // And it landed as the *review*, not as the author's own split.
    const detail = (await inject("GET", `/journal/${reportId}`, manager.cookie)).json();
    expect(detail.myScoreTier).toBe("review");
  });

  it("sees that entry in their own review queue", async () => {
    // The other half of the report. The queue walks the reporting line, so it is
    // the manager's to clear — not only the HOD's.
    const { author, manager, reportId } = await chainWith("Journal reviewer");

    const pending = (await inject("GET", "/journal/pending", manager.cookie)).json() as {
      reportId: string;
      authorId: string;
      depth: number;
    }[];
    expect(pending.map((row) => row.reportId)).toContain(reportId);
    const row = pending.find((candidate) => candidate.reportId === reportId)!;
    expect(row.authorId).toBe(author.id);
    // Their own direct report: one step down the line.
    expect(row.depth).toBe(1);
  });

  it("still cannot score with the editor role, which does not review anybody", async () => {
    // The hole this closed, kept as a fact: "Journal editor" files entries and
    // scores nobody, and that is deliberate — the new role is what a line manager
    // holds instead.
    const { manager, author, reportId } = await chainWith("Journal editor");

    const refused = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 4 }],
    });
    expect(refused.statusCode).toBe(403);

    const detail = (await inject("GET", `/journal/${reportId}`, manager.cookie)).json();
    expect(detail.myScoreTier).toBeNull();
  });
});

describe("rejecting an entry", () => {
  it("moves it out of Resolved and freezes it", async () => {
    // Reported from use: "currently rejected stays with status of whatever it has
    // even if it is resolved" — the entry read Resolved and rejected at once.
    const { manager, reportId } = await chainWith("Journal reviewer");

    const rejected = await inject("POST", `/journal/${reportId}/reject`, manager.cookie, {
      reason: "Duplicate of last week's",
    });
    expect(rejected.statusCode).toBe(200);

    const after = (await inject("GET", `/journal/${reportId}`, manager.cookie)).json();
    expect(after.statusGroup).toBe("rejected");
    expect(after.rejectedAt).not.toBeNull();

    // Frozen: no walking it back into the workflow while it stands rejected.
    const statuses = (await inject("GET", "/journal-statuses", manager.cookie)).json();
    const open = statuses.find((s: { group: string }) => s.group === "open");
    const moved = await inject("PATCH", `/journal/${reportId}/status`, manager.cookie, {
      statusId: open.id,
    });
    expect(moved.statusCode).toBe(409);

    const reopened = await inject("POST", `/journal/${reportId}/reopen`, manager.cookie);
    expect(reopened.statusCode).toBe(409);
  });

  it("earns nothing while rejected", async () => {
    const { manager, author, reportId } = await chainWith("Journal reviewer");
    // Asserted, not assumed: `reason` is an optional *string*, so passing null is a
    // 400 and the entry is never rejected — which made this test pass by testing
    // nothing at all.
    const rejected = await inject("POST", `/journal/${reportId}/reject`, manager.cookie, {
      reason: "Not our work",
    });
    expect(rejected.statusCode).toBe(200);

    const scored = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 4 }],
    });
    expect(scored.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("puts it back where it was when the rejection is lifted", async () => {
    // Not a guess at "Resolved": an entry rejected while still in progress should
    // not come back resolved.
    const { manager, reportId } = await chainWith("Journal reviewer");
    const before = (await inject("GET", `/journal/${reportId}`, manager.cookie)).json();

    const rejected = await inject("POST", `/journal/${reportId}/reject`, manager.cookie, {
      reason: "Filed twice",
    });
    expect(rejected.statusCode).toBe(200);
    const lifted = await inject("POST", `/journal/${reportId}/unreject`, manager.cookie);
    expect(lifted.statusCode).toBe(200);

    const after = (await inject("GET", `/journal/${reportId}`, manager.cookie)).json();
    expect(after.statusId).toBe(before.statusId);
    expect(after.rejectedAt).toBeNull();
  });
});
