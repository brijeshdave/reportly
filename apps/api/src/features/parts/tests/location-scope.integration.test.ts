// Author: Brijesh Dave <https://github.com/brijeshdave>
// Cartridges belong to a site, and so does the person looking at them.
//
// Reported from production: "cartridges currently showing for all locations to all
// users. It should be bound to its own locations and users should only shown for
// their locations and work on their locations and devices to be installed."
//
// The `parts` table has carried a `location_id` since the module shipped and
// nothing read it, so the register showed every plant's stock to everybody and the
// install picker offered printers at sites the person had never been to. That is
// the SF-004 shape exactly — a correct column nobody consulted — and the static
// guard could not see it because cartridges were missing from its list.
import { PARTS_MODULE } from "@reportly/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { setCompanySetting } from "@/core/settings/service.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const TEMP_PW = "Str0ngTempPass!x";
const OWN_PW = "TheirOwnP4ss!ok";

let app: Awaited<ReturnType<typeof buildApp>>;
let admin: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => String(c).split(";")[0]).join("; ");
}

function inject(method: string, url: string, who: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie: who, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

beforeEach(async () => {
  await resetDb();
  const password = await resetSuperadmin();
  admin = cookieFrom(
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/email`,
      payload: { email: "admin@reportly.local", password },
    }),
  );
  await setCompanySetting(PARTS_MODULE, DEMO_COMPANY_ID, { enabled: true, failureWindowDays: 14 });
});

/** A cartridge technician who works at exactly one site. */
async function technicianAt(locationId: string, username: string) {
  const group = (await inject("POST", "/groups", admin, { name: `Techs ${username}` })).json();
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === "Cartridge admin");
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });

  const created = await inject("POST", "/users", admin, {
    name: username,
    username,
    email: `${username}@reportly.test`,
    password: TEMP_PW,
  });
  const id = created.json().id as string;
  await inject("PUT", `/users/${id}/companies`, admin, { ids: [DEMO_COMPANY_ID] });
  await inject("PUT", `/users/${id}/locations`, admin, { ids: [locationId] });
  const assignments = (await inject("GET", `/groups/${group.id}/assignments`, admin)).json();
  await inject("PUT", `/groups/${group.id}/users`, admin, { ids: [...assignments.users, id] });

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

/** Two sites, a printer at each, and a cartridge model that fits both. */
async function twoPlants() {
  const sites = (await inject("GET", "/locations", admin)).json() as { id: string; name: string }[];
  const [plantA, plantB] = sites;

  const dept = (await inject("POST", "/departments", admin, { name: "IT" })).json();
  const type = (
    await inject("POST", "/device-types", admin, { departmentId: dept.id, name: "LaserJet" })
  ).json();

  const printerA = (
    await inject("POST", "/devices", admin, {
      name: "Printer A",
      typeId: type.id,
      locationId: plantA!.id,
    })
  ).json();
  const printerB = (
    await inject("POST", "/devices", admin, {
      name: "Printer B",
      typeId: type.id,
      locationId: plantB!.id,
    })
  ).json();

  const model = (
    await inject("POST", "/part-models", admin, {
      name: "Toner 26A",
      compatibleDeviceTypeIds: [type.id],
    })
  ).json();

  const partA = (
    await inject("POST", "/parts", admin, {
      identifier: "CART-A",
      partModelId: model.id,
      status: "ready",
      locationId: plantA!.id,
    })
  ).json();
  const partB = (
    await inject("POST", "/parts", admin, {
      identifier: "CART-B",
      partModelId: model.id,
      status: "ready",
      locationId: plantB!.id,
    })
  ).json();

  return { plantA: plantA!, plantB: plantB!, printerA, printerB, model, partA, partB };
}

describe("the cartridge register, by site", () => {
  it("shows a technician their own plant's stock and not the other's", async () => {
    const { plantA } = await twoPlants();
    const tech = await technicianAt(plantA.id, "atech");

    const rows = (await inject("GET", "/parts", tech.cookie)).json().data as {
      identifier: string;
    }[];
    expect(rows.map((row) => row.identifier)).toContain("CART-A");
    expect(rows.map((row) => row.identifier)).not.toContain("CART-B");
  });

  it("answers 'not found' for another plant's cartridge, not 'forbidden'", async () => {
    // The register says it does not exist, so the detail page says the same. A 403
    // would confirm the thing is there, which the list already refuses to admit.
    const { plantA, partB } = await twoPlants();
    const tech = await technicianAt(plantA.id, "btech");

    expect((await inject("GET", `/parts/${partB.id}`, tech.cookie)).statusCode).toBe(404);
  });

  it("refuses to register a cartridge into somebody else's plant", async () => {
    // Writing out of scope is refused rather than filtered: it would put a record
    // where the person who made it cannot look.
    const { plantA, plantB, model } = await twoPlants();
    const tech = await technicianAt(plantA.id, "ctech");

    const res = await inject("POST", "/parts", tech.cookie, {
      identifier: "CART-C",
      partModelId: model.id,
      status: "ready",
      locationId: plantB.id,
    });
    expect(res.statusCode).toBe(403);
  });

  it("offers only the printers at their own sites when installing", async () => {
    const { plantA, partA } = await twoPlants();
    const tech = await technicianAt(plantA.id, "dtech");

    const devices = (await inject("GET", `/parts/${partA.id}/fitting-devices`, tech.cookie)).json();
    expect(devices.map((d: { name: string }) => d.name)).toEqual(["Printer A"]);
  });

  it("refuses to install into a printer at another plant", async () => {
    // The picker not offering it is not enough — the id can still be sent.
    const { plantA, partA, printerB } = await twoPlants();
    const tech = await technicianAt(plantA.id, "etech");

    const res = await inject("POST", `/parts/${partA.id}/deploy`, tech.cookie, {
      deviceId: printerB.id,
    });
    expect(res.statusCode).toBe(404);
  });

  it("still shows a cartridge that has no site at all", async () => {
    // Every cartridge registered before this existed has no location, and hiding
    // those would empty the register for everybody at a stroke.
    const { plantA, model } = await twoPlants();
    await inject("POST", "/parts", admin, {
      identifier: "CART-NOWHERE",
      partModelId: model.id,
      status: "ready",
    });
    const tech = await technicianAt(plantA.id, "ftech");

    const rows = (await inject("GET", "/parts", tech.cookie)).json().data as {
      identifier: string;
    }[];
    expect(rows.map((row) => row.identifier)).toContain("CART-NOWHERE");
  });
});
