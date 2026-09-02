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
  it("shows a submitted entry nobody has scored, and hides a draft", async () => {
    const admin = await superadmin();
    const { author, critical } = await buildChain(admin);
    await file(author.cookie, "Waiting on my manager", critical.id);
    await file(author.cookie, "Still a draft", critical.id, "draft");

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
