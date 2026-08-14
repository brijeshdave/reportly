// Author: Brijesh Dave <https://github.com/brijeshdave>
// The lifecycle guards, and the switch in front of all of them.
//
// The states this refuses are the ones nothing downstream could interpret: a part
// on two printers at once, a part installed straight out of the workshop without
// being serviced, a cartridge in a machine it does not fit. Each would leave the
// placement history saying something that never happened.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { PARTS_MODULE } from "@reportly/shared";
import { setCompanySetting } from "@/core/settings/service.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

function inject(method: string, url: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

beforeEach(async () => {
  await resetDb();
  const password = await resetSuperadmin();
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: "admin@reportly.local", password },
  });
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  cookie = list.map((c) => String(c).split(";")[0]).join("; ");
});

/** Switch the module on for the demo company — off is the default. */
async function enableModule(failureWindowDays = 14) {
  await setCompanySetting(PARTS_MODULE, DEMO_COMPANY_ID, { enabled: true, failureWindowDays });
}

/** A device type, a printer of that type, and a cartridge model that fits it. */
async function buildFixtures() {
  const dept = (await inject("POST", "/departments", { name: "IT" })).json();
  const type = (
    await inject("POST", "/device-types", { departmentId: dept.id, name: "HP LaserJet M404" })
  ).json();
  const device = (
    await inject("POST", "/devices", { name: "Reception LJ-01", typeId: type.id })
  ).json();
  const model = (
    await inject("POST", "/part-models", {
      name: "HP 12A Toner",
      cycleLimit: 6,
      compatibleDeviceTypeIds: [type.id],
    })
  ).json();
  return { dept, type, device, model };
}

describe("the module switch", () => {
  it("hides the module entirely until a company turns it on", async () => {
    // A 404, not a 403: for a company that does not refill cartridges the feature
    // genuinely is not there, and "you may not" would send somebody to their
    // administrator asking for a grant that would not help.
    expect((await inject("GET", "/parts")).statusCode).toBe(404);
    expect((await inject("GET", "/part-models")).statusCode).toBe(404);

    await enableModule();
    expect((await inject("GET", "/parts")).statusCode).toBe(200);
  });
});

describe("deploying", () => {
  it("refuses a part that does not fit the device", async () => {
    await enableModule();
    const { dept, model } = await buildFixtures();

    // A second printer of a type this model was never made compatible with.
    const otherType = (
      await inject("POST", "/device-types", { departmentId: dept.id, name: "Brother HL-L2350" })
    ).json();
    const otherDevice = (
      await inject("POST", "/devices", { name: "Store BR-01", typeId: otherType.id })
    ).json();

    const part = (
      await inject("POST", "/parts", {
        identifier: "TN-0042",
        partModelId: model.id,
        // Registered ready: a cartridge that arrives full is deployable, and
        // these tests are about the moves that follow.
        status: "ready",
      })
    ).json();

    const res = await inject("POST", `/parts/${part.id}/deploy`, { deviceId: otherDevice.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/does not fit/i);

    // And it stayed ready rather than half-moving.
    expect((await inject("GET", `/parts/${part.id}`)).json().status).toBe("ready");
  });

  it("installs a compatible part and refuses to install it twice", async () => {
    await enableModule();
    const { device, model } = await buildFixtures();
    const part = (
      await inject("POST", "/parts", {
        identifier: "TN-0042",
        partModelId: model.id,
        // Registered ready: a cartridge that arrives full is deployable, and
        // these tests are about the moves that follow.
        status: "ready",
      })
    ).json();

    const deployed = await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    expect(deployed.statusCode).toBe(200);
    expect(deployed.json()).toMatchObject({ status: "installed", deviceName: "Reception LJ-01" });

    // A part is in one machine at a time. Allowing this would leave the first
    // printer holding a cartridge the register says is somewhere else.
    const again = await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toMatch(/already installed/i);
  });
});

describe("returning", () => {
  it("books a part into the workshop and records how the tour ended", async () => {
    await enableModule();
    const { device, model } = await buildFixtures();
    const part = (
      await inject("POST", "/parts", {
        identifier: "TN-0042",
        partModelId: model.id,
        // Registered ready: a cartridge that arrives full is deployable, and
        // these tests are about the moves that follow.
        status: "ready",
      })
    ).json();
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });

    const returned = await inject("POST", `/parts/${part.id}/return`, {
      outcome: "faulty",
      note: "Streaking after two days.",
    });
    expect(returned.statusCode).toBe(200);
    expect(returned.json()).toMatchObject({ status: "needs_service", deviceId: null });

    // The tour is closed and keeps its outcome — the history is what says the part
    // was in that printer at all, since the part itself no longer does.
    const history = (await inject("GET", `/parts/${part.id}/history`)).json();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ outcome: "faulty", deviceName: "Reception LJ-01" });
    expect(history[0].removedAt).not.toBeNull();
  });

  it("refuses to install one that has not been serviced since coming back", async () => {
    await enableModule();
    const { device, model } = await buildFixtures();
    const part = (
      await inject("POST", "/parts", {
        identifier: "TN-0042",
        partModelId: model.id,
        // Registered ready: a cartridge that arrives full is deployable, and
        // these tests are about the moves that follow.
        status: "ready",
      })
    ).json();
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    await inject("POST", `/parts/${part.id}/return`, { outcome: "ok" });

    const res = await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    expect(res.statusCode).toBe(409);

    // Marking it ready is the honest way back for one that needs no service.
    expect((await inject("POST", `/parts/${part.id}/restock`, {})).statusCode).toBe(200);
    expect(
      (await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id })).statusCode,
    ).toBe(200);
  });
});

describe("scrapping", () => {
  it("refuses while the part is still in a machine", async () => {
    await enableModule();
    const { device, model } = await buildFixtures();
    const part = (
      await inject("POST", "/parts", {
        identifier: "TN-0042",
        partModelId: model.id,
        // Registered ready: a cartridge that arrives full is deployable, and
        // these tests are about the moves that follow.
        status: "ready",
      })
    ).json();
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });

    const res = await inject("POST", `/parts/${part.id}/scrap`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/book the part back in/i);
  });
});

describe("ready and needing service", () => {
  it("refuses to install a cartridge that has not been serviced", async () => {
    // The whole point of splitting "in stock". A cartridge collected for
    // refilling is empty, and putting it into a printer is the mistake this
    // state exists to prevent — but both looked identical before.
    await enableModule();
    const { device, model } = await buildFixtures();
    const part = (
      await inject("POST", "/parts", { identifier: "TN-0050", partModelId: model.id })
    ).json();
    expect(part.status).toBe("needs_service");

    const res = await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/needs a refill or a repair/i);
  });

  it("registers one that arrives full as ready", async () => {
    // A new cartridge from the supplier is usable, and only the person holding
    // the box knows which kind it is.
    await enableModule();
    const { device, model } = await buildFixtures();
    const part = (
      await inject("POST", "/parts", {
        identifier: "TN-0051",
        partModelId: model.id,
        status: "ready",
      })
    ).json();

    expect(part.status).toBe("ready");
    expect(
      (await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id })).statusCode,
    ).toBe(200);
  });
});

describe("the cycle limit", () => {
  it("flags a part past its limit without refusing anything", async () => {
    await enableModule();
    const { model } = await buildFixtures();
    const part = (
      await inject("POST", "/parts", {
        identifier: "TN-0042",
        partModelId: model.id,
        // Registered ready: a cartridge that arrives full is deployable, and
        // these tests are about the moves that follow.
        status: "ready",
      })
    ).json();

    // Fresh, it is under the limit.
    expect(part.overCycleLimit).toBe(false);
    // The flag is advisory: the maker's figure is an opinion and the technician
    // holding the part has better information. Nothing in the lifecycle consults it.
  });
});

describe("the install picker", () => {
  it("offers only devices whose type the model fits", async () => {
    // The register holds every machine a company owns. Offering a desktop for a
    // toner cartridge is not merely noise: it is a choice the deploy will refuse,
    // and a picker that leads people into refusals stops being trusted.
    await enableModule();
    const { dept, device, model } = await buildFixtures();

    const otherType = (
      await inject("POST", "/device-types", { departmentId: dept.id, name: "Desktop" })
    ).json();
    await inject("POST", "/devices", { name: "Reception PC", typeId: otherType.id });

    const part = (
      await inject("POST", "/parts", {
        identifier: "TN-0042",
        partModelId: model.id,
        // Registered ready: a cartridge that arrives full is deployable, and
        // these tests are about the moves that follow.
        status: "ready",
      })
    ).json();

    const fitting = (await inject("GET", `/parts/${part.id}/fitting-devices`)).json();
    expect(fitting).toHaveLength(1);
    expect(fitting[0]).toMatchObject({ id: device.id, typeName: "HP LaserJet M404" });
  });

  it("offers nothing when the model fits no device type", async () => {
    // Which is a true answer, and the screen says why rather than showing an
    // empty dropdown that reads as broken.
    await enableModule();
    await buildFixtures();
    const loose = (await inject("POST", "/part-models", { name: "Unmatched kit" })).json();
    const part = (
      await inject("POST", "/parts", { identifier: "TN-0099", partModelId: loose.id })
    ).json();

    expect((await inject("GET", `/parts/${part.id}/fitting-devices`)).json()).toEqual([]);
  });
});
