// Author: Brijesh Dave <https://github.com/brijeshdave>
// The two end-user report sources: "every entry, by the person it happened to" and
// "one row per person".
//
// What is worth testing is what makes them different from the journal report they are
// built on:
//
//   - an entry naming two people is two rows in the detail report, and an entry
//     naming nobody is not in it at all.
//   - the summary counts issues and what is still open, and is ordered by who it
//     happened to most.
//   - each report has its own key, so one does not admit the other.
//   - the rows are still the reader's own journal scope — a report is never a way
//     round the reporting line.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";
import { anySeverityId } from "../../../../test/seeded.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const TEMP_PW = "Str0ngTempPass!x";
const OWN_PW = "TheirOwnP4ss!ok";

interface Row {
  cells: Record<string, string>;
}

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

/** A person holding exactly the report keys named, and nothing else. */
async function readerWith(admin: string, username: string, keys: string[]) {
  const role = (
    await inject("POST", "/roles", admin, {
      name: `Only ${username}`,
      permissions: ["journal:read", "end-users:read", ...keys],
    })
  ).json();
  const group = (await inject("POST", "/groups", admin, { name: `Group ${username}` })).json();
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });

  const created = await inject("POST", "/users", admin, {
    name: `Reader ${username}`,
    email: `${username}@reportly.test`,
    username,
    password: TEMP_PW,
  });
  const id = created.json().id as string;
  await inject("PUT", `/users/${id}/companies`, admin, { ids: [DEMO_COMPANY_ID] });
  const assignments = (await inject("GET", `/groups/${group.id}/assignments`, admin)).json();
  await inject("PUT", `/groups/${group.id}/users`, admin, { ids: [...assignments.users, id] });

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

// A window the fixed entry dates below fall inside, so the wall clock cannot make
// these tests flap.
const WIDE = {
  range: "custom" as const,
  from: "2026-05-01T00:00:00.000Z",
  to: "2026-05-31T00:00:00.000Z",
};
const FIXED_DATE = "2026-05-15T08:00:00.000Z";

async function endUser(cookie: string, fullName: string, employeeNumber: string, deptId?: string) {
  const res = await inject("POST", "/end-users", cookie, {
    fullName,
    employeeNumber,
    ...(deptId ? { departmentId: deptId } : {}),
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function fileIssue(
  cookie: string,
  title: string,
  endUserIds: string[],
  extra: Record<string, unknown> = {},
) {
  const res = await inject("POST", "/journal", cookie, {
    kind: "issue",
    severityId: await anySeverityId(),
    title,
    state: "submitted",
    reportDate: FIXED_DATE,
    targets: endUserIds.map((id) => ({ kind: "endUser", id })),
    ...extra,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

const rowsOf = (res: { json: () => { groups: { rows: Row[] }[] } }) =>
  res.json().groups.flatMap((g) => g.rows);

describe("end-user reports", () => {
  it("gives a row per person named, and skips entries that name nobody", async () => {
    const admin = await superadmin();
    const anita = await endUser(admin, "Anita Sharma", "EMP-1");
    const ravi = await endUser(admin, "Ravi Kumar", "EMP-2");

    await fileIssue(admin, "Shared printer jammed", [anita, ravi]);
    await fileIssue(admin, "Excel will not open", [anita]);
    // About the department as a whole, not a person: not an end-user report row.
    await fileIssue(admin, "Network slow all morning", []);

    const res = await inject("POST", "/reports/run", admin, {
      definition: { source: "end_user_issues", ...WIDE },
    });
    expect(res.statusCode).toBe(200);
    const rows = rowsOf(res);

    // Two people on one entry is two rows; the entry naming nobody is absent.
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.cells.title === "Shared printer jammed")).toHaveLength(2);
    expect(rows.some((r) => r.cells.title === "Network slow all morning")).toBe(false);

    const anitaRows = rows.filter((r) => r.cells.endUser === "Anita Sharma");
    expect(anitaRows).toHaveLength(2);
    expect(anitaRows[0]!.cells.employeeNumber).toBe("EMP-1");
    expect(anitaRows[0]!.cells.kind).toBe("Issue");
  });

  it("summarises per person, most affected first, counting what is still open", async () => {
    const admin = await superadmin();
    const dept = (await inject("POST", "/departments", admin, { name: "Accounts" })).json();
    const anita = await endUser(admin, "Anita Sharma", "EMP-1", dept.id);
    const ravi = await endUser(admin, "Ravi Kumar", "EMP-2");

    await fileIssue(admin, "Printer jam", [anita]);
    await fileIssue(admin, "Excel will not open", [anita]);
    await fileIssue(admin, "Mouse not working", [ravi]);

    const res = await inject("POST", "/reports/run", admin, {
      definition: { source: "end_user_summary", ...WIDE },
    });
    expect(res.statusCode).toBe(200);
    const rows = rowsOf(res);

    expect(rows.map((r) => r.cells.endUser)).toEqual(["Anita Sharma", "Ravi Kumar"]);
    expect(rows[0]!.cells).toMatchObject({
      employeeNumber: "EMP-1",
      department: "Accounts",
      entries: "2",
      issues: "2",
      // Nothing has been resolved, and an entry with no terminal status is open.
      open: "2",
    });
    // Nobody has waited for a resolution yet, which is not a wait of zero.
    expect(rows[0]!.cells.mttr).toBe("—");
    // Somebody with no department reads as "—" rather than inventing one.
    expect(rows[1]!.cells.department).toBe("—");
  });

  it("narrows to named end users when asked", async () => {
    const admin = await superadmin();
    const anita = await endUser(admin, "Anita Sharma", "EMP-1");
    const ravi = await endUser(admin, "Ravi Kumar", "EMP-2");
    await fileIssue(admin, "Printer jam", [anita]);
    await fileIssue(admin, "Mouse not working", [ravi]);

    const res = await inject("POST", "/reports/run", admin, {
      definition: { source: "end_user_summary", ...WIDE, filters: { endUserId: [anita] } },
    });
    expect(rowsOf(res).map((r) => r.cells.endUser)).toEqual(["Anita Sharma"]);
  });

  it("holds one key per report — the summary does not admit the detail", async () => {
    const admin = await superadmin();
    const reader = await readerWith(admin, "summaryonly", ["reports:view:end_user_summary"]);

    const allowed = await inject("POST", "/reports/run", reader.cookie, {
      definition: { source: "end_user_summary", ...WIDE },
    });
    expect(allowed.statusCode).toBe(200);

    const refused = await inject("POST", "/reports/run", reader.cookie, {
      definition: { source: "end_user_issues", ...WIDE },
    });
    expect(refused.statusCode).toBe(403);
  });

  it("shows only the entries the reader could open in the journal", async () => {
    const admin = await superadmin();
    const anita = await endUser(admin, "Anita Sharma", "EMP-1");
    // Filed by the superadmin, who is nobody's subordinate: a reader outside that
    // reporting line must not read it through a report.
    await fileIssue(admin, "Printer jam", [anita]);

    const reader = await readerWith(admin, "outsider", [
      "reports:view:end_user_issues",
      "reports:view:end_user_summary",
    ]);
    const res = await inject("POST", "/reports/run", reader.cookie, {
      definition: { source: "end_user_issues", ...WIDE },
    });
    expect(res.statusCode).toBe(200);
    expect(rowsOf(res)).toHaveLength(0);
  });

  it("exports both reports as a spreadsheet and a printable page", async () => {
    const admin = await superadmin();
    const anita = await endUser(admin, "Anita Sharma", "EMP-1");
    await fileIssue(admin, "Printer jam", [anita]);

    for (const source of ["end_user_issues", "end_user_summary"]) {
      const body = { definition: { source, ...WIDE } };
      const xlsx = await inject("POST", "/reports/export.xlsx", admin, body);
      expect({ source, status: xlsx.statusCode }).toEqual({ source, status: 200 });
      expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe("PK");

      const html = await inject("POST", "/reports/export.html", admin, body);
      expect({ source, status: html.statusCode }).toEqual({ source, status: 200 });
      expect(html.body).toContain("Anita Sharma");
    }
  });
});
