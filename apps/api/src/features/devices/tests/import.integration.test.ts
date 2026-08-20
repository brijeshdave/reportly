// Author: Brijesh Dave <https://github.com/brijeshdave>
// Bulk device import over real HTTP. The parser is unit-tested on its own; this
// covers what only the wired-up route can: the template downloads, a good CSV
// writes rows, a name that matches nothing is refused with its line — and the
// import is all-or-nothing, so a file that is half wrong leaves no half-registered
// devices behind. And it is gated on its own permission, separate from create.
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
  return cookieFrom(
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/email`,
      payload: { email: "admin@reportly.local", password },
    }),
  );
}

/** Upload a CSV as a multipart file part, built by hand — no client involved. */
function uploadCsv(cookie: string, csv: string, departmentId?: string) {
  const boundary = "----reportlydevimport";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="devices.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n`,
    ),
    Buffer.from(csv),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/devices/import${departmentId ? `?departmentId=${departmentId}` : ""}`,
    headers: {
      cookie,
      "x-company-id": DEMO_COMPANY_ID,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}

const HEADER = "Name,Identifier,Asset tag,Type,Site,Lives at (asset),Status";

async function engineeringId(admin: string): Promise<string> {
  const tree = (await inject("GET", "/departments", admin)).json();
  const flat = (
    nodes: { id: string; name: string; children?: unknown[] }[],
  ): { id: string; name: string }[] =>
    nodes.flatMap((n) => [n, ...flat((n.children ?? []) as never)]);
  return flat(tree).find((d) => d.name === "Engineering")!.id;
}

describe("device import", () => {
  it("downloads a template that is a real spreadsheet", async () => {
    const admin = await superadmin();
    const res = await inject("GET", "/devices/import/template", admin);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it("creates the rows of a good file, matching names to ids", async () => {
    const admin = await superadmin();
    // The demo company seeds an Engineering department and a Remote location.
    const dept = await engineeringId(admin);
    const res = await uploadCsv(admin, `${HEADER}\nPump 1,SN-1,AT-1,,Remote,,active`, dept);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ created: 1, problems: [] });

    const list = (await inject("GET", "/devices", admin)).json();
    const pump = list.data.find((d: { name: string }) => d.name === "Pump 1");
    expect(pump).toBeTruthy();
    expect(pump.assetTag).toBe("AT-1");
    expect(pump.departmentName).toBe("Engineering");
  });

  it("writes nothing when any row names something that does not exist", async () => {
    const admin = await superadmin();
    const dept = await engineeringId(admin);
    // "Ghost type" is not a device type in Engineering, so the second row is rejected
    // and — all or nothing — the good first row is not written either.
    const res = await uploadCsv(
      admin,
      `${HEADER}\nGood pump,,,,Remote,,\nBad pump,,,Ghost type,Remote,,`,
      dept,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(0);
    expect(body.problems).toEqual([
      { line: 3, message: '"Ghost type" is not a device type in Engineering' },
    ]);

    const list = (await inject("GET", "/devices", admin)).json();
    expect(list.data.find((d: { name: string }) => d.name === "Good pump")).toBeUndefined();
  });

  it("requires a site on every row, but leaves the asset optional", async () => {
    const admin = await superadmin();
    const dept = await engineeringId(admin);

    // No site -> rejected. Site but no asset -> fine.
    const bad = await uploadCsv(admin, `${HEADER}\nNo site pump,,,,,,`, dept);
    expect(bad.json()).toEqual({
      created: 0,
      problems: [{ line: 2, message: "Site is required" }],
    });

    const ok = await uploadCsv(admin, `${HEADER}\nPlaced pump,,,,Remote,,`, dept);
    expect(ok.json()).toEqual({ created: 1, problems: [] });
  });

  it("is gated on devices:import — a plain creator cannot", async () => {
    const admin = await superadmin();

    // A group holding only the Assets & devices viewer role (read, no import), and a person in it.
    const group = (await inject("POST", "/groups", admin, { name: "Viewers" })).json();
    const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
    const viewer = roles.find((r: { name: string }) => r.name === "Assets & devices viewer");
    await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [viewer.id] });

    const created = await inject("POST", "/users", admin, {
      name: "Vic Viewer",
      email: "vic@reportly.test",
      username: "vic",
      password: TEMP_PW,
    });
    const userId = created.json().id;
    await inject("PUT", `/groups/${group.id}/users`, admin, { ids: [userId] });
    await inject("PUT", `/users/${userId}/companies`, admin, { ids: [DEMO_COMPANY_ID] });

    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/username`,
      payload: { username: "vic", password: TEMP_PW },
    });
    const gated = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/username`,
      payload: { username: "vic", password: TEMP_PW },
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
      payload: { username: "vic", password: OWN_PW },
    });

    const res = await uploadCsv(cookieFrom(clean), `${HEADER}\nPump 1,,,,,,,`);
    expect(res.statusCode).toBe(403);
  });

  it("exports the register as a real spreadsheet", async () => {
    const cookie = await superadmin();
    const res = await inject("GET", "/devices/export", cookie);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });
});
