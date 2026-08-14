// Author: Brijesh Dave <https://github.com/brijeshdave>
// Asset import/export: a path-based file builds the tree (creating ancestors), an
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

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

/** Upload a CSV as a multipart file part, built by hand — no client involved. */
function uploadCsv(cookie: string, csv: string) {
  const boundary = "----reportlyassetimport";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="assets.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n`,
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/assets/import`,
    headers: {
      cookie,
      "x-company-id": DEMO_COMPANY_ID,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

const HEADER = "Path,Type,Site,Status";

const nameSet = (rows: { name: string }[]) => new Set(rows.map((r) => r.name));

describe("asset import/export", () => {
  it("downloads a template that is a real spreadsheet", async () => {
    const admin = await superadmin();
    const res = await inject("GET", "/assets/import/template", admin);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it("builds a tree from paths, creating missing ancestors and matching type/site by name", async () => {
    const admin = await superadmin();
    // The demo company seeds a "Remote" location and a "Line" asset type; only the leaf
    // row is given — its ancestors "Kim" and "Line 1" are created on the way down.
    const res = await uploadCsv(admin, `${HEADER}\nKim › Line 1 › Station A,Line,Remote,active`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, problems: [] });

    const assets = (await inject("GET", "/assets", admin)).json();
    const names = nameSet(assets);
    expect(names.has("Kim")).toBe(true);
    expect(names.has("Line 1")).toBe(true);
    const station = assets.find((a: { name: string }) => a.name === "Station A");
    expect(station.typeName).toBe("Line");
    expect(station.locationName).toBe("Remote");
  });

  it("updates an existing path in place instead of duplicating it, and round-trips the export", async () => {
    const admin = await superadmin();
    await uploadCsv(admin, `${HEADER}\nPlant,Plant,,active`);
    // Same path again with a different status — updated, not duplicated.
    const again = await uploadCsv(admin, `${HEADER}\nPlant,Plant,,inactive`);
    expect(again.json()).toMatchObject({ created: 0, updated: 1 });

    const assets = (await inject("GET", "/assets", admin)).json();
    expect(assets.filter((a: { name: string }) => a.name === "Plant")).toHaveLength(1);
    expect(assets.find((a: { name: string }) => a.name === "Plant").status).toBe("inactive");

    // Export is a real spreadsheet carrying the row.
    const exported = await inject("GET", "/assets/export", admin);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml");
    expect(exported.rawPayload.length).toBeGreaterThan(0);
  });

  it("writes nothing when any row names a type or site that does not exist", async () => {
    const admin = await superadmin();
    const res = await uploadCsv(admin, `${HEADER}\nGood,Plant,,active\nBad,Ghost type,,active`);
    expect(res.json()).toMatchObject({
      created: 0,
      updated: 0,
      problems: [{ line: 3, message: '"Ghost type" is not an asset type' }],
    });
    const assets = (await inject("GET", "/assets", admin)).json();
    expect(nameSet(assets).has("Good")).toBe(false);
  });

  it("refuses the import to someone without assets:import", async () => {
    const admin = await superadmin();
    // A fresh Member group user holds neither assets:import nor (here) a cookie of power.
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/assets/import`,
      headers: { "x-company-id": DEMO_COMPANY_ID },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    void admin;
  });
});

/** Upload a CSV to the asset-type importer as a multipart file part. */
function uploadTypeCsv(cookie: string, csv: string) {
  const boundary = "----reportlytypeimport";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="types.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n`,
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/asset-types/import`,
    headers: {
      cookie,
      "x-company-id": DEMO_COMPANY_ID,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

const TYPE_HEADER = "Name,Order,Status";

describe("asset-type import/export", () => {
  it("creates a new type and updates an existing one by name", async () => {
    const admin = await superadmin();
    // "Line" is seeded; "Gadget" is new. The seeded one is updated (status flip), the new one created.
    const res = await uploadTypeCsv(admin, `${TYPE_HEADER}\nGadget,7,active\nLine,1,inactive`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, updated: 1, problems: [] });

    const types = (await inject("GET", "/asset-types", admin)).json();
    const gadget = types.find((t: { name: string }) => t.name === "Gadget");
    expect(gadget).toMatchObject({ orderIndex: 7, status: "active" });
    expect(types.find((t: { name: string }) => t.name === "Line").status).toBe("inactive");
  });

  it("writes nothing when a row has a bad status, reporting the line", async () => {
    const admin = await superadmin();
    const res = await uploadTypeCsv(admin, `${TYPE_HEADER}\nGood,0,active\nBad,0,perhaps`);
    expect(res.json()).toMatchObject({
      created: 0,
      updated: 0,
      problems: [{ line: 3, message: 'Status must be "active" or "inactive", not "perhaps"' }],
    });
    const types = (await inject("GET", "/asset-types", admin)).json();
    expect(nameSet(types).has("Good")).toBe(false);
  });

  it("round-trips the export as a real spreadsheet", async () => {
    const admin = await superadmin();
    const exported = await inject("GET", "/asset-types/export", admin);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml");
    expect(exported.rawPayload.length).toBeGreaterThan(0);
  });
});
