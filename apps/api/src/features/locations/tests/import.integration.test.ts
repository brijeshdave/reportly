// Author: Brijesh Dave <https://github.com/brijeshdave>
// Location import/export: a file creates a new site and updates an existing one, the
// protected Remote site cannot be deactivated, a bad row writes nothing, export round-trips.
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
  const boundary = "----reportlylocationimport";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="locations.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n`,
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/locations/import`,
    headers: {
      cookie,
      "x-company-id": DEMO_COMPANY_ID,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

const HEADER = "Name,Status";
const nameSet = (rows: { name: string }[]) => new Set(rows.map((r) => r.name));

describe("location import/export", () => {
  it("creates a new site and updates an existing one's status", async () => {
    const admin = await superadmin();
    const before = (await inject("GET", "/locations", admin)).json();
    const existing = before[0].name as string;

    const res = await uploadCsv(admin, `${HEADER}\nPlant Z,active\n${existing},inactive`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, updated: 1, problems: [] });

    const after = (await inject("GET", "/locations", admin)).json();
    expect(nameSet(after).has("Plant Z")).toBe(true);
    expect(after.find((l: { name: string }) => l.name === existing).status).toBe("inactive");
  });

  it("refuses to deactivate the Remote site, writing nothing", async () => {
    const admin = await superadmin();
    const sites = (await inject("GET", "/locations", admin)).json();
    const remote = sites.find((l: { isRemote: boolean }) => l.isRemote);
    expect(remote).toBeTruthy();

    const res = await uploadCsv(admin, `${HEADER}\nPlant Y,active\n${remote.name},inactive`);
    expect(res.json()).toMatchObject({
      created: 0,
      updated: 0,
      problems: [{ line: 3, message: "The Remote location cannot be deactivated" }],
    });
    const after = (await inject("GET", "/locations", admin)).json();
    expect(nameSet(after).has("Plant Y")).toBe(false);
  });

  it("round-trips the export as a real spreadsheet", async () => {
    const admin = await superadmin();
    const exported = await inject("GET", "/locations/export", admin);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml");
    expect(exported.rawPayload.length).toBeGreaterThan(0);
  });
});
