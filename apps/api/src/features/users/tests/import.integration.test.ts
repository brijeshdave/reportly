// Author: Brijesh Dave <https://github.com/brijeshdave>
// User import/export: a file invites a new person (no password), refuses the Superadmin
// group, reports an unknown group and writes nothing, and the export round-trips.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

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

/**
 * Look the roster up by the one address the case is about, rather than listing
 * everything and searching the page. `pageSize` is validated against
 * PAGE_SIZE_OPTIONS and caps at 100, so "ask for all of them" is not a thing the
 * API offers — and a request over the cap is a 400 whose body carries no `data`.
 */
function byEmail(email: string): string {
  const filters = JSON.stringify([{ field: "email", op: "eq", value: email }]);
  return `/users?filters=${encodeURIComponent(filters)}`;
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

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

function uploadCsv(cookie: string, csv: string) {
  const boundary = "----reportlyuserimport";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="users.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n`,
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/users/import`,
    headers: {
      cookie,
      "x-company-id": DEMO_COMPANY_ID,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

const HEADER = "Email,Name,Username,Employee ID,Designation,Mobile,Groups,Companies,Status";

describe("user import/export", () => {
  it("invites a new person (no password), who appears in the roster", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(admin, `${HEADER}\nnewbie@acme.test,New Bie,newbie,,,,,,active`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, updated: 0, problems: [] });

    const users = (await inject("GET", byEmail("newbie@acme.test"), admin)).json();
    expect(users.data).toHaveLength(1);
  });

  it("refuses the Superadmin group, writing nothing", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(
      admin,
      `${HEADER}\nnope@acme.test,No Pe,nope,,,,Superadmin,,active`,
    );
    expect(res.json().created).toBe(0);
    expect(res.json().problems[0].message).toContain("Superadmin group");
    const users = (await inject("GET", byEmail("nope@acme.test"), admin)).json();
    expect(users.data).toHaveLength(0);
  });

  it("reports an unknown group and writes nothing", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(
      admin,
      `${HEADER}\nghost@acme.test,Ghost,ghost,,,,No Such Group,,active`,
    );
    expect(res.json()).toMatchObject({
      created: 0,
      problems: [{ line: 2, message: 'No group called "No Such Group"' }],
    });
    const users = (await inject("GET", byEmail("ghost@acme.test"), admin)).json();
    expect(users.data).toHaveLength(0);
  });

  it("rejects a malformed email, reporting the line", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(admin, `${HEADER}\nnot-an-email,Bad Email,bademail,,,,,,active`);
    expect(res.json()).toMatchObject({
      created: 0,
      problems: [{ line: 2, message: '"not-an-email" is not a valid email' }],
    });
  });

  it("round-trips the export as a real spreadsheet", async () => {
    const admin = await superadmin();
    const exported = await inject("GET", "/users/export", admin);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml");
    expect(exported.rawPayload.length).toBeGreaterThan(0);
  });
});

describe("company assignment is superadmin-shaped (SF-007)", () => {
  /**
   * A user who administers people but is not a superadmin: they hold the roster
   * permissions an Access admin has, and deliberately not users:assign-companies.
   */
  async function accessAdminCookie(admin: string): Promise<string> {
    const role = (
      await inject("POST", "/roles", admin, {
        name: "Roster admin",
        permissions: ["users:read", "users:create", "users:update", "users:import"],
      })
    ).json();
    const group = (await inject("POST", "/groups", admin, { name: "Roster admins" })).json();
    await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });

    // Sign-up rather than create-then-set-password: an admin-set password sets
    // mustChangePassword, so the account cannot be used until it is replaced.
    const signUp = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-up/email`,
      payload: { email: "roster@acme.test", password: "R0sterAdmin!pass", name: "Roster Admin" },
    });
    const cookie = cookieFrom(signUp);

    const roster = (await inject("GET", byEmail("roster@acme.test"), admin)).json().data[0];
    await inject("PUT", `/users/${roster.id}/groups`, admin, { ids: [group.id] });
    await inject("PUT", `/users/${roster.id}/companies`, admin, { ids: [DEMO_COMPANY_ID] });
    return cookie;
  }

  it("refuses to set a person's companies without the permission", async () => {
    const admin = await superadmin();
    const roster = await accessAdminCookie(admin);
    const target = (
      await inject("POST", "/users", admin, {
        email: "target@acme.test",
        name: "Target",
        username: "target",
      })
    ).json();

    // Holding users:update is no longer enough — this is the direct route in.
    const res = await inject("PUT", `/users/${target.id}/companies`, roster, {
      ids: [DEMO_COMPANY_ID],
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses an import row that names a company, without the permission", async () => {
    // The softer way in of the two: the direct route needs the other tenant's
    // UUID, a name is something you can simply type.
    const admin = await superadmin();
    const roster = await accessAdminCookie(admin);

    const res = await uploadCsv(
      roster,
      `${HEADER}\nplaced@acme.test,Placed,placed,,,,,Acme Corp,active`,
    );
    expect(res.json().created).toBe(0);
    expect(JSON.stringify(res.json().problems)).toContain("users:assign-companies");
  });

  it("still imports a row that leaves the companies cell blank", async () => {
    // The guard must not break the ordinary case: an empty cell means "leave
    // their companies alone", which is not a privileged act.
    const admin = await superadmin();
    const roster = await accessAdminCookie(admin);

    const res = await uploadCsv(roster, `${HEADER}\nplain@acme.test,Plain,plain,,,,,,active`);
    expect(res.json()).toMatchObject({ created: 1, problems: [] });
  });

  it("lets a superadmin do both", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(
      admin,
      `${HEADER}\nsuper@acme.test,Super Placed,superplaced,,,,,Acme Corp,active`,
    );
    expect(res.json()).toMatchObject({ created: 1, problems: [] });
  });
});
