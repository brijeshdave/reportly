// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for end users — the people the team supports, who have no
// Reportly account.
//
// The four rules worth a test are the four that will otherwise be broken by somebody
// who has not read the feature:
//
//   - the employee number is the identity: required, and unique inside a company but
//     not across companies.
//   - the journal's picker offers the *active* people in the departments chosen, and
//     nobody else — which is the whole difference between inactive and deleted.
//   - an import is all or nothing, and a department name it does not recognise is a
//     problem reported back rather than a new department invented.
//   - somebody named on an entry cannot be deleted, because the reports are built
//     from those names.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";
import { anySeverityId } from "../../../../test/seeded.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

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

async function superadmin(): Promise<string> {
  const password = await resetSuperadmin();
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: "admin@reportly.local", password },
  });
  return cookieFrom(res);
}

function inject(method: string, url: string, cookie: string, payload?: unknown, company?: string) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": company ?? DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

/** A CSV as a multipart upload, built by hand — no client involved. */
function uploadCsv(cookie: string, csv: string) {
  const boundary = "----reportlyenduserimport";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="end-users.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n`,
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/end-users/import`,
    headers: {
      cookie,
      "x-company-id": DEMO_COMPANY_ID,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

async function makeDepartment(cookie: string, name: string): Promise<string> {
  const res = await inject("POST", "/departments", cookie, { name });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function makeEndUser(
  cookie: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await inject("POST", "/end-users", cookie, body);
  expect(res.statusCode).toBe(201);
  return res.json();
}

const IMPORT_HEADER = "Employee number,Full name,Department,Notes,Status";

describe("end users", () => {
  it("creates one, active by default, named on nothing", async () => {
    const admin = await superadmin();
    const person = await makeEndUser(admin, { fullName: "Anita Sharma", employeeNumber: "EMP-1" });

    expect(person).toMatchObject({
      fullName: "Anita Sharma",
      employeeNumber: "EMP-1",
      status: "active",
      departmentId: null,
      entryCount: 0,
    });
  });

  it("refuses a second person with the same employee number", async () => {
    const admin = await superadmin();
    await makeEndUser(admin, { fullName: "Anita Sharma", employeeNumber: "EMP-1" });

    const clash = await inject("POST", "/end-users", admin, {
      fullName: "Anil Sharma",
      employeeNumber: "EMP-1",
    });
    expect(clash.statusCode).toBe(400);
    expect(clash.json().error.message).toContain("EMP-1");
  });

  it("keeps employee numbers unique per company, not across them", async () => {
    const admin = await superadmin();
    const other = (await inject("POST", "/companies", admin, { name: "Second Plant" })).json();

    await makeEndUser(admin, { fullName: "Anita Sharma", employeeNumber: "EMP-1" });
    const elsewhere = await inject(
      "POST",
      "/end-users",
      admin,
      { fullName: "Someone Else", employeeNumber: "EMP-1" },
      other.id,
    );
    expect(elsewhere.statusCode).toBe(201);

    // And neither company's list shows the other's person.
    const here = (await inject("GET", "/end-users", admin)).json();
    expect(here.data).toHaveLength(1);
    expect(here.data[0].fullName).toBe("Anita Sharma");
    const there = (await inject("GET", "/end-users", admin, undefined, other.id)).json();
    expect(there.data.map((r: { fullName: string }) => r.fullName)).toEqual(["Someone Else"]);
  });

  it("offers the journal only the active people in the departments chosen", async () => {
    const admin = await superadmin();
    const accounts = await makeDepartment(admin, "Accounts");
    const stores = await makeDepartment(admin, "Stores");

    await makeEndUser(admin, {
      fullName: "In Accounts",
      employeeNumber: "EMP-A",
      departmentId: accounts,
    });
    await makeEndUser(admin, {
      fullName: "In Stores",
      employeeNumber: "EMP-S",
      departmentId: stores,
    });
    await makeEndUser(admin, {
      fullName: "Left The Company",
      employeeNumber: "EMP-X",
      departmentId: accounts,
      status: "inactive",
    });
    await makeEndUser(admin, { fullName: "A Contractor", employeeNumber: "EMP-C" });

    const narrowed = (
      await inject("GET", `/end-users/pickable?departmentIds=${accounts}`, admin)
    ).json();
    expect(narrowed.map((p: { fullName: string }) => p.fullName)).toEqual(["In Accounts"]);

    // No departments chosen: every active person, including the one who belongs to
    // no department at all.
    const all = (await inject("GET", "/end-users/pickable", admin)).json();
    expect(all.map((p: { fullName: string }) => p.fullName).sort()).toEqual([
      "A Contractor",
      "In Accounts",
      "In Stores",
    ]);
  });

  it("searches by name or by employee number, in one box", async () => {
    const admin = await superadmin();
    await makeEndUser(admin, { fullName: "Anita Sharma", employeeNumber: "EMP-1001" });
    await makeEndUser(admin, { fullName: "Ravi Kumar", employeeNumber: "EMP-2002" });

    const search = async (term: string) => {
      const filters = JSON.stringify([{ field: "search", op: "contains", value: term }]);
      const res = await inject("GET", `/end-users?filters=${encodeURIComponent(filters)}`, admin);
      expect(res.statusCode).toBe(200);
      return res.json().data.map((r: { fullName: string }) => r.fullName);
    };

    expect(await search("anita")).toEqual(["Anita Sharma"]);
    // The number, which is what somebody reading it off a laptop has.
    expect(await search("EMP-2002")).toEqual(["Ravi Kumar"]);
    // Case-insensitive and partial, like every other search in the app.
    expect(await search("emp-")).toEqual(["Anita Sharma", "Ravi Kumar"]);
    expect(await search("nobody")).toEqual([]);
  });

  it("imports by employee number: adds the new, corrects the known", async () => {
    const admin = await superadmin();
    await makeDepartment(admin, "Accounts");

    const first = await uploadCsv(
      admin,
      `${IMPORT_HEADER}\nEMP-1,Anita Sharma,Accounts,2nd floor,active\nEMP-2,Ravi Kumar,,,active\n`,
    );
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ created: 2, updated: 0, problems: [] });

    // The same numbers again, with a new name and department: a correction, not a
    // second pair of people.
    const second = await uploadCsv(
      admin,
      `${IMPORT_HEADER}\nEMP-1,Anita Sharma-Rao,Accounts,Moved to 3rd floor,active\nEMP-2,Ravi Kumar,,,inactive\n`,
    );
    expect(second.json()).toMatchObject({ created: 0, updated: 2, problems: [] });

    const list = (await inject("GET", "/end-users", admin)).json();
    expect(list.total).toBe(2);
    const anita = list.data.find((r: { employeeNumber: string }) => r.employeeNumber === "EMP-1");
    expect(anita).toMatchObject({
      fullName: "Anita Sharma-Rao",
      departmentName: "Accounts",
      description: "Moved to 3rd floor",
    });
  });

  it("writes nothing when a row names a department that does not exist", async () => {
    const admin = await superadmin();
    await makeDepartment(admin, "Accounts");

    const res = await uploadCsv(
      admin,
      `${IMPORT_HEADER}\nEMP-1,Anita Sharma,Accounts,,active\nEMP-2,Ravi Kumar,Acounts,,active\n`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(0);
    expect(res.json().updated).toBe(0);
    expect(res.json().problems).toHaveLength(1);
    expect(res.json().problems[0].message).toContain("Acounts");

    // All or nothing: the good row above it was not written either.
    expect((await inject("GET", "/end-users", admin)).json().total).toBe(0);
  });

  it("rejects a file that names the same employee number twice", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(
      admin,
      `${IMPORT_HEADER}\nEMP-1,Anita Sharma,,,active\nEMP-1,Someone Else,,,active\n`,
    );
    expect(res.json().created).toBe(0);
    expect(res.json().problems.length).toBeGreaterThan(0);
    expect((await inject("GET", "/end-users", admin)).json().total).toBe(0);
  });

  it("exports a real spreadsheet, and a template to fill in", async () => {
    const admin = await superadmin();
    await makeEndUser(admin, { fullName: "Anita Sharma", employeeNumber: "EMP-1" });

    const sheet = await inject("GET", "/end-users/export", admin);
    expect(sheet.statusCode).toBe(200);
    expect(sheet.headers["content-type"]).toContain("spreadsheetml");
    // A real xlsx is a zip: "PK".
    expect(sheet.rawPayload.subarray(0, 2).toString()).toBe("PK");

    const template = await inject("GET", "/end-users/import/template", admin);
    expect(template.statusCode).toBe(200);
    expect(template.rawPayload.subarray(0, 2).toString()).toBe("PK");
  });

  it("deletes somebody named on nothing, and refuses once an entry names them", async () => {
    const admin = await superadmin();
    const spare = await makeEndUser(admin, { fullName: "Never Used", employeeNumber: "EMP-0" });
    const named = await makeEndUser(admin, { fullName: "Anita Sharma", employeeNumber: "EMP-1" });

    expect((await inject("DELETE", `/end-users/${spare.id}`, admin)).statusCode).toBe(204);

    const entry = await inject("POST", "/journal", admin, {
      kind: "issue",
      severityId: await anySeverityId(),
      title: "Excel will not open",
      state: "submitted",
      targets: [{ kind: "endUser", id: named.id }],
    });
    expect(entry.statusCode).toBe(201);
    // The label is resolved from the master list, with the number that tells two
    // people of the same name apart.
    expect(entry.json().targets[0].label).toBe("Anita Sharma (EMP-1)");

    const refused = await inject("DELETE", `/end-users/${named.id}`, admin);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toContain("inactive");

    // And the count is on the record, which is what the master screen shows.
    expect((await inject("GET", `/end-users/${named.id}`, admin)).json().entryCount).toBe(1);
  });

  it("makes somebody inactive without touching the entries that name them", async () => {
    const admin = await superadmin();
    const person = await makeEndUser(admin, { fullName: "Anita Sharma", employeeNumber: "EMP-1" });
    await inject("POST", "/journal", admin, {
      kind: "issue",
      severityId: await anySeverityId(),
      title: "Printer jam",
      state: "submitted",
      targets: [{ kind: "endUser", id: person.id }],
    });

    const patched = await inject("PATCH", `/end-users/${person.id}`, admin, {
      status: "inactive",
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ status: "inactive", entryCount: 1 });

    // Out of the picker, still on the record.
    expect((await inject("GET", "/end-users/pickable", admin)).json()).toHaveLength(0);
  });
});
