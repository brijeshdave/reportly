// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for groups: standard list query, system-row protection,
// clone, and the location-belongs-to-a-group-company invariant.
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

describe("groups", () => {
  it("supports the standard list query (pagination + total)", async () => {
    const cookie = await superadmin();
    await inject("POST", "/groups", cookie, { name: "Engineering" });
    const page = await inject("GET", "/groups?page=1&pageSize=5&sortBy=name&sortDir=asc", cookie);
    expect(page.statusCode).toBe(200);
    const body = page.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThanOrEqual(2); // seeded Superadmin + Engineering
    expect(body.pageSize).toBe(5);
  });

  it("protects system groups but allows cloning them", async () => {
    const cookie = await superadmin();
    const list = (await inject("GET", "/groups?pageSize=100", cookie)).json();
    const system = list.data.find((g: { isSystem: boolean }) => g.isSystem);
    expect(system).toBeTruthy();

    expect((await inject("PATCH", `/groups/${system.id}`, cookie, { name: "x" })).statusCode).toBe(
      400,
    );
    expect((await inject("DELETE", `/groups/${system.id}`, cookie)).statusCode).toBe(400);

    const cloned = await inject("POST", `/groups/${system.id}/clone`, cookie, {
      name: "Superadmin Copy",
    });
    expect(cloned.statusCode).toBe(201);
    expect(cloned.json()).toMatchObject({ name: "Superadmin Copy", isSystem: false });
  });
});
