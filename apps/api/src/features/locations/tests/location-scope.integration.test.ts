// Author: Brijesh Dave <https://github.com/brijeshdave>
// SF-004: the group's location scope, enforced.
//
// These are the tests that were missing. Everything about location scoping used to
// be proven by a unit test on a pure helper, which passed for five phases while no
// query called it. So every assertion here drives a **real signed-in user whose
// group is scoped to one site** through real HTTP, and checks what they can see,
// open and write. Nothing here inspects a condition object.
//
// The four behaviours that matter, and each is a separate failure mode:
//   1. a scoped user does not SEE another site's rows (list)
//   2. a scoped user cannot OPEN one by id (404, not 403 — no enumeration)
//   3. a scoped user cannot WRITE into a site they lack (403, with a reason)
//   4. an UNPLACED row stays visible to everyone (the NULL rule; getting this
//      wrong empties every list, since nothing had a location before this shipped)
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

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
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

async function makeGroup(admin: string, name: string, roleName: string): Promise<string> {
  const group = (await inject("POST", "/groups", admin, { name })).json();
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
}

async function makeUser(
  admin: string,
  name: string,
  username: string,
  groupId: string,
): Promise<{ id: string; cookie: string }> {
  const created = await inject("POST", "/users", admin, {
    name,
    email: `${username}@reportly.test`,
    username,
    password: TEMP_PW,
  });
  const id = created.json().id as string;
  // Company access belongs to the person now, not to their group.
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

/**
 * Two plants, and a person narrowed to the first. Scope is the user's now — a group
 * says what they may do, `user_locations` says where — so the narrowing is applied
 * to the person after they exist.
 */
async function twoPlants(admin: string) {
  const plantA = (await inject("POST", "/locations", admin, { name: "Plant A" })).json();
  const plantB = (await inject("POST", "/locations", admin, { name: "Plant B" })).json();

  const scopedGroup = await makeGroup(admin, "Plant A staff", "Manager");
  const scopedUser = await makeUser(admin, "Priya PlantA", "priya", scopedGroup);
  await inject("PUT", `/users/${scopedUser.id}/locations`, admin, { ids: [plantA.id] });

  return { plantA, plantB, scopedUser };
}

describe("SF-004: a person's location scope constrains what they can reach", () => {
  it("hides another plant's locations from the picker and refuses to touch it", async () => {
    const admin = await superadmin();
    const { plantA, plantB, scopedUser } = await twoPlants(admin);

    const visible = (await inject("GET", "/locations", scopedUser.cookie)).json();
    const names = visible.map((l: { name: string }) => l.name);
    expect(names).toContain("Plant A");
    expect(names).not.toContain("Plant B");
    // The demo company's seeded Remote location is out of scope now too.
    expect(visible.every((l: { id: string }) => l.id === plantA.id)).toBe(true);

    // There is no GET /locations/:id route, so reachability by id is proven
    // through the routes that do exist. 404 rather than 403: a distinct
    // "forbidden" would confirm Plant B exists to someone who cannot see it.
    expect(
      (await inject("GET", `/locations/${plantB.id}/references`, scopedUser.cookie)).statusCode,
    ).toBe(404);
    expect(
      (await inject("GET", `/locations/${plantA.id}/references`, scopedUser.cookie)).statusCode,
    ).toBe(200);
  });

  it("keeps an asset at another plant out of the list and out of reach", async () => {
    const admin = await superadmin();
    const { plantA, plantB, scopedUser } = await twoPlants(admin);

    const atA = (
      await inject("POST", "/assets", admin, { name: "Line 1", locationId: plantA.id })
    ).json();
    const atB = (
      await inject("POST", "/assets", admin, { name: "Line 2", locationId: plantB.id })
    ).json();

    const list = (await inject("GET", "/assets", scopedUser.cookie)).json();
    const ids = list.map((a: { id: string }) => a.id);
    expect(ids).toContain(atA.id);
    expect(ids).not.toContain(atB.id);

    expect((await inject("GET", `/assets/${atB.id}`, scopedUser.cookie)).statusCode).toBe(404);
    expect((await inject("GET", `/assets/${atA.id}`, scopedUser.cookie)).statusCode).toBe(200);
  });

  it("keeps an UNPLACED asset visible to a scoped user", async () => {
    const admin = await superadmin();
    const { scopedUser } = await twoPlants(admin);

    // The rule that makes this change safe to ship. Before this, no row anywhere
    // had a location — so if NULL were treated as "not yours", every list in the
    // app would have emptied for every scoped group on deploy.
    const unplaced = (await inject("POST", "/assets", admin, { name: "Spare rig" })).json();
    expect(unplaced.locationId).toBeNull();

    const list = (await inject("GET", "/assets", scopedUser.cookie)).json();
    expect(list.map((a: { id: string }) => a.id)).toContain(unplaced.id);
    expect((await inject("GET", `/assets/${unplaced.id}`, scopedUser.cookie)).statusCode).toBe(200);
  });

  it("refuses to let a scoped user place a record at a plant they cannot see", async () => {
    const admin = await superadmin();
    const { plantA, plantB, scopedUser } = await twoPlants(admin);

    // Writing is refused (403), not filtered: a record placed where you can never
    // look again is lost on purpose, and silently accepting it would be worse.
    const refused = await inject("POST", "/assets", scopedUser.cookie, {
      name: "Sneaky line",
      locationId: plantB.id,
    });
    expect(refused.statusCode).toBe(403);

    const allowed = await inject("POST", "/assets", scopedUser.cookie, {
      name: "Honest line",
      locationId: plantA.id,
    });
    expect(allowed.statusCode).toBe(201);

    // And they cannot move an asset they own out to the other plant either.
    const moved = await inject("PATCH", `/assets/${allowed.json().id}`, scopedUser.cookie, {
      locationId: plantB.id,
    });
    expect(moved.statusCode).toBe(403);
  });

  it("scopes devices the same way", async () => {
    const admin = await superadmin();
    const { plantA, plantB, scopedUser } = await twoPlants(admin);

    const atA = (
      await inject("POST", "/devices", admin, { name: "Welder A", locationId: plantA.id })
    ).json();
    const atB = (
      await inject("POST", "/devices", admin, { name: "Welder B", locationId: plantB.id })
    ).json();
    const unplaced = (await inject("POST", "/devices", admin, { name: "Spare welder" })).json();

    const list = (await inject("GET", "/devices", scopedUser.cookie)).json().data;
    const ids = list.map((d: { id: string }) => d.id);
    expect(ids).toContain(atA.id);
    expect(ids).toContain(unplaced.id);
    expect(ids).not.toContain(atB.id);

    expect((await inject("GET", `/devices/${atB.id}`, scopedUser.cookie)).statusCode).toBe(404);
    expect(
      (await inject("POST", "/devices", scopedUser.cookie, { name: "X", locationId: plantB.id }))
        .statusCode,
    ).toBe(403);
  });

  it("hides another plant's reports even from someone who manages the author", async () => {
    const admin = await superadmin();
    const { plantA, plantB, scopedUser } = await twoPlants(admin);

    // The author reports to the scoped user, so the reporting line WOULD admit
    // them. Location must narrow on top of that: managing someone is not a reason
    // to read their work at a plant you cannot enter.
    const memberGroup = await makeGroup(admin, "Reporters", "Member");
    const author = await makeUser(admin, "Sam Operator", "sam", memberGroup);
    const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [
        { userId: scopedUser.id, rank: "lead" },
        { userId: author.id, rank: "member", reportsToId: scopedUser.id },
      ],
    });

    const file = async (locationId: string | undefined) =>
      (
        await inject("POST", "/journal", author.cookie, {
          kind: "work",
          title: locationId === plantB.id ? "At plant B" : "At plant A",
          state: "submitted",
          workSummary: "Done",
          ...(locationId ? { locationId } : {}),
        })
      ).json().id as string;

    const reportA = await file(plantA.id);
    const reportB = await file(plantB.id);
    const reportNowhere = await file(undefined);

    const list = (await inject("GET", "/journal", scopedUser.cookie)).json().data;
    const ids = list.map((r: { id: string }) => r.id);
    expect(ids).toContain(reportA);
    expect(ids).toContain(reportNowhere); // unplaced stays visible
    expect(ids).not.toContain(reportB);

    expect((await inject("GET", `/journal/${reportB}`, scopedUser.cookie)).statusCode).toBe(404);
    expect((await inject("GET", `/journal/${reportA}`, scopedUser.cookie)).statusCode).toBe(200);
  });

  it("still shows a user their OWN report filed at a plant they no longer reach", async () => {
    const admin = await superadmin();
    const { plantA, scopedUser } = await twoPlants(admin);

    const mine = (
      await inject("POST", "/journal", scopedUser.cookie, {
        kind: "work",
        title: "My own work",
        state: "submitted",
        workSummary: "Done",
        locationId: plantA.id,
      })
    ).json().id;

    // Narrow them to nothing but Plant C — their scope no longer covers where they
    // filed. Their own work must not vanish: they wrote it, and a scope change
    // afterwards is not a reason to lose your own record.
    const plantB2 = (await inject("POST", "/locations", admin, { name: "Plant C" })).json();
    await inject("PUT", `/users/${scopedUser.id}/locations`, admin, { ids: [plantB2.id] });

    expect((await inject("GET", `/journal/${mine}`, scopedUser.cookie)).statusCode).toBe(200);
  });

  it("leaves an unnarrowed person seeing everything, exactly as before", async () => {
    const admin = await superadmin();
    const { plantA, plantB } = await twoPlants(admin);

    // A group with NO group_locations rows means "all locations", which is what
    // every existing group in the wild looks like. This test is the guarantee that
    // shipping location scoping changed nothing for them.
    const openGroup = await makeGroup(admin, "Everywhere", "Manager");
    const anyone = await makeUser(admin, "Omar Open", "omar", openGroup);

    await inject("POST", "/assets", admin, { name: "L1", locationId: plantA.id });
    await inject("POST", "/assets", admin, { name: "L2", locationId: plantB.id });

    const visibleLocations = (await inject("GET", "/locations", anyone.cookie)).json();
    expect(visibleLocations.length).toBeGreaterThanOrEqual(2);

    const assets = (await inject("GET", "/assets", anyone.cookie)).json();
    expect(assets.map((a: { name: string }) => a.name)).toEqual(
      expect.arrayContaining(["L1", "L2"]),
    );
  });
});
