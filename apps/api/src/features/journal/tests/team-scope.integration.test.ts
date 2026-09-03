// Author: Brijesh Dave <https://github.com/brijeshdave>
// Asking the journal about one part of the reporting line.
//
// Reported from use: the journal "does not have filter to do like direct reporting
// people or at a level of reporting etc to get appropriate data", and no way to see
// "which entries are not reviewed for the user by his reporting manager". A head of
// department could only choose between their own entries and the entire nested
// organisation below them, which for a HOD is everybody.
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

async function makeUser(admin: string, name: string, username: string, groupId: string) {
  const created = await inject("POST", "/users", admin, {
    name,
    username,
    email: `${username}@reportly.test`,
    password: TEMP_PW,
  });
  const id = created.json().id as string;
  await inject("PUT", `/users/${id}/companies`, admin, { ids: [DEMO_COMPANY_ID] });
  // Append: this endpoint replaces the membership, so passing one id would remove
  // whoever was already in the group — which is how the HOD silently lost every
  // permission and every request came back 403.
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

/** HOD → manager → author, three real signed-in people in one department. */
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

  const severities = (await inject("GET", "/severities", admin)).json();
  return { hod, manager, author, critical: severities.find((s: { name: string }) => s.name) };
}

async function file(cookie: string, title: string, severityId: string, state = "submitted") {
  const res = await inject("POST", "/journal", cookie, {
    kind: "issue",
    title,
    state,
    severityId,
    issueSummary: "Something stopped",
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

function titles(res: { json: () => { data: { title: string }[] } }): string[] {
  return res.json().data.map((row) => row.title);
}

const scoped = (scope: string) => `?filters=[{"field":"team","op":"eq","value":"${scope}"}]`;

describe("the team scope filter", () => {
  it("gives a HOD their direct reports, not the whole organisation beneath them", async () => {
    // The report in one line: a HOD saw every entry at every depth, and wanted the
    // people who actually report to them.
    const admin = await superadmin();
    const { hod, manager, author, critical } = await buildChain(admin);

    await file(hod.cookie, "HOD's own", critical.id);
    await file(manager.cookie, "One level down", critical.id);
    await file(author.cookie, "Two levels down", critical.id);

    const direct = titles(await inject("GET", `/journal${scoped("direct")}`, hod.cookie));
    expect(direct).toContain("HOD's own");
    expect(direct).toContain("One level down");
    expect(direct).not.toContain("Two levels down");
  });

  it("reaches further when asked for two levels, and all the way for the whole team", async () => {
    const admin = await superadmin();
    const { hod, manager, author, critical } = await buildChain(admin);
    await file(manager.cookie, "One level down", critical.id);
    await file(author.cookie, "Two levels down", critical.id);

    const two = titles(await inject("GET", `/journal${scoped("two-levels")}`, hod.cookie));
    expect(two).toContain("Two levels down");

    const whole = titles(await inject("GET", `/journal${scoped("downline")}`, hod.cookie));
    expect(whole).toContain("One level down");
    expect(whole).toContain("Two levels down");
  });

  it("gives everything except the direct team when asked for the others", async () => {
    // Asked for from use: "in journal filter i need one more filter option under
    // whose, for seeing all other except my direct team" — the complement of
    // `direct`, for a head of department reading everything that is not their own
    // immediate crew. It subtracts rather than keeping, which is why it cannot be
    // written as a depth.
    const admin = await superadmin();
    const { hod, manager, author, critical } = await buildChain(admin);

    await file(hod.cookie, "HOD's own", critical.id);
    await file(manager.cookie, "One level down", critical.id);
    await file(author.cookie, "Two levels down", critical.id);

    const others = titles(await inject("GET", `/journal${scoped("others")}`, hod.cookie));
    // Themselves and the people who report straight to them are what is removed.
    expect(others).not.toContain("HOD's own");
    expect(others).not.toContain("One level down");
    // Everything deeper stays.
    expect(others).toContain("Two levels down");
  });

  it("still cannot show somebody work they were not already allowed to see", async () => {
    // Every scope narrows and none widens. The exclusion is the one that could get
    // this wrong — subtracting from "everyone" rather than from "everyone I may
    // see" would turn a filter into a way out of the reporting line. Asked as the
    // manager, whose own manager's entries were never theirs to read.
    const admin = await superadmin();
    const { hod, manager, critical } = await buildChain(admin);
    await file(hod.cookie, "The HOD's own entry", critical.id);

    const others = titles(await inject("GET", `/journal${scoped("others")}`, manager.cookie));
    expect(others).not.toContain("The HOD's own entry");
  });

  it("narrows to just me when asked", async () => {
    const admin = await superadmin();
    const { hod, manager, critical } = await buildChain(admin);
    await file(hod.cookie, "HOD's own", critical.id);
    await file(manager.cookie, "One level down", critical.id);

    const mine = titles(await inject("GET", `/journal${scoped("me")}`, hod.cookie));
    expect(mine).toEqual(["HOD's own"]);
  });

  it("keeps the caller's own entries in every team view", async () => {
    // A manager looking at "my team" and not finding their own work reads as a bug
    // rather than as a definition.
    const admin = await superadmin();
    const { hod, critical } = await buildChain(admin);
    await file(hod.cookie, "HOD's own", critical.id);

    for (const scope of ["me", "direct", "two-levels", "downline"]) {
      const rows = titles(await inject("GET", `/journal${scoped(scope)}`, hod.cookie));
      expect(rows, scope).toContain("HOD's own");
    }
  });

  it("never widens what somebody may see", async () => {
    // The important one. Asking for "everyone" must not turn an operator into an
    // auditor: their own visibility is applied on top of any scope.
    const admin = await superadmin();
    const { hod, author, critical } = await buildChain(admin);
    await file(hod.cookie, "HOD's own", critical.id);

    const seen = titles(await inject("GET", `/journal${scoped("all")}`, author.cookie));
    expect(seen).not.toContain("HOD's own");
  });

  it("an unknown scope narrows nothing rather than everything", async () => {
    // A filter nobody recognises must not silently empty the screen — that is how
    // a typo in a saved link becomes "the journal is broken".
    const admin = await superadmin();
    const { hod, critical } = await buildChain(admin);
    await file(hod.cookie, "HOD's own", critical.id);

    const rows = titles(await inject("GET", `/journal${scoped("nonsense")}`, hod.cookie));
    expect(rows).toContain("HOD's own");
  });
});

describe("the awaiting-review filter", () => {
  it("shows a resolved entry nobody has scored, and hides a draft", async () => {
    const admin = await superadmin();
    const { author, critical } = await buildChain(admin);
    const ready = await file(author.cookie, "Waiting on my manager", critical.id);
    await file(author.cookie, "Still a draft", critical.id, "draft");

    // Resolving is part of being reviewable, not scenery: this filter used to ask
    // only whether an entry was submitted, so it listed work still in progress as
    // though a manager could score it. It cannot — `setScores` refuses anything
    // outside the resolved group.
    await inject("POST", `/journal/${ready}/work`, author.cookie, { summary: "Fixed it" });
    const statuses = (await inject("GET", "/journal-statuses", admin)).json() as {
      id: string;
      group: string;
    }[];
    await inject("PATCH", `/journal/${ready}/status`, admin, {
      statusId: statuses.find((s) => s.group === "resolved")!.id,
    });

    const waiting = titles(
      await inject(
        "GET",
        '/journal?filters=[{"field":"awaitingReview","op":"eq","value":true}]',
        author.cookie,
      ),
    );
    expect(waiting).toContain("Waiting on my manager");
    // A draft is waiting on its author and nobody else.
    expect(waiting).not.toContain("Still a draft");
  });

  it("no longer lists work that is still in progress", async () => {
    // The bug this filter shared with the table badge, kept as its own case: an
    // open entry is not waiting on anybody's review.
    const admin = await superadmin();
    const { author, critical } = await buildChain(admin);
    await file(author.cookie, "Still being worked", critical.id);

    const waiting = titles(
      await inject(
        "GET",
        '/journal?filters=[{"field":"awaitingReview","op":"eq","value":true}]',
        author.cookie,
      ),
    );
    expect(waiting).not.toContain("Still being worked");
  });
});

describe("the search box", () => {
  it("finds an entry by a fragment of its title, and by its id", async () => {
    // People quote the id to each other and then had nowhere to paste it: a uuid
    // typed into a title search matched nothing, which reads as "it is gone".
    const admin = await superadmin();
    const { hod, critical } = await buildChain(admin);
    const id = await file(hod.cookie, "Conveyor jam on line 3", critical.id);
    await file(hod.cookie, "Something else entirely", critical.id);

    const byTitle = titles(
      await inject(
        "GET",
        '/journal?filters=[{"field":"search","op":"contains","value":"conveyor"}]',
        hod.cookie,
      ),
    );
    expect(byTitle).toEqual(["Conveyor jam on line 3"]);

    const byId = titles(
      await inject(
        "GET",
        `/journal?filters=[{"field":"search","op":"contains","value":"${id}"}]`,
        hod.cookie,
      ),
    );
    expect(byId).toEqual(["Conveyor jam on line 3"]);
  });
});

describe("filtering by a joined column", () => {
  it("does not 500 when the filter names a severity", async () => {
    // Reported from production: applying the severity filter returned 500, and the
    // filter is remembered per person — so the page failed the same way on every
    // visit, including after signing out and back in. The only escape was deleting
    // a session-storage key in devtools.
    //
    // The cause was the count query: rows were selected through the catalogue
    // joins, the count was not, so Postgres refused the filter with "missing
    // FROM-clause entry for table severities".
    const admin = await superadmin();
    const { hod, critical } = await buildChain(admin);
    await file(hod.cookie, "Filterable", critical.id);

    const res = await inject(
      "GET",
      `/journal?filters=[{"field":"severityName","op":"eq","value":"${critical.name}"}]`,
      hod.cookie,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBeGreaterThan(0);
    expect(titles(res)).toContain("Filterable");
  });

  it("counts correctly through every other joined column too", async () => {
    // The same fault applied to status, category, department and location — all of
    // them live on joined tables, so all of them broke the count the same way.
    const admin = await superadmin();
    const { hod, critical } = await buildChain(admin);
    await file(hod.cookie, "Filterable", critical.id);

    for (const filter of [
      '{"field":"statusName","op":"eq","value":"Open"}',
      '{"field":"severityName","op":"eq","value":"nonexistent"}',
    ]) {
      const res = await inject("GET", `/journal?filters=[${filter}]`, hod.cookie);
      expect(res.statusCode, filter).toBe(200);
      // The total has to agree with the page, or the pager sends people to a page
      // that is not there.
      expect(res.json().total, filter).toBe(res.json().data.length);
    }
  });
});

describe("what an entry must have", () => {
  it("refuses to submit without a severity, but lets a draft be incomplete", async () => {
    // Reported from use: entries were arriving with no severity, and severity is
    // what sets the points ceiling — so they were scored against a fallback nobody
    // chose. A draft is work in progress and stays exempt.
    const admin = await superadmin();
    const { hod } = await buildChain(admin);

    const draft = await inject("POST", "/journal", hod.cookie, {
      kind: "issue",
      title: "Still writing this",
      state: "draft",
    });
    expect(draft.statusCode).toBe(201);

    const submitted = await inject("POST", "/journal", hod.cookie, {
      kind: "issue",
      title: "No severity",
      state: "submitted",
    });
    expect(submitted.statusCode).toBe(400);
    expect(submitted.json().error.message).toMatch(/severity/i);

    // And the same when a draft is submitted later.
    const promoted = await inject("PATCH", `/journal/${draft.json().id}`, hod.cookie, {
      state: "submitted",
    });
    expect(promoted.statusCode).toBe(400);
  });

  it("refuses to resolve with no work logged, and still allows a rejection", async () => {
    const admin = await superadmin();
    const { hod, critical } = await buildChain(admin);
    const id = await file(hod.cookie, "Nothing done yet", critical.id);

    const statuses = (await inject("GET", "/journal-statuses", hod.cookie)).json() as {
      id: string;
      name: string;
      group: string;
    }[];
    const resolved = statuses.find((s) => s.group === "resolved")!;

    const tooSoon = await inject("PATCH", `/journal/${id}/status`, hod.cookie, {
      statusId: resolved.id,
    });
    expect(tooSoon.statusCode).toBe(400);
    expect(tooSoon.json().error.message).toMatch(/log what was done/i);

    // Refusing an entry is exactly the case where no work was done.
    const rejected = statuses.find((s) => s.group === "rejected")!;
    expect(
      (await inject("PATCH", `/journal/${id}/status`, hod.cookie, { statusId: rejected.id }))
        .statusCode,
    ).toBe(200);
  });

  it("resolves once the work is written down", async () => {
    const admin = await superadmin();
    const { hod, critical } = await buildChain(admin);
    const id = await file(hod.cookie, "Fixed it", critical.id);

    await inject("POST", `/journal/${id}/work`, hod.cookie, {
      summary: "Replaced the belt",
    });

    const statuses = (await inject("GET", "/journal-statuses", hod.cookie)).json() as {
      id: string;
      group: string;
    }[];
    const resolved = statuses.find((s) => s.group === "resolved")!;
    expect(
      (await inject("PATCH", `/journal/${id}/status`, hod.cookie, { statusId: resolved.id }))
        .statusCode,
    ).toBe(200);
  });
});

describe("whether the review is done", () => {
  it("says so on the entry, without saying what it was", async () => {
    // Asked for from use: "need a column to directly see if the review is done or
    // not" — the only way to tell was to open every entry.
    const admin = await superadmin();
    const { hod, manager, author, critical } = await buildChain(admin);
    const id = await file(author.cookie, "Scored later", critical.id);

    await inject("POST", `/journal/${id}/work`, author.cookie, { summary: "Fixed it" });
    const statuses = (await inject("GET", "/journal-statuses", admin)).json() as {
      id: string;
      group: string;
    }[];
    await inject("PATCH", `/journal/${id}/status`, admin, {
      statusId: statuses.find((s) => s.group === "resolved")!.id,
    });

    const before = (await inject("GET", "/journal", author.cookie)).json().data as {
      id: string;
      reviewed: boolean;
    }[];
    expect(before.find((row) => row.id === id)?.reviewed).toBe(false);

    // The author splits first, then the manager reviews.
    await inject("PUT", `/journal/${id}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 2 }],
    });
    await inject("PUT", `/journal/${id}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 3 }],
    });

    const after = (await inject("GET", "/journal", author.cookie)).json().data as {
      id: string;
      reviewed: boolean;
    }[];
    const row = after.find((entry) => entry.id === id);
    expect(row?.reviewed).toBe(true);
    // The flag says it happened; the number is still the manager's business.
    expect(JSON.stringify(row)).not.toContain('"review"');

    // And the HOD above sees the same fact.
    const asHod = (await inject("GET", "/journal", hod.cookie)).json().data as {
      id: string;
      reviewed: boolean;
    }[];
    expect(asHod.find((entry) => entry.id === id)?.reviewed).toBe(true);
  });

  it("counts the page correctly with the flag in the select", async () => {
    // The flag is a correlated EXISTS rather than a join, because joining
    // journal_scores multiplies the row by everybody scored on it — which would
    // double entries in the list and in its total.
    const admin = await superadmin();
    const { author, critical } = await buildChain(admin);
    await file(author.cookie, "Only once", critical.id);

    const res = (await inject("GET", "/journal", author.cookie)).json();
    expect(res.total).toBe(res.data.length);
    expect(res.data.filter((r: { title: string }) => r.title === "Only once")).toHaveLength(1);
  });
});

/**
 * "Waiting" means a reviewer can act on it today.
 *
 * Reported from production: "in journal table it shows Waiting for all entries
 * which are not reviewd but it should only show waiting for those are ready for it.
 * Currently any open or rejected are also showing waiting and it is mis leading for
 * managers."
 *
 * The badge was a boolean — reviewed or not — so everything unscored read as
 * waiting, including entries still being worked and entries the server would have
 * refused to score at all. The state now uses the same three conditions `setScores`
 * refuses without, so the table and the server cannot disagree.
 */
describe("what counts as waiting for review", () => {
  async function resolve(admin: string, id: string, authorCookie: string) {
    await inject("POST", `/journal/${id}/work`, authorCookie, { summary: "Fixed it" });
    const statuses = (await inject("GET", "/journal-statuses", admin)).json() as {
      id: string;
      name: string;
      group: string;
    }[];
    await inject("PATCH", `/journal/${id}/status`, admin, {
      statusId: statuses.find((s) => s.group === "resolved")!.id,
    });
  }

  const stateOf = async (cookie: string, id: string) => {
    const rows = (await inject("GET", "/journal", cookie)).json().data as {
      id: string;
      reviewState: string;
    }[];
    return rows.find((row) => row.id === id)?.reviewState;
  };

  it("does not call an entry still being worked 'waiting'", async () => {
    const admin = await superadmin();
    const { author, critical } = await buildChain(admin);
    const id = await file(author.cookie, "Still open", critical.id);

    // Submitted, unscored, and nowhere near a reviewer: it has not been resolved.
    expect(await stateOf(author.cookie, id)).toBe("not_ready");
  });

  it("calls a resolved, unscored entry 'waiting'", async () => {
    const admin = await superadmin();
    const { author, critical } = await buildChain(admin);
    const id = await file(author.cookie, "Ready for review", critical.id);
    await resolve(admin, id, author.cookie);

    expect(await stateOf(author.cookie, id)).toBe("waiting");
  });

  it("does not call a rejected entry 'waiting'", async () => {
    // The server refuses to score a rejected entry, so a queue that lists one is
    // asking a manager to do something that will be turned down.
    const admin = await superadmin();
    const { hod, author, critical } = await buildChain(admin);
    const id = await file(author.cookie, "Struck out", critical.id);
    await resolve(admin, id, author.cookie);
    expect(await stateOf(author.cookie, id)).toBe("waiting");

    const rejected = await inject("POST", `/journal/${id}/reject`, hod.cookie, {
      reason: "Not our department",
    });
    expect(rejected.statusCode).toBe(200);
    expect(await stateOf(author.cookie, id)).toBe("not_ready");
  });

  it("says 'reviewed' once a manager has scored it", async () => {
    const admin = await superadmin();
    const { manager, author, critical } = await buildChain(admin);
    const id = await file(author.cookie, "Scored", critical.id);
    await resolve(admin, id, author.cookie);

    await inject("PUT", `/journal/${id}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 2 }],
    });
    await inject("PUT", `/journal/${id}/scores`, manager.cookie, {
      scores: [{ userId: author.id, points: 3 }],
    });
    expect(await stateOf(author.cookie, id)).toBe("reviewed");
  });

  it("filters by the same three states", async () => {
    const admin = await superadmin();
    const { author, critical } = await buildChain(admin);
    const open = await file(author.cookie, "Open one", critical.id);
    const ready = await file(author.cookie, "Resolved one", critical.id);
    await resolve(admin, ready, author.cookie);

    const filtered = async (value: string) => {
      const q = encodeURIComponent(JSON.stringify([{ field: "reviewState", op: "eq", value }]));
      const res = await inject("GET", `/journal?filters=${q}`, author.cookie);
      expect(res.statusCode).toBe(200);
      return (res.json().data as { id: string }[]).map((row) => row.id);
    };

    expect(await filtered("waiting")).toEqual([ready]);
    expect(await filtered("not_ready")).toContain(open);
    expect(await filtered("not_ready")).not.toContain(ready);
    expect(await filtered("reviewed")).toEqual([]);
  });
});
