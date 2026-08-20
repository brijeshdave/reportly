// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for generated reports — the two things that make a report
// trustworthy and the saved-view rules that surround it:
//
//   - the rows a report contains are the caller's own journal scope. A manager
//     scoped to one plant, running a report, sees their downline's entries at that
//     plant and NOT the same people's entries at a plant they cannot reach. A report
//     is never a way around location or reporting-line scope.
//   - grouping gathers rows into sections with honest subtotals.
//   - a system view cannot be edited or deleted, only run or cloned; a clone is an
//     ordinary editable view its owner keeps private until they share it.
//   - a private view is invisible to another user; a company view is not.
//   - export returns a spreadsheet / an HTML page, gated on reports:export.
//
// The harness builds a real reporting line (operator → lead) and a real location
// scope (the lead's group reaches only Plant A), because those are the only things
// report scope is computed from.
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

/**
 * operator → lead, plus two plants. The lead is narrowed to Plant A; the operator
 * is not, so the operator can file at either plant. That gap is
 * exactly what makes "the lead's report drops Plant B" testable.
 */
async function fixture(admin: string) {
  const plantA = (await inject("POST", "/locations", admin, { name: "Plant A" })).json();
  const plantB = (await inject("POST", "/locations", admin, { name: "Plant B" })).json();

  const memberGroup = await makeGroup(admin, "Reporters", "Member");
  const managerGroup = await makeGroup(admin, "Plant A managers", "Manager");

  const lead = await makeUser(admin, "Ravi Lead", "ravi", managerGroup);
  const operator = await makeUser(admin, "Sam Operator", "sam", memberGroup);
  // Scope is the person's now: the lead is narrowed to Plant A, the operator is not.
  await inject("PUT", `/users/${lead.id}/locations`, admin, { ids: [plantA.id] });

  const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [
      { userId: lead.id, rank: "lead" },
      { userId: operator.id, rank: "member", reportsToId: lead.id },
    ],
  });

  return { plantA, plantB, memberGroup, managerGroup, lead, operator, dept };
}

/**
 * A person who may open exactly the reports named — the shape of the whole change.
 * Built as a custom role because the seeded ones are immutable, which is also how
 * an administrator would do it: a role per job, holding only what that job needs.
 */
async function personWhoMayRead(
  admin: string,
  username: string,
  keys: string[],
): Promise<{ id: string; cookie: string }> {
  const role = (
    await inject("POST", "/roles", admin, {
      name: `Only ${username}`,
      permissions: ["journal:read", ...keys],
    })
  ).json();
  const group = (await inject("POST", "/groups", admin, { name: `Group ${username}` })).json();
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return makeUser(admin, `Reader ${username}`, username, group.id);
}

// A fixed report date inside the WIDE window below, so the tests are deterministic
// whatever the wall clock says. `reportDate` is the field a report filters on.
const FIXED_DATE = "2026-05-15T08:00:00.000Z";

function fileEntry(cookie: string, title: string, locationId: string, minutes: number) {
  const started = new Date("2026-05-15T08:00:00.000Z");
  const ended = new Date(started.getTime() + minutes * 60_000);
  return inject("POST", "/journal", cookie, {
    kind: "work",
    title,
    workSummary: "did the thing",
    state: "submitted",
    locationId,
    reportDate: FIXED_DATE,
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
  });
}

// A fixed month window around the test data. Kept within the one-month cap on custom
// ranges (so it is not trimmed), and pinned to fixed dates so the assertions are about
// *which* rows, not *when* the suite runs.
const WIDE = {
  range: "custom" as const,
  from: "2026-05-01T00:00:00.000Z",
  to: "2026-05-31T00:00:00.000Z",
};

describe("reports", () => {
  // The audit that prompted these: of seventeen report sources, only the journal
  // and downtime narrowed their rows to the reader's sites. Reliability rolled up
  // every root asset in the company, and the cartridge reports every part — so a
  // reader confined to one plant could read another plant's figures.
  it("opens the reports a person was granted, and only those", async () => {
    const admin = await superadmin();
    const reader = await personWhoMayRead(admin, "onlyjournal", ["reports:view:journal"]);

    const allowed = await inject("POST", "/reports/run", reader.cookie, {
      definition: { source: "journal", ...WIDE },
    });
    expect(allowed.statusCode).toBe(200);

    // One key per report is the whole point: holding the journal report says
    // nothing about the downtime figures or the cartridge register.
    for (const source of ["downtime", "part_register", "leaderboard"]) {
      const refused = await inject("POST", "/reports/run", reader.cookie, {
        definition: { source, ...WIDE },
      });
      expect({ source, status: refused.statusCode }).toEqual({ source, status: 403 });
    }
  });

  it("refuses the export of a report it would refuse to show", async () => {
    const admin = await superadmin();
    const reader = await personWhoMayRead(admin, "noexport", ["reports:view:journal"]);

    // Viewing includes exporting, so the export route cannot be a way round the
    // view permission — it runs the same report and answers the same way.
    const xlsx = await inject("POST", "/reports/export.xlsx", reader.cookie, {
      definition: { source: "downtime", ...WIDE },
    });
    expect(xlsx.statusCode).toBe(403);

    const own = await inject("POST", "/reports/export.xlsx", reader.cookie, {
      definition: { source: "journal", ...WIDE },
    });
    expect(own.statusCode).toBe(200);
  });

  it("hides a saved view whose report the reader may not open", async () => {
    const admin = await superadmin();
    const reader = await personWhoMayRead(admin, "viewlist", ["reports:view:journal"]);

    const sources = (await inject("GET", "/report-views", reader.cookie))
      .json()
      .map((v: { definition: { source: string } }) => v.definition.source);

    // Listing a report you cannot run is an invitation to a 403.
    expect(sources).toContain("journal");
    expect(sources).not.toContain("downtime");
  });

  it("keeps the reliability report inside the reader's sites", async () => {
    const admin = await superadmin();
    const { plantA, plantB, lead } = await fixture(admin);

    await inject("POST", "/assets", admin, { name: "Line A", locationId: plantA.id });
    await inject("POST", "/assets", admin, { name: "Line B", locationId: plantB.id });

    const run = await inject("POST", "/reports/run", lead.cookie, {
      definition: { source: "reliability", ...WIDE },
    });
    expect(run.statusCode).toBe(200);

    const names = JSON.stringify(run.json().groups);
    expect(names).toContain("Line A");
    // The lead is narrowed to Plant A; Line B is another plant's machine.
    expect(names).not.toContain("Line B");
  });

  it("refuses to report on an asset outside the reader's sites", async () => {
    const admin = await superadmin();
    const { plantB, lead } = await fixture(admin);
    const lineB = (
      await inject("POST", "/assets", admin, { name: "Line B", locationId: plantB.id })
    ).json();

    // Naming the id directly is the door a filtered list leaves open: the answer
    // must be "not found", not that asset's figures.
    const run = await inject("POST", "/reports/run", lead.cookie, {
      definition: { source: "reliability", assetId: lineB.id, ...WIDE },
    });
    expect(run.statusCode).toBe(404);
  });

  it("scopes rows to the caller's reporting line and location, both at once", async () => {
    const admin = await superadmin();
    const { plantA, plantB, lead, operator } = await fixture(admin);

    // The operator (unscoped) files at both plants.
    await fileEntry(operator.cookie, "Belt swap at A", plantA.id, 30);
    await fileEntry(operator.cookie, "Belt swap at B", plantB.id, 45);

    // The lead manages the operator but reaches only Plant A: they see the A entry,
    // never the B entry — reporting line AND site must both admit a row.
    const res = await inject("POST", "/reports/run", lead.cookie, {
      definition: { ...WIDE, grouping: "none", columns: ["date", "title", "location"] },
    });
    expect(res.statusCode).toBe(200);
    const titles = res
      .json()
      .groups.flatMap((g: { rows: { cells: Record<string, string> }[] }) =>
        g.rows.map((r) => r.cells.title),
      );
    expect(titles).toContain("Belt swap at A");
    expect(titles).not.toContain("Belt swap at B");
    expect(res.json().totals.count).toBe(1);
  });

  it("groups rows with per-group subtotals and a grand total", async () => {
    const admin = await superadmin();
    const { plantA, lead, operator } = await fixture(admin);

    await fileEntry(operator.cookie, "A one", plantA.id, 30);
    await fileEntry(operator.cookie, "A two", plantA.id, 90);

    const res = await inject("POST", "/reports/run", lead.cookie, {
      definition: { ...WIDE, grouping: "location", columns: ["date", "title", "duration"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const groupA = body.groups.find((g: { label: string }) => g.label === "Plant A");
    expect(groupA.rows).toHaveLength(2);
    expect(groupA.totals.count).toBe(2);
    expect(groupA.totals.durationMinutes).toBe(120);
    expect(body.totals.durationMinutes).toBe(120);
  });

  it("filters to still-open issues, and to recurrences", async () => {
    const admin = await superadmin();
    const { plantA, lead } = await fixture(admin);

    const statuses = (await inject("GET", "/journal-statuses", lead.cookie)).json();
    const terminal =
      statuses.find((s: { isTerminal: boolean }) => s.isTerminal) ??
      statuses.find((s: { group: string }) => s.group === "resolved");

    const openIssue = (
      await inject("POST", "/journal", lead.cookie, {
        kind: "issue",
        title: "Open one",
        state: "submitted",
        locationId: plantA.id,
        reportDate: FIXED_DATE,
      })
    ).json();
    await inject("POST", "/journal", lead.cookie, {
      kind: "issue",
      title: "Resolved one",
      state: "submitted",
      locationId: plantA.id,
      reportDate: FIXED_DATE,
      statusId: terminal.id,
    });

    // openOnly drops the one in a terminal status.
    const open = await inject("POST", "/reports/run", lead.cookie, {
      definition: {
        ...WIDE,
        grouping: "none",
        columns: ["date", "title", "status"],
        filters: { openOnly: true },
      },
    });
    const openTitles = open
      .json()
      .groups.flatMap((g: { rows: { cells: Record<string, string> }[] }) =>
        g.rows.map((r) => r.cells.title),
      );
    expect(openTitles).toContain("Open one");
    expect(openTitles).not.toContain("Resolved one");

    // A recurrence of the open one, and the recurring filter keeps only it.
    await inject("POST", "/journal", lead.cookie, {
      kind: "issue",
      title: "It happened again",
      state: "submitted",
      locationId: plantA.id,
      reportDate: FIXED_DATE,
      recurrenceOfId: openIssue.id,
    });
    const recurring = await inject("POST", "/reports/run", lead.cookie, {
      definition: {
        ...WIDE,
        grouping: "none",
        columns: ["date", "title"],
        filters: { recurring: true },
      },
    });
    const recTitles = recurring
      .json()
      .groups.flatMap((g: { rows: { cells: Record<string, string> }[] }) =>
        g.rows.map((r) => r.cells.title),
      );
    expect(recTitles).toEqual(["It happened again"]);
  });

  it("a member without reports:view cannot run a report", async () => {
    const admin = await superadmin();
    const { operator } = await fixture(admin);
    const res = await inject("POST", "/reports/run", operator.cookie, {
      definition: { ...WIDE, grouping: "none", columns: ["date", "title"] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("ships system views, and refuses to edit or delete one — but clones it", async () => {
    const admin = await superadmin();
    const { lead } = await fixture(admin);

    const views = (await inject("GET", "/report-views", lead.cookie)).json();
    const daily = views.find((v: { name: string }) => v.name === "Daily journal");
    expect(daily).toBeTruthy();
    expect(daily.isSystem).toBe(true);

    // Editing or deleting a system view is refused for everyone.
    expect(
      (await inject("PATCH", `/report-views/${daily.id}`, admin, { name: "Hijacked" })).statusCode,
    ).toBe(403);
    expect((await inject("DELETE", `/report-views/${daily.id}`, admin)).statusCode).toBe(403);

    // Cloning it makes an editable, owned copy; the source keeps its name.
    const clone = await inject("POST", `/report-views/${daily.id}/clone`, lead.cookie, {
      name: "My daily",
    });
    expect(clone.statusCode).toBe(201);
    expect(clone.json().isSystem).toBe(false);
    expect(clone.json().access).toBe("private");

    const renamed = await inject("PATCH", `/report-views/${clone.json().id}`, lead.cookie, {
      name: "My daily (edited)",
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe("My daily (edited)");
  });

  it("keeps a private view to its owner but shares a company view", async () => {
    const admin = await superadmin();
    const { lead } = await fixture(admin);
    // A second manager (holds reports:view) is the "other user" the sharing is tested
    // against — no scope trickery, just a different person in the same company.
    const otherGroup = await makeGroup(admin, "Other managers", "Manager");
    const other = await makeUser(admin, "Meera Manager", "meera", otherGroup);

    const priv = await inject("POST", "/report-views", lead.cookie, {
      name: "Lead's private",
      access: "private",
      definition: { ...WIDE, grouping: "none", columns: ["date", "title"] },
    });
    expect(priv.statusCode).toBe(201);

    // The other manager does not see the lead's private view...
    let theirs = (await inject("GET", "/report-views", other.cookie)).json();
    expect(theirs.some((v: { id: string }) => v.id === priv.json().id)).toBe(false);
    // ...and cannot open it by id either (404, not 403 — no enumeration).
    expect((await inject("GET", `/report-views/${priv.json().id}`, other.cookie)).statusCode).toBe(
      404,
    );

    // Widen it to the whole company, and now it appears for them.
    await inject("PATCH", `/report-views/${priv.json().id}`, lead.cookie, { access: "company" });
    theirs = (await inject("GET", "/report-views", other.cookie)).json();
    expect(theirs.some((v: { id: string }) => v.id === priv.json().id)).toBe(true);
  });

  it("exports a spreadsheet and an A4 HTML page, gated on reports:export", async () => {
    const admin = await superadmin();
    const { plantA, lead, operator } = await fixture(admin);
    await fileEntry(operator.cookie, "Something", plantA.id, 20);

    const body = {
      definition: { ...WIDE, grouping: "location", columns: ["date", "title", "duration"] },
    };

    const xlsx = await inject("POST", "/reports/export.xlsx", lead.cookie, body);
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
    expect(xlsx.headers["content-disposition"]).toContain("attachment");
    expect(xlsx.rawPayload.length).toBeGreaterThan(0);

    const html = await inject("POST", "/reports/export.html", lead.cookie, body);
    expect(html.statusCode).toBe(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.body).toContain("@page");
    expect(html.body).toContain("Plant A");

    // The operator, without reports:export, is refused the download.
    const denied = await inject("POST", "/reports/export.xlsx", operator.cookie, body);
    expect(denied.statusCode).toBe(403);
  });

  it("runs a downtime report — one row per outage, with total downtime", async () => {
    const admin = await superadmin();
    const { plantA, lead } = await fixture(admin);

    const asset = (await inject("POST", "/assets", lead.cookie, { name: "Line 3" })).json();
    const report = (
      await inject("POST", "/journal", lead.cookie, {
        kind: "issue",
        title: "Belt down",
        state: "submitted",
        locationId: plantA.id,
        targets: [{ kind: "asset", id: asset.id }],
      })
    ).json();
    await inject("POST", "/downtime", lead.cookie, {
      reportId: report.id,
      targetKind: "asset",
      targetId: asset.id,
      startedAt: "2026-05-01T09:00:00.000Z",
      endedAt: "2026-05-01T11:00:00.000Z",
      reason: "Belt seized",
    });

    const res = await inject("POST", "/reports/run", lead.cookie, {
      definition: { ...WIDE, source: "downtime", grouping: "asset" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.source).toBe("downtime");
    const rows = res.json().groups.flatMap((g: { rows: Row[] }) => g.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.asset).toBe("Line 3");
    expect(rows[0].cells.reason).toBe("Belt seized");
    // Two hours down (09:00–11:00), summed across the outages.
    expect(res.json().totals.downtimeMinutes).toBe(120);
  });

  it("runs a reliability report — one row per asset, counting failures", async () => {
    const admin = await superadmin();
    const { plantA, lead } = await fixture(admin);

    const asset = (await inject("POST", "/assets", lead.cookie, { name: "Line 3" })).json();
    const report = (
      await inject("POST", "/journal", lead.cookie, {
        kind: "issue",
        title: "Belt down",
        state: "submitted",
        locationId: plantA.id,
        targets: [{ kind: "asset", id: asset.id }],
      })
    ).json();
    await inject("POST", "/downtime", lead.cookie, {
      reportId: report.id,
      targetKind: "asset",
      targetId: asset.id,
      startedAt: "2026-05-01T09:00:00.000Z",
      endedAt: "2026-05-01T11:00:00.000Z",
      reason: "Belt seized",
    });

    const res = await inject("POST", "/reports/run", lead.cookie, {
      definition: { ...WIDE, source: "reliability", grouping: "none" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.source).toBe("reliability");
    const rows = res.json().groups.flatMap((g: { rows: Row[] }) => g.rows);
    const line = rows.find((r) => r.cells.asset === "Line 3");
    expect(line).toBeTruthy();
    // One outage started in the window — one failure against the line.
    expect(line!.cells.failures).toBe("1");
  });

  it("ranks people on the leaderboard by points earned in the window", async () => {
    const admin = await superadmin();
    const { plantA, lead } = await fixture(admin);

    // The lead files an issue, resolves it, and scores themselves — which writes a
    // point award into the ledger the leaderboard sums.
    const report = (
      await inject("POST", "/journal", lead.cookie, {
        kind: "issue",
        title: "Belt down",
        state: "submitted",
        locationId: plantA.id,
        reportDate: FIXED_DATE,
      })
    ).json();
    const statuses = (await inject("GET", "/journal-statuses", lead.cookie)).json();
    const resolved = statuses.find((st: { name: string }) => st.name === "Resolved");
    await inject("PATCH", `/journal/${report.id}/status`, lead.cookie, { statusId: resolved.id });
    await inject("PUT", `/journal/${report.id}/scores`, lead.cookie, {
      scores: [{ userId: lead.id, points: 8 }],
    });

    const res = await inject("POST", "/reports/run", lead.cookie, {
      definition: { ...WIDE, source: "leaderboard", grouping: "none" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.source).toBe("leaderboard");
    const rows = res.json().groups.flatMap((g: { rows: Row[] }) => g.rows);
    const leadRow = rows.find((r) => r.cells.person === "Ravi Lead");
    expect(leadRow).toBeTruthy();
    expect(leadRow!.cells.points).toBe("8");
    expect(leadRow!.cells.rank).toBe("1");
  });

  it("gates the leaderboard page on its own permission, not reports:view", async () => {
    const admin = await superadmin();
    const { lead, operator } = await fixture(admin);
    // A Member holds neither reports:view nor leaderboard:view.
    expect((await inject("GET", "/reports/leaderboard", operator.cookie)).statusCode).toBe(403);
    // A Manager holds leaderboard:view (granted explicitly in the seed).
    expect((await inject("GET", "/reports/leaderboard", lead.cookie)).statusCode).toBe(200);
  });

  it("leaves an opted-out person out of the leaderboard page standings", async () => {
    const admin = await superadmin();
    const { plantA, lead } = await fixture(admin);

    // The lead earns 8 points, exactly as above.
    const report = (
      await inject("POST", "/journal", lead.cookie, {
        kind: "issue",
        title: "Belt down",
        state: "submitted",
        locationId: plantA.id,
        reportDate: FIXED_DATE,
      })
    ).json();
    const statuses = (await inject("GET", "/journal-statuses", lead.cookie)).json();
    const resolved = statuses.find((st: { name: string }) => st.name === "Resolved");
    await inject("PATCH", `/journal/${report.id}/status`, lead.cookie, { statusId: resolved.id });
    await inject("PUT", `/journal/${report.id}/scores`, lead.cookie, {
      scores: [{ userId: lead.id, points: 8 }],
    });

    // FIXED_DATE (May 2026) is in financial year 2026. Company-wide as superadmin.
    const before = await inject("GET", "/reports/leaderboard?fyStart=2026&limit=10", admin);
    expect(before.statusCode).toBe(200);
    expect(before.json().fyStart).toBe(2026);
    expect(before.json().entries.some((e: { userId: string }) => e.userId === lead.id)).toBe(true);

    // Opt the lead out, and they drop from the standings entirely.
    await inject("PATCH", `/users/${lead.id}`, admin, { countsOnLeaderboard: false });
    const after = await inject("GET", "/reports/leaderboard?fyStart=2026&limit=10", admin);
    expect(after.json().entries.some((e: { userId: string }) => e.userId === lead.id)).toBe(false);
  });

  it("scopes the leaderboard page to a single month within the financial year", async () => {
    const admin = await superadmin();
    const { plantA, lead } = await fixture(admin);

    const report = (
      await inject("POST", "/journal", lead.cookie, {
        kind: "issue",
        title: "Belt down",
        state: "submitted",
        locationId: plantA.id,
        reportDate: FIXED_DATE, // 15 May 2026
      })
    ).json();
    const statuses = (await inject("GET", "/journal-statuses", lead.cookie)).json();
    const resolved = statuses.find((st: { name: string }) => st.name === "Resolved");
    await inject("PATCH", `/journal/${report.id}/status`, lead.cookie, { statusId: resolved.id });
    await inject("PUT", `/journal/${report.id}/scores`, lead.cookie, {
      scores: [{ userId: lead.id, points: 8 }],
    });

    // May (month 5) contains the entry; June (month 6) does not.
    const may = await inject("GET", "/reports/leaderboard?fyStart=2026&month=5", admin);
    expect(may.json().month).toBe(5);
    expect(may.json().entries.some((e: { userId: string }) => e.userId === lead.id)).toBe(true);

    const june = await inject("GET", "/reports/leaderboard?fyStart=2026&month=6", admin);
    expect(june.json().entries.some((e: { userId: string }) => e.userId === lead.id)).toBe(false);
  });

  it("filters journal entries to a specific device", async () => {
    const admin = await superadmin();
    const { plantA, lead } = await fixture(admin);

    const device = (await inject("POST", "/devices", lead.cookie, { name: "Sensor 12" })).json();
    // One entry about the device, one about nothing.
    await inject("POST", "/journal", lead.cookie, {
      kind: "issue",
      title: "Sensor fault",
      state: "submitted",
      locationId: plantA.id,
      reportDate: FIXED_DATE,
      targets: [{ kind: "device", id: device.id }],
    });
    await fileEntry(lead.cookie, "Unrelated work", plantA.id, 20);

    const res = await inject("POST", "/reports/run", lead.cookie, {
      definition: {
        ...WIDE,
        grouping: "none",
        columns: ["date", "title"],
        filters: { deviceId: [device.id] },
      },
    });
    expect(res.statusCode).toBe(200);
    const titles = res
      .json()
      .groups.flatMap((g: { rows: Row[] }) => g.rows.map((r) => r.cells.title));
    expect(titles).toEqual(["Sensor fault"]);
  });

  it("runs a per-device reliability report", async () => {
    const admin = await superadmin();
    const { plantA, lead } = await fixture(admin);

    const device = (await inject("POST", "/devices", lead.cookie, { name: "Sensor 12" })).json();
    const report = (
      await inject("POST", "/journal", lead.cookie, {
        kind: "issue",
        title: "Sensor down",
        state: "submitted",
        locationId: plantA.id,
        targets: [{ kind: "device", id: device.id }],
      })
    ).json();
    await inject("POST", "/downtime", lead.cookie, {
      reportId: report.id,
      targetKind: "device",
      targetId: device.id,
      startedAt: "2026-05-01T09:00:00.000Z",
      endedAt: "2026-05-01T10:00:00.000Z",
      reason: "Cable",
    });

    const res = await inject("POST", "/reports/run", lead.cookie, {
      definition: { ...WIDE, source: "reliability", grouping: "none", byDevice: true },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().groups.flatMap((g: { rows: Row[] }) => g.rows);
    const sensor = rows.find((r) => r.cells.device === "Sensor 12");
    expect(sensor).toBeTruthy();
    expect(sensor!.cells.failures).toBe("1");
  });

  it("runs a per-month reliability report — one row per month, failure in the right one", async () => {
    const admin = await superadmin();
    const { plantA, lead } = await fixture(admin);

    const asset = (await inject("POST", "/assets", lead.cookie, { name: "Line 3" })).json();
    const report = (
      await inject("POST", "/journal", lead.cookie, {
        kind: "issue",
        title: "Belt down",
        state: "submitted",
        locationId: plantA.id,
        targets: [{ kind: "asset", id: asset.id }],
      })
    ).json();
    await inject("POST", "/downtime", lead.cookie, {
      reportId: report.id,
      targetKind: "asset",
      targetId: asset.id,
      startedAt: "2026-05-01T09:00:00.000Z",
      endedAt: "2026-05-01T11:00:00.000Z",
      reason: "Belt seized",
    });

    // A year's window, capped at 12 monthly buckets; the asset defaults to the root.
    const res = await inject("POST", "/reports/run", lead.cookie, {
      definition: {
        source: "reliability",
        monthly: true,
        range: "custom",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-12-31T00:00:00.000Z",
        grouping: "none",
      },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().groups.flatMap((g: { rows: Row[] }) => g.rows);
    expect(rows).toHaveLength(12);
    const may = rows.find((r) => r.cells.month === "May 2026");
    expect(may).toBeTruthy();
    expect(may!.cells.failures).toBe("1");
    // A quiet month has no failures.
    expect(rows.find((r) => r.cells.month === "Feb 2026")!.cells.failures).toBe("0");
  });
});

interface Row {
  cells: Record<string, string>;
}
