// Author: Brijesh Dave <https://github.com/brijeshdave>
// Journal-vocabulary import/export: one file, four kinds. A new severity and a per-
// department category are created, an unknown department writes nothing, export round-trips.
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
  const boundary = "----reportlyvocabimport";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="vocab.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n`,
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/journal-config/import`,
    headers: {
      cookie,
      "x-company-id": DEMO_COMPANY_ID,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

const HEADER = "Kind,Department,Name,Group,Terminal,Color,Description,Status";

describe("journal-vocabulary import/export", () => {
  it("creates a severity and a category, and updates an existing severity by name", async () => {
    const admin = await superadmin();
    const depts = (await inject("GET", "/departments", admin)).json();
    const dept = depts[0].name as string;
    const before = (await inject("GET", "/severities", admin)).json();
    const existingSeverity = before[0].name as string;

    const res = await uploadCsv(
      admin,
      `${HEADER}\n` +
        `severity,,Catastrophic,,,,,active\n` +
        `severity,,${existingSeverity},,,,,active\n` +
        `category,${dept},Breakdown QA,,,,Unplanned stop,active`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 2, updated: 1, problems: [] });

    const severities = (await inject("GET", "/severities", admin)).json();
    // Created by name, and the existing one matched by name rather than duplicated.
    expect(severities.filter((s: { name: string }) => s.name === existingSeverity)).toHaveLength(1);
    expect(severities.some((s: { name: string }) => s.name === "Catastrophic")).toBe(true);

    const cats = (await inject("GET", `/categories`, admin)).json();
    expect(cats.some((c: { name: string }) => c.name === "Breakdown QA")).toBe(true);
  });

  it("writes nothing when a category names an unknown department", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(
      admin,
      `${HEADER}\nseverity,,Fine QA,,,3,,,active\ncategory,No Such Dept,Whatever,,,,,,active`,
    );
    expect(res.json()).toMatchObject({
      created: 0,
      updated: 0,
      problems: [{ line: 3, message: 'No department called "No Such Dept"' }],
    });
    const severities = (await inject("GET", "/severities", admin)).json();
    expect(severities.some((s: { name: string }) => s.name === "Fine QA")).toBe(false);
  });

  it("round-trips the export as a real spreadsheet", async () => {
    const admin = await superadmin();
    const exported = await inject("GET", "/journal-config/export", admin);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml");
    expect(exported.rawPayload.length).toBeGreaterThan(0);
  });
});
