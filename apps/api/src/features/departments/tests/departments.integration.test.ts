// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for departments: per-company uniqueness, the tree rules
// (nesting, cycle refusal, guarded delete), and membership with the HOD flag.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
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
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

async function createDept(cookie: string, name: string, parentId?: string): Promise<string> {
  const res = await inject("POST", "/departments", cookie, { name, parentId });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("departments", () => {
  it("creates a nested tree and lists it flat with counts", async () => {
    const cookie = await superadmin();
    const parent = await createDept(cookie, "Research");
    const child = await createDept(cookie, "Research Labs", parent);

    const list = (await inject("GET", "/departments", cookie)).json();
    const byId = new Map(list.map((d: { id: string }) => [d.id, d]));
    expect(byId.get(parent)).toMatchObject({ name: "Research", parentId: null, memberCount: 0 });
    expect(byId.get(child)).toMatchObject({ name: "Research Labs", parentId: parent });
  });

  it("enforces unique names per company", async () => {
    const cookie = await superadmin();
    await createDept(cookie, "Marketing");
    expect((await inject("POST", "/departments", cookie, { name: "Marketing" })).statusCode).toBe(
      409,
    );
  });

  it("rejects a parent that would create a cycle", async () => {
    const cookie = await superadmin();
    const parent = await createDept(cookie, "Parent");
    const child = await createDept(cookie, "Child", parent);

    // self-parent
    expect(
      (await inject("PATCH", `/departments/${parent}`, cookie, { parentId: parent })).statusCode,
    ).toBe(400);
    // parent under its own descendant
    expect(
      (await inject("PATCH", `/departments/${parent}`, cookie, { parentId: child })).statusCode,
    ).toBe(400);
    // legitimate re-root back to top level
    expect(
      (await inject("PATCH", `/departments/${child}`, cookie, { parentId: null })).statusCode,
    ).toBe(200);
  });

  it("guards deletion while a department has children or members", async () => {
    const cookie = await superadmin();
    const parent = await createDept(cookie, "Ops");
    const child = await createDept(cookie, "Support", parent);

    // has a child -> 409
    expect((await inject("DELETE", `/departments/${parent}`, cookie)).statusCode).toBe(409);

    // give the leaf a member -> 409
    await inject("PUT", `/departments/${child}/members`, cookie, {
      members: [{ userId: SUPERADMIN_USER_ID, rank: "hod" }],
    });
    expect((await inject("DELETE", `/departments/${child}`, cookie)).statusCode).toBe(409);

    // clear members, then the leaf deletes, then the parent
    await inject("PUT", `/departments/${child}/members`, cookie, { members: [] });
    expect((await inject("DELETE", `/departments/${child}`, cookie)).statusCode).toBe(204);
    expect((await inject("DELETE", `/departments/${parent}`, cookie)).statusCode).toBe(204);
  });

  it("sets members with a rank and reflects it in counts and the user's list", async () => {
    const cookie = await superadmin();
    const dept = await createDept(cookie, "Finance");

    await inject("PUT", `/departments/${dept}/members`, cookie, {
      members: [{ userId: SUPERADMIN_USER_ID, rank: "hod" }],
    });

    const members = (await inject("GET", `/departments/${dept}/members`, cookie)).json();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: SUPERADMIN_USER_ID, rank: "hod" });

    const node = (await inject("GET", "/departments", cookie))
      .json()
      .find((d: { id: string }) => d.id === dept);
    expect(node).toMatchObject({ memberCount: 1, hodCount: 1 });

    const mine = (await inject("GET", `/users/${SUPERADMIN_USER_ID}/departments`, cookie)).json();
    expect(mine).toEqual([
      expect.objectContaining({ departmentId: dept, name: "Finance", rank: "hod" }),
    ]);
  });

  it("rejects a member that names an unknown user", async () => {
    const cookie = await superadmin();
    const dept = await createDept(cookie, "Legal");
    const res = await inject("PUT", `/departments/${dept}/members`, cookie, {
      members: [{ userId: "no-such-user", rank: "member" }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("stores an employee id on a user, and clears it", async () => {
    // Designation is a managed catalogue now (see the designations suite); this
    // covers the plain employee-id field that sits beside it.
    const cookie = await superadmin();
    const res = await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, {
      employeeId: "EMP-001",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ employeeId: "EMP-001" });

    // a blank value clears the field
    const cleared = await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, {
      employeeId: "  ",
    });
    expect(cleared.json().employeeId).toBeNull();
  });
});
