// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for designations: the catalogue, the head-count, and the rule
// that a title somebody holds is retired rather than deleted.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const SUPERADMIN_USER_ID = "00000000-0000-0000-0000-000000000001";

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
    headers: { cookie },
    payload: payload as object,
  });
}

async function createDesignation(cookie: string, name: string): Promise<string> {
  const res = await inject("POST", "/designations", cookie, { name });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("designations", () => {
  it("creates one, and it starts with nobody holding it", async () => {
    const cookie = await superadmin();
    const res = await inject("POST", "/designations", cookie, { name: "Senior Engineer" });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: "Senior Engineer", status: "active", userCount: 0 });
  });

  it("enforces unique names", async () => {
    const cookie = await superadmin();
    await createDesignation(cookie, "Analyst");
    expect((await inject("POST", "/designations", cookie, { name: "Analyst" })).statusCode).toBe(
      409,
    );
  });

  it("counts the people holding it", async () => {
    const cookie = await superadmin();
    const id = await createDesignation(cookie, "Architect");

    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, { designationId: id });

    const row = (await inject("GET", `/designations/${id}`, cookie)).json();
    expect(row.userCount).toBe(1);

    // And the user shows its name, resolved through the catalogue.
    const user = (await inject("GET", `/users/${SUPERADMIN_USER_ID}`, cookie)).json();
    expect(user).toMatchObject({ designationId: id, designation: "Architect" });
  });

  it("renaming it corrects everybody holding it at once", async () => {
    const cookie = await superadmin();
    const id = await createDesignation(cookie, "Sr. Engineer");
    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, { designationId: id });

    await inject("PATCH", `/designations/${id}`, cookie, { name: "Senior Engineer" });

    // The user was never touched — they point at the row, they do not carry a copy.
    const user = (await inject("GET", `/users/${SUPERADMIN_USER_ID}`, cookie)).json();
    expect(user.designation).toBe("Senior Engineer");
  });

  it("offers only active designations to a user's profile", async () => {
    const cookie = await superadmin();
    const live = await createDesignation(cookie, "Current Title");
    const retired = await createDesignation(cookie, "Retired Title");

    await inject("PATCH", `/designations/${retired}`, cookie, { status: "inactive" });

    const options = (await inject("GET", "/designations/options", cookie)).json();
    const ids = options.map((o: { id: string }) => o.id);
    expect(ids).toContain(live);
    expect(ids).not.toContain(retired);

    // But the full list still shows it — retiring is not hiding.
    const all = (await inject("GET", "/designations", cookie)).json().data;
    expect(all.map((d: { id: string }) => d.id)).toContain(retired);
  });

  it("keeps a retired title on the people who already hold it", async () => {
    const cookie = await superadmin();
    const id = await createDesignation(cookie, "Legacy Title");
    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, { designationId: id });

    await inject("PATCH", `/designations/${id}`, cookie, { status: "inactive" });

    // Retiring a title must not quietly strip it from the staff who have it.
    const user = (await inject("GET", `/users/${SUPERADMIN_USER_ID}`, cookie)).json();
    expect(user.designation).toBe("Legacy Title");
  });

  it("refuses to delete one that somebody holds, and says how many", async () => {
    const cookie = await superadmin();
    const id = await createDesignation(cookie, "In Use");
    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, { designationId: id });

    const res = await inject("DELETE", `/designations/${id}`, cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/1 person holds this designation/i);
    expect(res.json().error.message).toMatch(/deactivate it instead/i);

    // The column is `on delete set null`, so a delete would have silently blanked
    // their job title. Confirm it did not.
    expect((await inject("GET", `/users/${SUPERADMIN_USER_ID}`, cookie)).json().designation).toBe(
      "In Use",
    );
  });

  it("deletes one nobody holds", async () => {
    const cookie = await superadmin();
    const id = await createDesignation(cookie, "Unused");

    expect((await inject("DELETE", `/designations/${id}`, cookie)).statusCode).toBe(204);
    expect((await inject("GET", `/designations/${id}`, cookie)).statusCode).toBe(404);
  });

  it("lets a user's designation be cleared", async () => {
    const cookie = await superadmin();
    const id = await createDesignation(cookie, "Temporary");
    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, { designationId: id });

    const cleared = await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, {
      designationId: null,
    });
    expect(cleared.json().designation).toBeNull();
    expect((await inject("GET", `/designations/${id}`, cookie)).json().userCount).toBe(0);
  });
});
