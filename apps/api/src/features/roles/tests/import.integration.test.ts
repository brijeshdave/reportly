// Author: Brijesh Dave <https://github.com/brijeshdave>
// Role import/export: a file creates a role with permissions, refuses a system role, reports
// an unknown permission key, and the export round-trips.
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
 * Look a role up by the one name the case is about, rather than listing everything
 * and searching the page. `pageSize` is validated against PAGE_SIZE_OPTIONS and caps
 * at 100, so "ask for all of them" is not a thing the API offers — and a request over
 * the cap is a 400 whose body carries no `data`.
 */
function byName(name: string): string {
  const filters = JSON.stringify([{ field: "name", op: "eq", value: name }]);
  return `/roles?filters=${encodeURIComponent(filters)}`;
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

function inject(method: string, url: string, cookie: string) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
  });
}

function uploadCsv(cookie: string, csv: string) {
  const boundary = "----reportlyroleimport";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="roles.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n`,
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/roles/import`,
    headers: {
      cookie,
      "x-company-id": DEMO_COMPANY_ID,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

const HEADER = "Name,Permissions,System";

describe("role import/export", () => {
  it("creates a role carrying the permission keys named", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(
      admin,
      `${HEADER}\nLine supervisor,journal:read | journal:create | assets:read,no`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, updated: 0, problems: [] });

    const roles = (await inject("GET", byName("Line supervisor"), admin)).json();
    const role = roles.data[0];
    expect(role).toBeTruthy();
    expect(role.permissions).toContain("journal:create");
    expect(role.permissions).toContain("assets:read");
  });

  it("reports an unknown permission key and writes nothing", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(admin, `${HEADER}\nOddRole QA,journal:read | not:a-permission,no`);
    expect(res.json()).toMatchObject({
      created: 0,
      problems: [{ line: 2, message: '"not:a-permission" is not a permission' }],
    });
    const roles = (await inject("GET", byName("OddRole QA"), admin)).json();
    expect(roles.data).toHaveLength(0);
  });

  it("refuses to change a system role, writing nothing", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(
      admin,
      `${HEADER}\nFine QA,journal:read,no\nAdmin,journal:read,yes`,
    );
    expect(res.json().created).toBe(0);
    expect(res.json().problems[0].message).toContain("system role");
  });

  it("round-trips the export as a real spreadsheet", async () => {
    const admin = await superadmin();
    const exported = await inject("GET", "/roles/export", admin);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml");
    expect(exported.rawPayload.length).toBeGreaterThan(0);
  });
});
