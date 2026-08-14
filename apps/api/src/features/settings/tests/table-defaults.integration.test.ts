// Author: Brijesh Dave <https://github.com/brijeshdave>
// Rows-per-page resolution: the admin sets a system default, a user may override it
// in their own settings, and an explicit ?pageSize= from the table always wins.
// Also covers the pagination navigation metadata returned to clients.
import { PAGE_SIZE_OPTIONS } from "@reportly/shared";
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

const put = (url: string, cookie: string, payload: unknown) =>
  app.inject({
    method: "PUT",
    url: `${API_PREFIX}${url}`,
    headers: { cookie },
    payload: payload as object,
  });

/** Create enough groups that pagination has something to page through. */
async function seedGroups(cookie: string, count: number) {
  for (let i = 0; i < count; i++) {
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/groups`,
      headers: { cookie },
      payload: { name: `Group ${String(i).padStart(2, "0")}` },
    });
  }
}

describe("rows-per-page resolution", () => {
  it("offers exactly the agreed page-size options", () => {
    expect(PAGE_SIZE_OPTIONS).toEqual([5, 10, 20, 50, 100]);
  });

  it("uses the registry default when nothing is configured", async () => {
    const cookie = await superadmin();
    expect((await get("/groups", cookie)).json().pageSize).toBe(20);
  });

  it("honours the admin's system default", async () => {
    const cookie = await superadmin();
    expect(
      (await put("/settings/ui/tableDefaults", cookie, { value: { pageSize: 5 } })).statusCode,
    ).toBe(200);
    expect((await get("/groups", cookie)).json().pageSize).toBe(5);
  });

  it("lets a user override the system default for themselves", async () => {
    const cookie = await superadmin();
    await put("/settings/ui/tableDefaults", cookie, { value: { pageSize: 50 } });
    expect((await get("/groups", cookie)).json().pageSize).toBe(50);

    await put("/settings/me/ui/tableDefaults", cookie, { value: { pageSize: 10 } });
    expect((await get("/groups", cookie)).json().pageSize).toBe(10);
  });

  it("lets the table pick a page size explicitly, overriding both", async () => {
    const cookie = await superadmin();
    await put("/settings/me/ui/tableDefaults", cookie, { value: { pageSize: 50 } });
    expect((await get("/groups?pageSize=5", cookie)).json().pageSize).toBe(5);
  });

  it("rejects a page size outside the offered options", async () => {
    const cookie = await superadmin();
    expect((await get("/groups?pageSize=7", cookie)).statusCode).toBe(400);
    expect(
      (await put("/settings/ui/tableDefaults", cookie, { value: { pageSize: 7 } })).statusCode,
    ).toBe(400);
  });

  it("returns navigation metadata for the current page", async () => {
    const cookie = await superadmin();
    await seedGroups(cookie, 6); // + the seeded Superadmin group => 7 rows

    const first = (await get("/groups?pageSize=5&page=1", cookie)).json();
    expect(first).toMatchObject({
      page: 1,
      pageSize: 5,
      total: 7,
      totalPages: 2,
      firstPage: 1,
      lastPage: 2,
      previousPage: null,
      nextPage: 2,
      hasPrevious: false,
      hasNext: true,
    });

    const last = (await get("/groups?pageSize=5&page=2", cookie)).json();
    expect(last).toMatchObject({
      previousPage: 1,
      nextPage: null,
      hasPrevious: true,
      hasNext: false,
    });
  });
});
