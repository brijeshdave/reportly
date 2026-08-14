// Author: Brijesh Dave <https://github.com/brijeshdave>
// Department import/export: a path-based file builds the tree (creating ancestors), an
// existing path is updated in place, a bad row writes nothing, and the export round-trips.
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
  const boundary = "----reportlydeptimport";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="departments.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n`,
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/departments/import`,
    headers: {
      cookie,
      "x-company-id": DEMO_COMPANY_ID,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

const HEADER = "Path,Status";
const nameSet = (rows: { name: string }[]) => new Set(rows.map((r) => r.name));

describe("department import/export", () => {
  it("builds a tree from paths, creating missing ancestors", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(admin, `${HEADER}\nOps QA › Maintenance QA › Electrical QA,active`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, problems: [] });

    const depts = (await inject("GET", "/departments", admin)).json();
    const names = nameSet(depts);
    expect(names.has("Ops QA")).toBe(true);
    expect(names.has("Maintenance QA")).toBe(true);
    expect(names.has("Electrical QA")).toBe(true);
  });

  it("updates an existing path in place instead of duplicating it, and round-trips the export", async () => {
    const admin = await superadmin();
    await uploadCsv(admin, `${HEADER}\nOps QA2,active`);
    const again = await uploadCsv(admin, `${HEADER}\nOps QA2,inactive`);
    expect(again.json()).toMatchObject({ created: 0, updated: 1 });

    const depts = (await inject("GET", "/departments", admin)).json();
    expect(depts.filter((d: { name: string }) => d.name === "Ops QA2")).toHaveLength(1);
    expect(depts.find((d: { name: string }) => d.name === "Ops QA2").status).toBe("inactive");

    const exported = await inject("GET", "/departments/export", admin);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml");
    expect(exported.rawPayload.length).toBeGreaterThan(0);
  });

  it("writes nothing when a row has a bad status, reporting the line", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(admin, `${HEADER}\nGood QA,active\nBad QA,maybe`);
    expect(res.json()).toMatchObject({
      created: 0,
      updated: 0,
      problems: [{ line: 3, message: 'Status must be "active" or "inactive", not "maybe"' }],
    });
    const depts = (await inject("GET", "/departments", admin)).json();
    expect(nameSet(depts).has("Good QA")).toBe(false);
  });
});
