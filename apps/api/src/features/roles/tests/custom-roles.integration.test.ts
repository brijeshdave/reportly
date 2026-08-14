// Author: Brijesh Dave <https://github.com/brijeshdave>
// Custom roles are editable; seeded system roles are not, because editing one
// would silently re-grant every group that holds it. `group_roles` cascades on
// delete, so deleting a held role is refused rather than quietly stripping it.
import { PERMISSIONS } from "@reportly/shared";
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

const systemRole = async (cookie: string, name: string) =>
  (await inject("GET", "/roles", cookie))
    .json()
    .data.find((role: { name: string }) => role.name === name);

const createRole = (cookie: string, name: string, permissions: string[] = []) =>
  inject("POST", "/roles", cookie, { name, permissions });

describe("creating", () => {
  it("creates a custom role with the permissions asked for", async () => {
    const cookie = await superadmin();
    const res = await createRole(cookie, "Auditor", [
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.LOGS_VIEW,
    ]);

    expect(res.statusCode).toBe(201);
    const role = res.json();
    expect(role.isSystem).toBe(false);
    expect(role.permissions.sort()).toEqual([PERMISSIONS.AUDIT_VIEW, PERMISSIONS.LOGS_VIEW].sort());
  });

  it("creates a role with no permissions at all", async () => {
    const cookie = await superadmin();
    expect((await createRole(cookie, "Empty")).json().permissions).toEqual([]);
  });

  it("refuses a duplicate name", async () => {
    const cookie = await superadmin();
    await createRole(cookie, "Auditor");
    expect((await createRole(cookie, "Auditor")).statusCode).toBe(409);
  });

  it("refuses a name a system role already holds", async () => {
    const cookie = await superadmin();
    expect((await createRole(cookie, "Superadmin")).statusCode).toBe(409);
  });
});

describe("editing", () => {
  it("renames a custom role", async () => {
    const cookie = await superadmin();
    const role = (await createRole(cookie, "Auditor")).json();

    const res = await inject("PATCH", `/roles/${role.id}`, cookie, { name: "Compliance" });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Compliance");
  });

  it("replaces the permission set rather than merging it", async () => {
    const cookie = await superadmin();
    const role = (
      await createRole(cookie, "Auditor", [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.LOGS_VIEW])
    ).json();

    const res = await inject("PATCH", `/roles/${role.id}`, cookie, {
      permissions: [PERMISSIONS.USERS_READ],
    });
    expect(res.json().permissions).toEqual([PERMISSIONS.USERS_READ]);
  });

  it("leaves permissions alone when only the name changes", async () => {
    const cookie = await superadmin();
    const role = (await createRole(cookie, "Auditor", [PERMISSIONS.AUDIT_VIEW])).json();

    const res = await inject("PATCH", `/roles/${role.id}`, cookie, { name: "Compliance" });
    expect(res.json().permissions).toEqual([PERMISSIONS.AUDIT_VIEW]);
  });

  it("refuses to edit a system role", async () => {
    const cookie = await superadmin();
    const role = await systemRole(cookie, "Member");

    const res = await inject("PATCH", `/roles/${role.id}`, cookie, { name: "Member 2" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("System roles are immutable");
  });

  it("records the change in history", async () => {
    const cookie = await superadmin();
    const role = (await createRole(cookie, "Auditor")).json();
    await inject("PATCH", `/roles/${role.id}`, cookie, { name: "Compliance" });

    const history = (await inject("GET", `/history/roles/${role.id}`, cookie)).json();
    expect(history.data.some((entry: { field: string }) => entry.field === "name")).toBe(true);
  });
});

describe("cloning", () => {
  it("copies a system role's permissions into an editable one", async () => {
    const cookie = await superadmin();
    const source = await systemRole(cookie, "Manager");

    const res = await inject("POST", `/roles/${source.id}/clone`, cookie, { name: "Manager copy" });
    expect(res.statusCode).toBe(201);

    const clone = res.json();
    expect(clone.isSystem).toBe(false);
    expect(clone.permissions.sort()).toEqual([...source.permissions].sort());

    // The copy is editable, which is the whole point of cloning.
    expect((await inject("PATCH", `/roles/${clone.id}`, cookie, { name: "Ops" })).statusCode).toBe(
      200,
    );
  });

  it("leaves the source untouched", async () => {
    const cookie = await superadmin();
    const source = await systemRole(cookie, "Member");
    await inject("POST", `/roles/${source.id}/clone`, cookie, { name: "Member copy" });

    const after = await systemRole(cookie, "Member");
    expect(after.permissions.sort()).toEqual([...source.permissions].sort());
  });
});

describe("deleting", () => {
  it("deletes a custom role nobody holds", async () => {
    const cookie = await superadmin();
    const role = (await createRole(cookie, "Auditor")).json();

    expect((await inject("DELETE", `/roles/${role.id}`, cookie)).statusCode).toBe(204);
    expect((await inject("GET", `/roles/${role.id}`, cookie)).statusCode).toBe(404);
  });

  it("refuses to delete a system role", async () => {
    const cookie = await superadmin();
    const role = await systemRole(cookie, "Member");
    expect((await inject("DELETE", `/roles/${role.id}`, cookie)).statusCode).toBe(400);
  });

  it("refuses while a group holds it, and names the group", async () => {
    const cookie = await superadmin();
    const role = (await createRole(cookie, "Auditor", [PERMISSIONS.AUDIT_VIEW])).json();
    const group = (await inject("POST", "/groups", cookie, { name: "Compliance" })).json();
    await inject("PUT", `/groups/${group.id}/roles`, cookie, { ids: [role.id] });

    const res = await inject("DELETE", `/roles/${role.id}`, cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.groups).toEqual([{ id: group.id, name: "Compliance" }]);

    // The refusal changed nothing.
    const assignments = (await inject("GET", `/groups/${group.id}/assignments`, cookie)).json();
    expect(assignments.roles).toEqual([role.id]);
  });

  it("lists the groups that hold it", async () => {
    const cookie = await superadmin();
    const role = (await createRole(cookie, "Auditor")).json();
    const group = (await inject("POST", "/groups", cookie, { name: "Compliance" })).json();
    await inject("PUT", `/groups/${group.id}/roles`, cookie, { ids: [role.id] });

    const { groups } = (await inject("GET", `/roles/${role.id}/references`, cookie)).json();
    expect(groups).toEqual([{ id: group.id, name: "Compliance" }]);
  });
});
