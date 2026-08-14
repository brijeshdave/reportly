// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for locations: unique-per-company, protected Remote location.
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

describe("locations", () => {
  it("lists the seeded Remote and Headquarters locations", async () => {
    const cookie = await superadmin();
    const names = (await inject("GET", "/locations", cookie))
      .json()
      .map((l: { name: string }) => l.name);
    expect(names).toEqual(expect.arrayContaining(["Remote", "Headquarters"]));
  });

  it("enforces unique names per company", async () => {
    const cookie = await superadmin();
    expect((await inject("POST", "/locations", cookie, { name: "Branch" })).statusCode).toBe(201);
    expect((await inject("POST", "/locations", cookie, { name: "Branch" })).statusCode).toBe(409);
    expect((await inject("POST", "/locations", cookie, { name: "Remote" })).statusCode).toBe(409);
  });

  it("protects the Remote location and deletes others", async () => {
    const cookie = await superadmin();
    const list = (await inject("GET", "/locations", cookie)).json();
    const remote = list.find((l: { isRemote: boolean }) => l.isRemote);
    const hq = list.find((l: { name: string }) => l.name === "Headquarters");

    expect((await inject("DELETE", `/locations/${remote.id}`, cookie)).statusCode).toBe(400);
    expect((await inject("DELETE", `/locations/${hq.id}`, cookie)).statusCode).toBe(204);
  });
});
