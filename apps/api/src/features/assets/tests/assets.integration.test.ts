// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the scope master lists — the asset tree, the device registry,
// and what a report is about:
//   - the tree and the registry are built, and what is in use is retired, not deleted
//   - a report's scope round-trips, and may name nothing at all
//   - the roll-up means what a person means: "under Line 3" includes its stations
//     *and* the devices standing at them, none of which were placed in a tree by hand
//   - scope cannot name another company's things
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

async function makeGroup(admin: string, name: string, roleName: string): Promise<string> {
  const group = (await inject("POST", "/groups", admin, { name })).json();
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
}

/** An author who may file reports, in a department (so they are "in the company"). */
async function makeAuthor(admin: string) {
  const memberGroup = await makeGroup(admin, "Reporters", "Member");
  const author = await makeUser(admin, "Sam Operator", "sam", memberGroup);
  const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [{ userId: author.id, rank: "member" }],
  });
  return { author, dept };
}

/** Plant → Line 3 → Station 1, with a robot arm standing at the station. */
async function buildPlant(admin: string) {
  const types = (await inject("GET", "/asset-types", admin)).json();
  const typeId = (name: string) => types.find((t: { name: string }) => t.name === name).id;

  const plant = (
    await inject("POST", "/assets", admin, { name: "Plant 1", typeId: typeId("Plant") })
  ).json();
  const line3 = (
    await inject("POST", "/assets", admin, {
      name: "Line 3",
      typeId: typeId("Line"),
      parentId: plant.id,
    })
  ).json();
  const station1 = (
    await inject("POST", "/assets", admin, {
      name: "Station 1",
      typeId: typeId("Station"),
      parentId: line3.id,
    })
  ).json();
  const line4 = (
    await inject("POST", "/assets", admin, {
      name: "Line 4",
      typeId: typeId("Line"),
      parentId: plant.id,
    })
  ).json();

  const robot = (
    await inject("POST", "/devices", admin, {
      name: "Robot arm",
      identifier: "RA-77",
      assetId: station1.id,
    })
  ).json();

  return { plant, line3, station1, line4, robot, typeId };
}

describe("asset tree and device registry", () => {
  it("builds a tree and a registry, and retires what is in use rather than deleting it", async () => {
    const admin = await superadmin();
    const { plant, line3, station1, robot, typeId } = await buildPlant(admin);

    const assets = (await inject("GET", "/assets", admin)).json();
    expect(assets).toHaveLength(4);

    // The tree is carried by parentId; the station knows the device stands at it.
    const found = (id: string) => assets.find((a: { id: string }) => a.id === id);
    expect(found(line3.id).parentId).toBe(plant.id);
    expect(found(station1.id).parentId).toBe(line3.id);
    expect(found(station1.id).deviceCount).toBe(1);
    expect(found(line3.id).typeName).toBe("Line");

    // The registry resolves where a device lives.
    const devices = (await inject("GET", "/devices", admin)).json().data;
    expect(devices).toHaveLength(1);
    expect(devices[0].assetName).toBe("Station 1");
    expect(devices[0].identifier).toBe("RA-77");

    // A line with a station under it cannot be deleted out from under it.
    const delLine = await inject("DELETE", `/assets/${line3.id}`, admin);
    expect(delLine.statusCode).toBe(409);

    // Nor can a station a device stands at.
    expect((await inject("DELETE", `/assets/${station1.id}`, admin)).statusCode).toBe(409);

    // Nor a type the tree is built from.
    expect((await inject("DELETE", `/asset-types/${typeId("Line")}`, admin)).statusCode).toBe(409);

    // Retiring is always available, and is the intended move.
    const retired = await inject("PATCH", `/assets/${line3.id}`, admin, { status: "inactive" });
    expect(retired.statusCode).toBe(200);
    expect(retired.json().status).toBe("inactive");

    // A device nothing references may simply go.
    expect((await inject("DELETE", `/devices/${robot.id}`, admin)).statusCode).toBe(204);
  });

  it("round-trips a report's scope, and lets a report be about nothing", async () => {
    const admin = await superadmin();
    const { author, dept } = await makeAuthor(admin);
    const { line3, robot } = await buildPlant(admin);

    const filed = await inject("POST", "/journal", author.cookie, {
      kind: "issue",
      title: "Robot arm stalling",
      state: "submitted",
      targets: [
        { kind: "asset", id: line3.id },
        { kind: "device", id: robot.id },
        { kind: "department", id: dept.id },
        { kind: "user", id: author.id },
      ],
    });
    expect(filed.statusCode).toBe(201);

    const detail = (await inject("GET", `/journal/${filed.json().id}`, author.cookie)).json();
    expect(detail.targets).toHaveLength(4);

    // Each link comes back labelled — a device with its tag, so two of a kind differ.
    const label = (kind: string) =>
      detail.targets.find((t: { kind: string }) => t.kind === kind).label;
    expect(label("asset")).toBe("Line 3");
    expect(label("device")).toBe("Robot arm (RA-77)");
    expect(label("department")).toBe("Assembly");

    // Scope is replaced wholesale, and only when the key is present.
    await inject("PATCH", `/journal/${filed.json().id}`, author.cookie, {
      targets: [{ kind: "asset", id: line3.id }],
    });
    const narrowed = (await inject("GET", `/journal/${filed.json().id}`, author.cookie)).json();
    expect(narrowed.targets).toHaveLength(1);

    // An edit that never mentions scope leaves it alone.
    await inject("PATCH", `/journal/${filed.json().id}`, author.cookie, { title: "Renamed" });
    const untouched = (await inject("GET", `/journal/${filed.json().id}`, author.cookie)).json();
    expect(untouched.targets).toHaveLength(1);

    // Some work is about nothing at all, and that is a complete report.
    const bare = await inject("POST", "/journal", author.cookie, {
      kind: "work",
      title: "Read the handover notes",
      state: "submitted",
    });
    expect(bare.statusCode).toBe(201);
    expect(
      (await inject("GET", `/journal/${bare.json().id}`, author.cookie)).json().targets,
    ).toEqual([]);
  });

  it("rolls up everything under an asset, including the devices standing at it", async () => {
    const admin = await superadmin();
    const { author } = await makeAuthor(admin);
    const { plant, line3, station1, line4, robot } = await buildPlant(admin);

    const file = async (title: string, targets: unknown[]) =>
      (
        await inject("POST", "/journal", author.cookie, {
          kind: "issue",
          title,
          state: "submitted",
          targets,
        })
      ).json().id as string;

    const onLine = await file("Line stopped", [{ kind: "asset", id: line3.id }]);
    const onStation = await file("Station misaligned", [{ kind: "asset", id: station1.id }]);
    const onDevice = await file("Arm stalling", [{ kind: "device", id: robot.id }]);
    const elsewhere = await file("Line 4 jam", [{ kind: "asset", id: line4.id }]);

    const under = async (assetId: string) =>
      (await inject("GET", `/assets/${assetId}/journal`, author.cookie))
        .json()
        .data.map((r: { id: string }) => r.id)
        .sort();

    // "Issues on Line 3" means the line, its station, and the robot standing there —
    // the device is reached through the asset it lives at, never through a hand-built
    // tree of devices. Line 4's issue is not Line 3's business.
    expect(await under(line3.id)).toEqual([onLine, onStation, onDevice].sort());
    expect(await under(line4.id)).toEqual([elsewhere]);

    // The whole plant sees all four.
    expect(await under(plant.id)).toHaveLength(4);

    // A leaf sees only its own.
    expect(await under(station1.id)).toEqual([onStation, onDevice].sort());
  });

  it("refuses scope that names something outside the company", async () => {
    const admin = await superadmin();
    const { author } = await makeAuthor(admin);

    const other = (await inject("POST", "/companies", admin, { name: "Other Co" })).json();
    const foreign = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/assets`,
      headers: { cookie: admin, "x-company-id": other.id },
      payload: { name: "Someone else's line" },
    });
    expect(foreign.statusCode).toBe(201);

    const res = await inject("POST", "/journal", author.cookie, {
      kind: "issue",
      title: "Cross-company scope",
      state: "submitted",
      targets: [{ kind: "asset", id: foreign.json().id }],
    });
    expect(res.statusCode).toBe(400);
  });
});
