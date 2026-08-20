// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the shift catalogue: CRUD, unique names, the zero-length
// guard, overnight shifts, and the permission split — a Member may read the shifts
// but not build them.
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

async function makeGroup(admin: string, name: string, roleName: string): Promise<string> {
  const group = (await inject("POST", "/groups", admin, { name })).json();
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
}

async function makeUser(
  admin: string,
  username: string,
  groupId: string,
): Promise<{ id: string; cookie: string }> {
  const created = await inject("POST", "/users", admin, {
    name: username,
    email: `${username}@reportly.test`,
    username,
    password: TEMP_PW,
  });
  const id = created.json().id as string;
  await inject("PUT", `/users/${id}/companies`, admin, { ids: [DEMO_COMPANY_ID] });
  const assignments = (await inject("GET", `/groups/${groupId}/assignments`, admin)).json();
  await inject("PUT", `/groups/${groupId}/users`, admin, { ids: [...assignments.users, id] });

  const gated = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/username`,
    payload: { username, password: TEMP_PW },
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
    payload: { username, password: OWN_PW },
  });
  return { id, cookie: cookieFrom(clean) };
}

describe("shifts", () => {
  it("creates a shift and lists it, earliest start first", async () => {
    const admin = await superadmin();
    await inject("POST", "/shifts", admin, {
      name: "Evening",
      code: "E",
      startMinute: 14 * 60,
      endMinute: 22 * 60,
    });
    const morning = await inject("POST", "/shifts", admin, {
      name: "Morning",
      code: "M",
      startMinute: 6 * 60,
      endMinute: 14 * 60,
    });
    expect(morning.statusCode).toBe(201);
    expect(morning.json()).toMatchObject({ name: "Morning", status: "active", startMinute: 360 });

    const list = (await inject("GET", "/shifts", admin)).json();
    expect(list.map((s: { name: string }) => s.name)).toEqual(["Morning", "Evening"]);
  });

  it("enforces unique names within a company", async () => {
    const admin = await superadmin();
    await inject("POST", "/shifts", admin, {
      name: "Night",
      code: "N",
      startMinute: 1320,
      endMinute: 360,
    });
    const dup = await inject("POST", "/shifts", admin, {
      name: "Night",
      code: "N",
      startMinute: 0,
      endMinute: 480,
    });
    expect(dup.statusCode).toBe(409);
  });

  it("rejects a zero-length shift but allows an overnight one", async () => {
    const admin = await superadmin();
    const zero = await inject("POST", "/shifts", admin, {
      name: "Nope",
      code: "NO",
      startMinute: 540,
      endMinute: 540,
    });
    expect(zero.statusCode).toBe(400);

    // 22:00 → 06:00 wraps midnight — end before start is a valid overnight shift.
    const overnight = await inject("POST", "/shifts", admin, {
      name: "Night",
      code: "N",
      startMinute: 1320,
      endMinute: 360,
    });
    expect(overnight.statusCode).toBe(201);
  });

  it("renames, retimes, disables, and deletes a shift", async () => {
    const admin = await superadmin();
    const id = (
      await inject("POST", "/shifts", admin, {
        name: "Day",
        code: "D",
        startMinute: 540,
        endMinute: 1020,
      })
    ).json().id;

    const updated = (
      await inject("PATCH", `/shifts/${id}`, admin, { name: "General", status: "disabled" })
    ).json();
    expect(updated).toMatchObject({ name: "General", status: "disabled" });

    expect((await inject("DELETE", `/shifts/${id}`, admin)).statusCode).toBe(204);
    expect((await inject("GET", `/shifts/${id}`, admin)).statusCode).toBe(404);
  });

  it("lets a Member read shifts but not build them", async () => {
    const admin = await superadmin();
    await inject("POST", "/shifts", admin, {
      name: "Morning",
      code: "M",
      startMinute: 360,
      endMinute: 840,
    });

    const memberGroup = await makeGroup(admin, "Floor", "Member");
    const member = await makeUser(admin, "sam", memberGroup);

    // shifts:read comes with Member (it ends in :read) — the calendar is shared.
    expect((await inject("GET", "/shifts", member.cookie)).statusCode).toBe(200);
    // shifts:manage does not — building shifts is a scheduler's job.
    const denied = await inject("POST", "/shifts", member.cookie, {
      name: "Sneaky",
      code: "S",
      startMinute: 0,
      endMinute: 60,
    });
    expect(denied.statusCode).toBe(403);
  });
});
