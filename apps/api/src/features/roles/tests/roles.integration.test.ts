// Author: Brijesh Dave <https://github.com/brijeshdave>
// Roles back the read-only permissions matrix, so the API must return each role's
// full permission set and must refuse callers without roles:read.
import { PERMISSIONS } from "@reportly/shared";
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

const get = (url: string, cookie: string) =>
  app.inject({ method: "GET", url: `${API_PREFIX}${url}`, headers: { cookie } });

describe("roles API", () => {
  it("lists the seeded roles with their permissions", async () => {
    const cookie = await superadmin();
    // Ask for the one role this is about rather than assuming it lands on the
    // first page: there are thirty seeded roles now that every area has three
    // tiers, and the default page holds twenty.
    const filters = encodeURIComponent(
      JSON.stringify([{ field: "name", op: "eq", value: "Superadmin" }]),
    );
    const res = await get(`/roles?filters=${filters}`, cookie);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);

    const superadminRole = body.data[0];
    expect(superadminRole.name).toBe("Superadmin");
    expect(superadminRole.isSystem).toBe(true);
    expect(superadminRole.permissions).toContain(PERMISSIONS.SETTINGS_MANAGE);
  });

  it("returns permissions sorted, so the matrix column order is stable", async () => {
    const cookie = await superadmin();
    const body = get("/roles", cookie);
    const role = (await body).json().data[0];
    expect(role.permissions).toEqual([...role.permissions].sort());
  });

  it("supports the standard list query", async () => {
    const cookie = await superadmin();
    const res = await get("/roles?page=1&pageSize=5&sortBy=name&sortDir=desc", cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().pageSize).toBe(5);
  });

  it("gets a single role by id", async () => {
    const cookie = await superadmin();
    const first = (await get("/roles", cookie)).json().data[0];

    const res = await get(`/roles/${first.id}`, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: first.id, name: first.name });
  });

  it("404s for an unknown role", async () => {
    const cookie = await superadmin();
    const res = await get("/roles/11111111-2222-3333-4444-555555555555", cookie);
    expect(res.statusCode).toBe(404);
  });

  it("denies a caller without a session", async () => {
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/roles` });
    expect(res.statusCode).toBe(401);
  });
});
