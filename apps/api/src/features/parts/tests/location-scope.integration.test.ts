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

/**
 * The site is which plant's stock a cartridge is — not where the object happens to
 * be standing this week. The placement answers that, and the two never contradict
 * each other.
 *
 * Reported from production, after the first version shipped them as one field:
 *
 *   "currently cartridge location only allows to change once. When i set it to
 *    Kosamba it clears existing install device location and when again install it
 *    on device it clears site location. This should be two different things."
 *   "also it should be installed on devices at that locations only."
 */
describe("a cartridge's site and the machine it is in", () => {
  it("keeps the site when the cartridge is installed", async () => {
    const { plantA, printerA, partA } = await twoPlants();

    const installed = await inject("POST", `/parts/${partA.id}/deploy`, admin, {
      deviceId: printerA.id,
    });
    expect(installed.statusCode).toBe(200);

    // It was Plant A's stock before it went into the printer, and it still is.
    const after = (await inject("GET", `/parts/${partA.id}`, admin)).json();
    expect(after.status).toBe("installed");
    expect(after.locationId).toBe(plantA.id);
  });

  it("still shows an installed cartridge only to its own site", async () => {
    // The sharp end of the old behaviour: installing cleared the site, an unplaced
    // cartridge is deliberately visible to everybody, so scoping stopped applying
    // the moment a cartridge went into a machine.
    const { plantA, printerB, partB } = await twoPlants();
    await inject("POST", `/parts/${partB.id}/deploy`, admin, { deviceId: printerB.id });

    const tech = await technicianAt(plantA.id, "gtech");
    const rows = (await inject("GET", "/parts", tech.cookie)).json().data as {
      identifier: string;
    }[];
    expect(rows.map((row) => row.identifier)).not.toContain("CART-B");
  });

  it("lets the site be corrected while the cartridge is installed", async () => {
    // It could not be, so a cartridge installed at the wrong site was stuck there:
    // the edit refused while installed, and booking it back in was the only way.
    const { plantB, printerA, partA } = await twoPlants();
    await inject("POST", `/parts/${partA.id}/deploy`, admin, { deviceId: printerA.id });

    const moved = await inject("PATCH", `/parts/${partA.id}`, admin, { locationId: plantB.id });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().locationId).toBe(plantB.id);
    // And it is still in the machine — the two answers do not overwrite each other.
    expect(moved.json().status).toBe("installed");
  });

  it("offers only the machines at the cartridge's own site", async () => {
    const { partA } = await twoPlants();
    const devices = (await inject("GET", `/parts/${partA.id}/fitting-devices`, admin)).json();
    // The superadmin reaches both plants, so this is the cartridge's site narrowing
    // the list, not the caller's.
    expect(devices.map((d: { name: string }) => d.name)).toEqual(["Printer A"]);
  });

  it("refuses to install a cartridge into another site's machine", async () => {
    const { printerB, partA } = await twoPlants();
    const res = await inject("POST", `/parts/${partA.id}/deploy`, admin, { deviceId: printerB.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/belongs to another site/);
  });

  it("gives unplaced stock the site of the machine it goes into", async () => {
    // How the cartridges registered before sites existed get placed by being used.
    const { plantA, printerA, model } = await twoPlants();
    const loose = (
      await inject("POST", "/parts", admin, {
        identifier: "CART-LOOSE",
        partModelId: model.id,
        status: "ready",
      })
    ).json();
    expect(loose.locationId).toBeNull();

    const installed = await inject("POST", `/parts/${loose.id}/deploy`, admin, {
      deviceId: printerA.id,
    });
    expect(installed.statusCode).toBe(200);
    expect(installed.json().locationId).toBe(plantA.id);
  });
});

/**
 * One machine, one cartridge of a kind.
 *
 * Reported from production: "it allows to install more than one cartridges to same
 * printer which is not possible in real. So it should not allow it and even not
 * show that printer in install selection as there would be already a cartridge
 * there. So it should be shown disabled non selectable showing cartridge number
 * install in there."
 *
 * Scoped to the model rather than the machine, so a printer that takes a set of
 * four colours still works: two of the *same* cartridge is the impossible thing.
 */
describe("a printer that already has a cartridge in it", () => {
  it("refuses a second cartridge of the same kind", async () => {
    const { printerA, partA, model } = await twoPlants();
    const sites = (await inject("GET", "/locations", admin)).json() as { id: string }[];
    const second = (
      await inject("POST", "/parts", admin, {
        identifier: "CART-A2",
        partModelId: model.id,
        status: "ready",
        locationId: sites[0]!.id,
      })
    ).json();

    expect(
      (await inject("POST", `/parts/${partA.id}/deploy`, admin, { deviceId: printerA.id }))
        .statusCode,
    ).toBe(200);

    const refused = await inject("POST", `/parts/${second.id}/deploy`, admin, {
      deviceId: printerA.id,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/already has CART-A/);
  });

  it("names the cartridge in the way rather than hiding the machine", async () => {
    // Dropping the printer from the list would send somebody hunting for a machine
    // they can see standing in front of them.
    const { printerA, partA, model } = await twoPlants();
    const sites = (await inject("GET", "/locations", admin)).json() as { id: string }[];
    const second = (
      await inject("POST", "/parts", admin, {
        identifier: "CART-A2",
        partModelId: model.id,
        status: "ready",
        locationId: sites[0]!.id,
      })
    ).json();
    await inject("POST", `/parts/${partA.id}/deploy`, admin, { deviceId: printerA.id });

    const devices = (await inject("GET", `/parts/${second.id}/fitting-devices`, admin)).json() as {
      id: string;
      occupiedBy: string | null;
    }[];
    expect(devices.map((d) => d.id)).toContain(printerA.id);
    expect(devices.find((d) => d.id === printerA.id)?.occupiedBy).toBe("CART-A");
  });

  it("frees the machine again once the cartridge is booked back in", async () => {
    const { printerA, partA, model } = await twoPlants();
    const sites = (await inject("GET", "/locations", admin)).json() as { id: string }[];
    const second = (
      await inject("POST", "/parts", admin, {
        identifier: "CART-A2",
        partModelId: model.id,
        status: "ready",
        locationId: sites[0]!.id,
      })
    ).json();

    await inject("POST", `/parts/${partA.id}/deploy`, admin, { deviceId: printerA.id });
    await inject("POST", `/parts/${partA.id}/return`, admin, { outcome: "ok" });

    const devices = (await inject("GET", `/parts/${second.id}/fitting-devices`, admin)).json() as {
      id: string;
      occupiedBy: string | null;
    }[];
    expect(devices.find((d) => d.id === printerA.id)?.occupiedBy).toBeNull();
    expect(
      (await inject("POST", `/parts/${second.id}/deploy`, admin, { deviceId: printerA.id }))
        .statusCode,
    ).toBe(200);
  });
});
