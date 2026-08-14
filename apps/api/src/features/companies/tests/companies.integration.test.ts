// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for companies CRUD: auto-Remote location, access control.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

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

async function member(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email: "member@acme.test", password: "S3curePass!23", name: "Member" },
  });
  return cookieFrom(res);
}

function inject(
  method: string,
  url: string,
  cookie: string,
  payload?: unknown,
  companyId?: string,
) {
  const headers: Record<string, string> = { cookie };
  if (companyId) headers["x-company-id"] = companyId;
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers,
    payload: payload as object,
  });
}

describe("companies", () => {
  it("creates a company with an auto Remote location", async () => {
    const cookie = await superadmin();
    const created = await inject("POST", "/companies", cookie, { name: "Globex" });
    expect(created.statusCode).toBe(201);
    const company = created.json();
    expect(company.name).toBe("Globex");

    const locs = await inject("GET", "/locations", cookie, undefined, company.id);
    expect(locs.statusCode).toBe(200);
    const remote = locs.json().find((l: { name: string }) => l.name === "Remote");
    expect(remote).toMatchObject({ isRemote: true });
  });

  it("lists, updates, and deletes a company", async () => {
    const cookie = await superadmin();
    const id = (await inject("POST", "/companies", cookie, { name: "Initech" })).json().id;

    const list = await inject("GET", "/companies", cookie);
    expect(list.json().data.map((c: { name: string }) => c.name)).toEqual(
      expect.arrayContaining(["Acme Corp", "Initech"]),
    );

    const patched = await inject("PATCH", `/companies/${id}`, cookie, { name: "Initech 2" });
    expect(patched.json().name).toBe("Initech 2");

    expect((await inject("DELETE", `/companies/${id}`, cookie)).statusCode).toBe(204);
    expect((await inject("GET", `/companies/${id}`, cookie)).statusCode).toBe(404);
  });

  it("supports the standard list query and keeps the access scope", async () => {
    const cookie = await superadmin();
    await inject("POST", "/companies", cookie, { name: "Initech" });

    const page = await inject(
      "GET",
      "/companies?page=1&pageSize=5&sortBy=name&sortDir=desc",
      cookie,
    );
    expect(page.statusCode).toBe(200);
    const body = page.json();
    expect(body.pageSize).toBe(5);
    expect(body.total).toBeGreaterThanOrEqual(2);
    // Sorting is applied by the server, not the client.
    expect(body.data[0].name).toBe("Initech");
  });

  it("denies company creation to a user without permission", async () => {
    const cookie = await member();
    expect((await inject("POST", "/companies", cookie, { name: "Nope" })).statusCode).toBe(403);
    // A member with no groups sees no companies.
    const list = (await inject("GET", "/companies", cookie)).json();
    expect(list.data).toEqual([]);
    expect(list.total).toBe(0);
  });
});
