// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the reports loop — the parts that must be exactly right,
// since they decide who sees whose work and how much it is worth:
//   - a draft is private; a submitted report reaches the author's managers
//   - scoring is two-tier: the worker's self split and one management review; the
//     review is blind upward — the worker never sees it
//   - a worker's official points (review if any, else self) freeze into the ledger,
//     and every manager above earns a 0.5-rounded, decaying share
//   - a report locks once scored
//
// The harness builds a real reporting line — author → manager → HOD — with real
// signed-in users, because that line is what every rule above is computed from.
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

/** Create a user with a password, put them in `groupId`, then sign in as them with
 * a password of their own (clearing the admin-set-password gate). */
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

  // Add them to the group that grants their permissions + company access.
  const assignments = (await inject("GET", `/groups/${groupId}/assignments`, admin)).json();
  await inject("PUT", `/groups/${groupId}/users`, admin, { ids: [...assignments.users, id] });

  // Sign in (gated), change to their own password, sign in clean.
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

/** A group scoped to the demo company holding the named role. */
async function makeGroup(admin: string, name: string, roleName: string): Promise<string> {
  const group = (await inject("POST", "/groups", admin, { name })).json();
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
}

/**
 * Build author → manager → HOD in one department, each a real signed-in user, and
 * return the pieces the tests need. HOD and manager hold the Manager role (which
 * grants reports:appraise); the author holds Member (reports:create only).
 */
async function buildChain(admin: string) {
  const memberGroup = await makeGroup(admin, "Reporters", "Member");
  const managerGroup = await makeGroup(admin, "Line managers", "Manager");

  const hod = await makeUser(admin, "Asha HOD", "asha", managerGroup);
  const manager = await makeUser(admin, "Ravi Lead", "ravi", managerGroup);
  const author = await makeUser(admin, "Sam Operator", "sam", memberGroup);

  const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [
      { userId: hod.id, rank: "hod" },
      { userId: manager.id, rank: "lead", reportsToId: hod.id },
      { userId: author.id, rank: "member", reportsToId: manager.id },
    ],
  });

  // The severity the entries below are filed at.
  const severities = (await inject("GET", "/severities", admin)).json();
  const critical = severities.find((s: { name: string }) => s.name === "Critical");

  return { hod, manager, author, dept, critical };
}

/** A submitted issue by `author`, Critical severity. */
async function fileIssue(authorCookie: string, severityId: string): Promise<string> {
  const res = await inject("POST", "/journal", authorCookie, {
    kind: "issue",
    title: "Conveyor jam on line 3",
    state: "submitted",
    severityId,
    issueSummary: "Belt seized",
    workSummary: "Cleared and restarted",
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

/** Score a report's workers in points. The tier — self split or review — follows
 *  from who the cookie belongs to. */
async function score(
  cookie: string,
  reportId: string,
  entries: { userId: string; points: number }[],
) {
  const res = await inject("PUT", `/journal/${reportId}/scores`, cookie, { scores: entries });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    userId: string;
    self: number | null;
    review: number | null;
    official: number | null;
  }[];
}

const pointsOf = async (cookie: string) =>
  (await inject("GET", "/journal/points", cookie)).json() as {
    own: number;
    rollup: number;
    total: number;
  };

describe("reports and scoring", () => {
  it("keeps a draft private, then shares a submitted report up the line", async () => {
    const admin = await superadmin();
    const { manager, author } = await buildChain(admin);

    // A draft issue: the author sees it; their manager does not. An issue (not a
    // work log) so it starts open — the point below is that it is not in the review
    // queue until it is resolved.
    const draft = await inject("POST", "/journal", author.cookie, {
      kind: "issue",
      title: "Intermittent stall",
      state: "draft",
      issueSummary: "Stalls under load",
    });
    expect(draft.statusCode).toBe(201);
    const draftId = draft.json().id;

    expect((await inject("GET", `/journal/${draftId}`, author.cookie)).statusCode).toBe(200);
    expect((await inject("GET", `/journal/${draftId}`, manager.cookie)).statusCode).toBe(404);
    const managerListBefore = (await inject("GET", "/journal", manager.cookie)).json().data;
    expect(managerListBefore.some((r: { id: string }) => r.id === draftId)).toBe(false);

    // Submit it: now the manager sees it — but the review queue is only for resolved
    // reports, so it is not there yet.
    await inject("PATCH", `/journal/${draftId}`, author.cookie, { state: "submitted" });
    expect((await inject("GET", `/journal/${draftId}`, manager.cookie)).statusCode).toBe(200);
    const beforeResolve = (await inject("GET", "/journal/pending", manager.cookie)).json();
    expect(beforeResolve.some((p: { reportId: string }) => p.reportId === draftId)).toBe(false);

    // Resolve it — still not the manager's, because the self split comes first: a
    // review confirms a number the worker has put forward.
    await finish(manager.cookie, draftId);
    const beforeSelf = (await inject("GET", "/journal/pending", manager.cookie)).json();
    expect(beforeSelf.some((p: { reportId: string }) => p.reportId === draftId)).toBe(false);

    // The author splits the points, and now it awaits the manager's review.
    await inject("PUT", `/journal/${draftId}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 2 }],
    });
    const pending = (await inject("GET", "/journal/pending", manager.cookie)).json();
    expect(pending.some((p: { reportId: string }) => p.reportId === draftId)).toBe(true);
  });

  it("shows the author their own entry waiting, and who it is waiting on", async () => {
    // The mirror of the review queue. Before this the person who filed the work
    // had no way to see it sitting there, short of asking — which is what makes
    // it the one thing on the page for somebody who cannot appraise.
    const admin = await superadmin();
    const { manager, author, critical } = await buildChain(admin);

    const entry = await fileIssue(author.cookie, critical.id);
    // Still open: the queue is for finished work, and so is this.
    expect((await inject("GET", "/journal/awaiting-review", author.cookie)).json()).toEqual([]);

    await finish(manager.cookie, entry);
    const waiting = (await inject("GET", "/journal/awaiting-review", author.cookie)).json();
    expect(waiting).toHaveLength(1);
    // Named, so it is a person to go and ask rather than "somebody".
    expect(waiting[0]).toMatchObject({ reportId: entry, reviewerName: "Ravi Lead" });

    // And it leaves the list once somebody above has scored it — the same event
    // that clears the manager's queue. The tier follows from whose cookie it is.
    await score(manager.cookie, entry, [{ userId: author.id, points: 3 }]);
    expect((await inject("GET", "/journal/awaiting-review", author.cookie)).json()).toEqual([]);
  });

  it("keeps one person's waiting list to their own entries", async () => {
    // It is "what of MINE is waiting", not "what is waiting" — a manager who can
    // see their whole downline must not find the downline's entries in here.
    const admin = await superadmin();
    const { manager, author, critical } = await buildChain(admin);

    const theirs = await fileIssue(author.cookie, critical.id);
    await finish(manager.cookie, theirs);

    const managerWaiting = (await inject("GET", "/journal/awaiting-review", manager.cookie)).json();
    expect(managerWaiting.some((r: { reportId: string }) => r.reportId === theirs)).toBe(false);
  });

  it("filters the list to one author by id", async () => {
    const admin = await superadmin();
    const { manager, author, critical } = await buildChain(admin);

    const mine = await fileIssue(author.cookie, critical.id);
    await fileIssue(manager.cookie, critical.id); // a second author's report

    // The manager sees both (author is in their downline); filtering by the author's
    // id narrows to just theirs — the searchable Author dropdown sends the id.
    const filters = encodeURIComponent(
      JSON.stringify([{ field: "authorId", op: "eq", value: author.id }]),
    );
    const list = (await inject("GET", `/journal?filters=${filters}`, manager.cookie)).json();
    expect(list.data.map((r: { id: string }) => r.id)).toEqual([mine]);
  });

  it("starts a work log finished and an issue open", async () => {
    const admin = await superadmin();
    const { author } = await buildChain(admin);

    // A work log is a record of work already done — it has no triage workflow, so it
    // opens at the resolved end and can be scored straight away.
    const work = await inject("POST", "/journal", author.cookie, {
      kind: "work",
      title: "Cleaned station 2",
      state: "submitted",
      workSummary: "Wiped down",
    });
    expect(work.json().statusGroup).toBe("resolved");

    // An issue opens for triage.
    const issue = await inject("POST", "/journal", author.cookie, {
      kind: "issue",
      title: "Belt worn",
      state: "submitted",
      issueSummary: "Fraying",
    });
    expect(issue.json().statusGroup).toBe("open");
  });

  it("hides the review from the worker below (blind upward)", async () => {
    const admin = await superadmin();
    const { manager, author, critical } = await buildChain(admin);
    const reportId = await fileIssue(author.cookie, critical.id);

    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [{ userId: author.id, points: 6 }]); // self
    await score(manager.cookie, reportId, [{ userId: author.id, points: 8 }]); // review

    const rowFor = async (cookie: string) => {
      const grid = (await inject("GET", `/journal/${reportId}`, cookie)).json().scores as {
        userId: string;
        self: number | null;
        review: number | null;
        official: number | null;
      }[];
      return grid.find((s) => s.userId === author.id)!;
    };

    // The author sees their own self split but not the review made of them; the
    // manager above sees the review and the official figure it sets.
    expect(await rowFor(author.cookie)).toMatchObject({ self: 6, review: null, official: null });
    expect(await rowFor(manager.cookie)).toMatchObject({ self: 6, review: 8, official: 8 });
  });

  it("freezes official points into the ledger, and rolls them up the line", async () => {
    const admin = await superadmin();
    const { hod, manager, author, critical } = await buildChain(admin);
    const reportId = await fileIssue(author.cookie, critical.id);

    // Self 6, then a management review of 8 — the review is the official figure.
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [{ userId: author.id, points: 6 }]);
    await score(manager.cookie, reportId, [{ userId: author.id, points: 8 }]);

    // Official 8. Rollup up the whole line: manager 8 × 0.25 = 2, HOD 8 × 0.25² = 0.5.
    expect((await pointsOf(author.cookie)).own).toBeCloseTo(8, 5);
    expect((await pointsOf(manager.cookie)).rollup).toBeCloseTo(2, 5);
    expect((await pointsOf(hod.cookie)).rollup).toBeCloseTo(0.5, 5);
  });

  it("rounds every earned figure, rollup included, to a 0.5 step", async () => {
    const admin = await superadmin();
    const { hod, manager, author, critical } = await buildChain(admin);
    const reportId = await fileIssue(author.cookie, critical.id);

    // Official 7. Manager: 7 × 0.25 = 1.75 → 2. HOD: 7 × 0.25² = 0.4375 → 0.5.
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [{ userId: author.id, points: 7 }]);

    expect((await pointsOf(author.cookie)).own).toBe(7);
    expect((await pointsOf(manager.cookie)).rollup).toBe(2);
    expect((await pointsOf(hod.cookie)).rollup).toBe(0.5);
  });

  it("does not rewrite an existing report's points when the roll-up factor changes", async () => {
    const admin = await superadmin();
    const { manager, author, critical } = await buildChain(admin);
    const reportId = await fileIssue(author.cookie, critical.id);
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [{ userId: author.id, points: 8 }]);

    const before = (await pointsOf(manager.cookie)).rollup;
    // The manager is the author's direct manager (depth 1): 0.25 × 8 = 2.
    expect(before).toBeCloseTo(2, 5);

    // Double the factor. The already-frozen report is untouched.
    await inject("PATCH", "/settings/journal/appraisal", admin, {
      value: { rollupFactor: 0.5, routineWeight: 1 },
    });
    expect((await pointsOf(manager.cookie)).rollup).toBeCloseTo(before, 5);
  });

  it("locks a report once scored, and re-opens it deliberately (clearing the score)", async () => {
    const admin = await superadmin();
    const { author, critical } = await buildChain(admin);
    const reportId = await fileIssue(author.cookie, critical.id);

    // Editable before any score.
    expect(
      (await inject("PATCH", `/journal/${reportId}`, author.cookie, { title: "Edited" }))
        .statusCode,
    ).toBe(200);

    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [{ userId: author.id, points: 6 }]);

    // Now locked.
    const blocked = await inject("PATCH", `/journal/${reportId}`, author.cookie, {
      title: "Again",
    });
    expect(blocked.statusCode).toBe(409);

    // Re-open, then it is editable again — and its score is gone.
    expect((await inject("POST", `/journal/${reportId}/reopen`, author.cookie)).statusCode).toBe(
      200,
    );
    expect(
      (await inject("PATCH", `/journal/${reportId}`, author.cookie, { title: "Fixed" })).statusCode,
    ).toBe(200);
    expect((await pointsOf(author.cookie)).own).toBe(0);
  });

  it("refuses a score from someone who is not above the author", async () => {
    const admin = await superadmin();
    const { author, critical } = await buildChain(admin);

    // A second Member, in no reporting relationship to the author.
    const peerGroup = await makeGroup(admin, "Other reporters", "Member");
    const peer = await makeUser(admin, "Peer", "peer", peerGroup);
    const reportId = await fileIssue(author.cookie, critical.id);

    // The peer cannot even see it (not in their downline), let alone review it.
    expect((await inject("GET", `/journal/${reportId}`, peer.cookie)).statusCode).toBe(404);
    // Finished by somebody who may — scoring needs a concluded report, and this test
    // is about who may score it, not about who may move it.
    await finish(author.cookie, reportId);
    const res = await inject("PUT", `/journal/${reportId}/scores`, peer.cookie, {
      scores: [{ userId: author.id, points: 9 }],
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets an HOD reject a downline report, voiding its points, and un-reject it", async () => {
    const admin = await superadmin();
    const { hod, manager, author, critical } = await buildChain(admin);
    const reportId = await fileIssue(author.cookie, critical.id);
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [{ userId: author.id, points: 6 }]);
    await score(manager.cookie, reportId, [{ userId: author.id, points: 8 }]);
    expect((await pointsOf(author.cookie)).own).toBeCloseTo(8, 5);

    // The author cannot reject their own report; a peer (no line to the author) cannot either.
    expect(
      (await inject("POST", `/journal/${reportId}/reject`, author.cookie, {})).statusCode,
    ).toBe(403);
    const peerGroup = await makeGroup(admin, "Bystanders", "Member");
    const peer = await makeUser(admin, "Peer", "peer2", peerGroup);
    expect((await inject("POST", `/journal/${reportId}/reject`, peer.cookie, {})).statusCode).toBe(
      403,
    );

    // The HOD (above the author) rejects it — points are struck.
    const rejected = await inject("POST", `/journal/${reportId}/reject`, hod.cookie, {
      reason: "Duplicate of #12",
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({
      rejectedByName: "Asha HOD",
      rejectionReason: "Duplicate of #12",
    });
    expect((await pointsOf(author.cookie)).own).toBeCloseTo(0, 5);
    expect((await pointsOf(manager.cookie)).rollup).toBeCloseTo(0, 5);

    // A rejected report cannot be scored.
    expect(
      (
        await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
          scores: [{ userId: author.id, points: 8 }],
        })
      ).statusCode,
    ).toBe(400);

    // Un-reject, and it can be scored again.
    expect((await inject("POST", `/journal/${reportId}/unreject`, hod.cookie)).statusCode).toBe(
      200,
    );
    await score(manager.cookie, reportId, [{ userId: author.id, points: 8 }]);
    expect((await pointsOf(author.cookie)).own).toBeCloseTo(8, 5);
  });

  it("records a points-change history, readable only above the author", async () => {
    const admin = await superadmin();
    const { hod, manager, author, critical } = await buildChain(admin);
    const reportId = await fileIssue(author.cookie, critical.id);
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [{ userId: author.id, points: 6 }]);
    await score(manager.cookie, reportId, [{ userId: author.id, points: 8 }]);

    // The author cannot read it — it would expose the review hidden from them.
    expect(
      (await inject("GET", `/journal/${reportId}/score-events`, author.cookie)).statusCode,
    ).toBe(403);

    // The manager sees both changes, with who made them and old → new.
    const events = (
      await inject("GET", `/journal/${reportId}/score-events`, manager.cookie)
    ).json();
    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tier: "review",
          oldPoints: null,
          newPoints: 8,
          reason: "score",
          raterName: "Ravi Lead",
        }),
        expect.objectContaining({
          tier: "self",
          oldPoints: null,
          newPoints: 6,
          reason: "score",
          raterName: "Sam Operator",
        }),
      ]),
    );

    // Rejecting clears both — recorded as clearing events.
    await inject("POST", `/journal/${reportId}/reject`, hod.cookie, {});
    const after = (await inject("GET", `/journal/${reportId}/score-events`, hod.cookie)).json();
    expect(after).toHaveLength(4);
    expect(after.filter((e: { reason: string }) => e.reason === "rejected")).toHaveLength(2);
  });

  it("locks points for a closed period; a re-open re-opens them for re-check", async () => {
    const admin = await superadmin();
    const { hod, manager, author, critical } = await buildChain(admin);
    const reportId = await fileIssue(author.cookie, critical.id);
    await finish(author.cookie, reportId);
    await score(author.cookie, reportId, [{ userId: author.id, points: 6 }]);
    await score(manager.cookie, reportId, [{ userId: author.id, points: 8 }]);

    // Close the period through today — the entry's report date falls in it.
    const today = new Date().toISOString().slice(0, 10);
    await inject("PUT", "/settings/reports/lock", admin, { value: { lockedThrough: today } });

    // Re-scoring and rejecting are refused while locked.
    expect(
      (
        await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
          scores: [{ userId: author.id, points: 5 }],
        })
      ).statusCode,
    ).toBe(400);
    expect((await inject("POST", `/journal/${reportId}/reject`, hod.cookie, {})).statusCode).toBe(
      400,
    );

    // A re-open re-opens the points for re-evaluation.
    expect((await inject("POST", `/journal/${reportId}/reopen`, manager.cookie)).statusCode).toBe(
      200,
    );
    expect(
      (await inject("GET", `/journal/${reportId}`, manager.cookie)).json().pointsReviewNeeded,
    ).toBe(true);

    // Re-opening now returns the entry to the open group — that is what re-opening
    // means, and it used to leave "Resolved" in place. So it has to be finished
    // again before anybody can score it: points follow resolution.
    await finish(author.cookie, reportId);

    // Re-scoring is allowed despite the lock; the review settles the re-check.
    await score(author.cookie, reportId, [{ userId: author.id, points: 5 }]);
    await score(manager.cookie, reportId, [{ userId: author.id, points: 5 }]);
    expect(
      (await inject("GET", `/journal/${reportId}`, manager.cookie)).json().pointsReviewNeeded,
    ).toBe(false);

    // With the re-check settled, the lock applies again — except for a superadmin.
    expect(
      (
        await inject("PUT", `/journal/${reportId}/scores`, manager.cookie, {
          scores: [{ userId: author.id, points: 4 }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await inject("PUT", `/journal/${reportId}/scores`, admin, {
          scores: [{ userId: author.id, points: 4 }],
        })
      ).statusCode,
    ).toBe(200);
  });

  it("bounds an issue by its occurred date and a work log by its report date", async () => {
    const admin = await superadmin();
    const { author } = await buildChain(admin);
    await inject("PUT", "/settings/reports/entry", admin, { value: { graceDays: 2 } });

    const daysAgo = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return d.toISOString();
    };
    const issue = (occurredAt?: string) =>
      inject("POST", "/journal", author.cookie, {
        kind: "issue",
        title: "Belt seized",
        state: "submitted",
        issueSummary: "x",
        ...(occurredAt ? { occurredAt } : {}),
      });
    const work = (reportDate: string, cookie = author.cookie) =>
      inject("POST", "/journal", cookie, {
        kind: "work",
        title: "Greased the line",
        state: "submitted",
        workSummary: "x",
        reportDate,
      });

    // An issue is judged by when it occurred: 2 days back is fine, 3 is refused.
    expect((await issue(daysAgo(2))).statusCode).toBe(201);
    expect((await issue(daysAgo(3))).statusCode).toBe(400);
    // An issue filed now with no occurred date is never blocked, whatever the grace.
    expect((await issue()).statusCode).toBe(201);

    // A work log is judged by its report date: old work is refused; a superadmin is exempt.
    expect((await work(daysAgo(3))).statusCode).toBe(400);
    expect((await work(daysAgo(30), admin)).statusCode).toBe(201);

    // Widen the grace and the once-refused issue occurred-date is accepted.
    await inject("PUT", "/settings/reports/entry", admin, { value: { graceDays: 10 } });
    expect((await issue(daysAgo(3))).statusCode).toBe(201);
  });

  it("refuses to log work against a closed entry, and takes it once re-opened", async () => {
    // A finished record that still accepts "what was done" can be rewritten after
    // everybody has stopped looking. Re-opening is the way back, and that move is
    // logged — which is the whole point of making it the way back.
    const admin = await superadmin();
    const { author, critical } = await buildChain(admin);
    const reportId = await fileIssue(author.cookie, critical.id);

    // Open: work can be logged.
    expect(
      (
        await inject("PATCH", `/journal/${reportId}`, author.cookie, {
          workSummary: "Belt swapped",
        })
      ).statusCode,
    ).toBe(200);

    await finish(author.cookie, reportId);

    const refused = await inject("PATCH", `/journal/${reportId}`, author.cookie, {
      workSummary: "And greased the bearings",
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/closed/i);

    // Everything else about a closed entry is still editable — the rule is about the
    // work record, not a general freeze.
    expect(
      (
        await inject("PATCH", `/journal/${reportId}`, author.cookie, {
          title: "Belt snapped again",
        })
      ).statusCode,
    ).toBe(200);
  });
});
