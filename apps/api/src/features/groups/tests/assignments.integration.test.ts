// Author: Brijesh Dave <https://github.com/brijeshdave>
// The assignment endpoints replace the whole set. Without a way to read the
// current one, an editor saving the Roles tab would silently wipe the group's
// members — so these reads exist, and must round-trip exactly what was written.
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

describe("group assignments", () => {
  it("starts empty for a new group", async () => {
    const cookie = await superadmin();
    const group = (await inject("POST", "/groups", cookie, { name: "Support" })).json();

    const res = await inject("GET", `/groups/${group.id}/assignments`, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ users: [], roles: [] });
  });

  it("round-trips exactly what was assigned", async () => {
    const cookie = await superadmin();
    const group = (await inject("POST", "/groups", cookie, { name: "Support" })).json();
    const role = (await inject("GET", "/roles?pageSize=100", cookie)).json().data[0];

    await inject("PUT", `/groups/${group.id}/roles`, cookie, { ids: [role.id] });

    const assignments = (await inject("GET", `/groups/${group.id}/assignments`, cookie)).json();
    expect(assignments.roles).toEqual([role.id]);
    expect(assignments.users).toEqual([]);
  });

  it("reflects a replaced set rather than accumulating", async () => {
    const cookie = await superadmin();
    const group = (await inject("POST", "/groups", cookie, { name: "Support" })).json();
    const roles = (await inject("GET", "/roles?pageSize=100", cookie)).json().data;

    await inject("PUT", `/groups/${group.id}/roles`, cookie, { ids: [roles[0].id, roles[1].id] });
    await inject("PUT", `/groups/${group.id}/roles`, cookie, { ids: [roles[1].id] });

    const assignments = (await inject("GET", `/groups/${group.id}/assignments`, cookie)).json();
    expect(assignments.roles).toEqual([roles[1].id]);
  });

  it("404s for an unknown group", async () => {
    const cookie = await superadmin();
    const res = await inject(
      "GET",
      "/groups/11111111-2222-3333-4444-555555555555/assignments",
      cookie,
    );
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /users/:id/groups", () => {
  it("lists the groups a user was added to", async () => {
    const cookie = await superadmin();
    const group = (await inject("POST", "/groups", cookie, { name: "Support" })).json();
    const user = (
      await inject("POST", "/users/invite", cookie, { email: "member@acme.test", name: "Member" })
    ).json();

    expect((await inject("GET", `/users/${user.id}/groups`, cookie)).json()).toEqual([]);

    await inject("PUT", `/groups/${group.id}/users`, cookie, { ids: [user.id] });

    const groups = (await inject("GET", `/users/${user.id}/groups`, cookie)).json();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: group.id, name: "Support", isSystem: false });
  });
});
