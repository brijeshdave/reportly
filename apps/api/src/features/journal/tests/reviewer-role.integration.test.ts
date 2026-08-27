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
async function chainWith(roleName: string, severityId?: string) {
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
    severityId: severityId ?? severities[0].id,
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
    // The author splits the points first — a review confirms a number somebody put
    // forward, so nothing reaches a reviewer's queue before that.
    await inject("PUT", `/journal/${reportId}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 3 }],
    });

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
    // By name, not merely by group. Taking whichever rejected status sorted first
    // landed on "Duplicate" — a claim about the entry that nobody made.
    expect(after.statusName).toBe("Rejected");
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

describe("the self split comes first", () => {
  it("keeps an unscored entry out of the reviewer's queue", async () => {
    // Reported from use: "journal should only be shown to reviewer if self
    // appraisal is done". A review is a manager confirming or nudging a number the
    // worker put forward, so until that number exists there is nothing to review.
    const { manager, author, reportId } = await chainWith("Journal reviewer");

    const before = (await inject("GET", "/journal/pending", manager.cookie)).json() as {
      reportId: string;
    }[];
    expect(before.map((row) => row.reportId)).not.toContain(reportId);

    // The author splits the points; now it is the manager's to review.
    const self = await inject("PUT", `/journal/${reportId}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 3 }],
    });
    expect(self.statusCode).toBe(200);

    const after = (await inject("GET", "/journal/pending", manager.cookie)).json() as {
      reportId: string;
    }[];
    expect(after.map((row) => row.reportId)).toContain(reportId);
  });

  it("tells the author it is waiting on them, not on their manager", async () => {
    const { author, reportId } = await chainWith("Journal reviewer");

    const mine = (await inject("GET", "/journal/awaiting-review", author.cookie)).json() as {
      reportId: string;
      needsSelfScore: boolean;
    }[];
    const row = mine.find((candidate) => candidate.reportId === reportId);
    expect(row?.needsSelfScore).toBe(true);

    await inject("PUT", `/journal/${reportId}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 3 }],
    });

    const after = (await inject("GET", "/journal/awaiting-review", author.cookie)).json() as {
      reportId: string;
      needsSelfScore: boolean;
    }[];
    expect(after.find((candidate) => candidate.reportId === reportId)?.needsSelfScore).toBe(false);
  });
});

describe("what a severity is worth", () => {
  it("refuses more points than the severity allows", async () => {
    // Reported from use: "each severity is having 10 points and all users are
    // getting 10 points even if the issue is very small". A ceiling per severity,
    // enforced here — a column nothing checked is how the last weight field died.
    const admin = await superadmin();
    const severities = (await inject("GET", "/severities", admin)).json();
    const lowest = severities[0];
    await inject("PATCH", `/severities/${lowest.id}`, admin, { maxPoints: 3 });

    const { manager, author, reportId } = await chainWith("Journal reviewer", lowest.id);
    await inject("PUT", `/journal/${reportId}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 1 }],
    });

    const tooMuch = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 4 }],
    });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json().error.message).toContain("3");

    const allowed = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 3 }],
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("leaves every severity at ten until somebody sets one", async () => {
    // The upgrade must change nothing: ten is what an entry was worth before.
    const admin = await superadmin();
    const severities = (await inject("GET", "/severities", admin)).json() as {
      maxPoints: number;
    }[];
    expect(severities.every((s) => s.maxPoints === 10)).toBe(true);
  });
});

describe("what reaches the leaderboard", () => {
  it("counts nothing until a manager has reviewed it", async () => {
    // Reported from use: "leaderboard should only calculate the points after that
    // thing is get review by his manager and points as per him get committed, not
    // the one user give him self". The ledger used to fall back to the self number,
    // so points somebody gave themselves counted publicly straight away.
    const { manager, author, reportId } = await chainWith("Journal reviewer");

    await inject("PUT", `/journal/${reportId}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 6 }],
    });
    const afterSelf = (await inject("GET", "/journal/points", author.cookie)).json() as {
      own: number;
    };
    expect(afterSelf.own).toBe(0);

    // The manager settles it, and now it counts — at the manager's number.
    await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 4 }],
    });
    const afterReview = (await inject("GET", "/journal/points", author.cookie)).json() as {
      own: number;
    };
    expect(afterReview.own).toBe(4);
  });
});

describe("lowering a ceiling under an entry that is already half-scored", () => {
  it("leaves the self split alone and caps the review at the new number", async () => {
    // His question: what happens to an entry whose author has split the points but
    // whose review is still pending, when the severity's ceiling is then lowered
    // below that split?
    const admin = await superadmin();
    const severities = (await inject("GET", "/severities", admin)).json();
    const severity = severities[0];

    const { manager, author, reportId } = await chainWith("Journal reviewer", severity.id);
    await inject("PUT", `/journal/${reportId}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 8 }],
    });

    // The ceiling drops to 3, under the 8 already put forward.
    await inject("PATCH", `/severities/${severity.id}`, admin, { maxPoints: 3 });

    // The split stands as filed — nothing rewrites history.
    const detail = (await inject("GET", `/journal/${reportId}`, manager.cookie)).json();
    expect(detail.scores.find((s: { userId: string }) => s.userId === author.id).self).toBe(8);
    // But the entry now says what it may pay.
    expect(detail.pointsCeiling).toBe(3);

    // A review at the old number is refused...
    const tooMuch = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 8 }],
    });
    expect(tooMuch.statusCode).toBe(400);

    // ...and the new ceiling is what can be awarded and what counts.
    const ok = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 3 }],
    });
    expect(ok.statusCode).toBe(200);
    expect(
      ((await inject("GET", "/journal/points", author.cookie)).json() as { own: number }).own,
    ).toBe(3);
  });

  it("does not disturb an entry that was already reviewed and paid", async () => {
    // The other half of his instruction: "any changes will not affect old records".
    const admin = await superadmin();
    const severities = (await inject("GET", "/severities", admin)).json();
    const severity = severities[0];

    const { manager, author, reportId } = await chainWith("Journal reviewer", severity.id);
    await inject("PUT", `/journal/${reportId}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 8 }],
    });
    await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 8 }],
    });

    await inject("PATCH", `/severities/${severity.id}`, admin, { maxPoints: 3 });

    // Frozen at what it was worth when it was scored.
    expect(
      ((await inject("GET", "/journal/points", author.cookie)).json() as { own: number }).own,
    ).toBe(8);
  });
});

describe("what a severity may be worth", () => {
  it("accepts a ceiling above the old global maximum of ten", async () => {
    // Reported from use: "for severity settings it is not allowing me to set points
    // more than 10. there should not be any cap on that." Ten was the *old* global
    // maximum, and keeping it as the limit on its replacement left the ceiling
    // unable to rise above the thing it replaced.
    const admin = await superadmin();
    const severities = (await inject("GET", "/severities", admin)).json();

    const raised = await inject("PATCH", `/severities/${severities[0].id}`, admin, {
      maxPoints: 50,
    });
    expect(raised.statusCode).toBe(200);
    expect(raised.json().maxPoints).toBe(50);
  });

  it("still refuses a negative ceiling and a quarter point", async () => {
    const admin = await superadmin();
    const severities = (await inject("GET", "/severities", admin)).json();

    expect(
      (await inject("PATCH", `/severities/${severities[0].id}`, admin, { maxPoints: -1 }))
        .statusCode,
    ).toBe(400);
    expect(
      (await inject("PATCH", `/severities/${severities[0].id}`, admin, { maxPoints: 2.25 }))
        .statusCode,
    ).toBe(400);
  });

  it("lets a review award the whole of a raised ceiling", async () => {
    // The number has to survive the schema, the route and the scoring rule — the
    // ceiling being settable is no use if the score is still measured against ten.
    const admin = await superadmin();
    const severities = (await inject("GET", "/severities", admin)).json();
    await inject("PATCH", `/severities/${severities[0].id}`, admin, { maxPoints: 40 });

    const { manager, author, reportId } = await chainWith("Journal reviewer", severities[0].id);
    await inject("PUT", `/journal/${reportId}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 30 }],
    });
    const reviewed = await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 35 }],
    });
    expect(reviewed.statusCode).toBe(200);
  });
});
