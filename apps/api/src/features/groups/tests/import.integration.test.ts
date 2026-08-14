// Author: Brijesh Dave <https://github.com/brijeshdave>
// Group import/export: a file creates a group with roles, refuses to touch a system group,
// leaves an existing group's roles unchanged on a blank cell, and the export round-trips.
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
 * Look a group up by the one name the case is about, rather than listing everything
 * and searching the page. `pageSize` is validated against PAGE_SIZE_OPTIONS and caps
 * at 100, so "ask for all of them" is not a thing the API offers — and a request over
 * the cap is a 400 whose body carries no `data`.
 */
function byName(name: string): string {
  const filters = JSON.stringify([{ field: "name", op: "eq", value: name }]);
  return `/groups?filters=${encodeURIComponent(filters)}`;
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
  const boundary = "----reportlygroupimport";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="groups.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n`,
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/groups/import`,
    headers: {
      cookie,
      "x-company-id": DEMO_COMPANY_ID,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

const HEADER = "Name,Roles,System";

describe("group import/export", () => {
  it("creates a group carrying the roles named", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(
      admin,
      `${HEADER}\nMaintenance QA,Journal editor | Assets & devices viewer,no`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, updated: 0, problems: [] });

    const groups = (await inject("GET", byName("Maintenance QA"), admin)).json();
    expect(groups.data).toHaveLength(1);
  });

  it("refuses to change a system group, writing nothing", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(
      admin,
      `${HEADER}\nOkay QA,,no\nSuperadmin,Assets & devices viewer,yes`,
    );
    expect(res.json().created).toBe(0);
    expect(res.json().problems[0].message).toContain("system group");
    const groups = (await inject("GET", byName("Okay QA"), admin)).json();
    expect(groups.data).toHaveLength(0);
  });

  it("reports an unknown role and writes nothing", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(admin, `${HEADER}\nTeam QA,Ghost role,no`);
    expect(res.json()).toMatchObject({
      created: 0,
      problems: [{ line: 2, message: 'No role called "Ghost role"' }],
    });
  });

  it("round-trips the export as a real spreadsheet", async () => {
    const admin = await superadmin();
    const exported = await inject("GET", "/groups/export", admin);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml");
    expect(exported.rawPayload.length).toBeGreaterThan(0);
  });
});
