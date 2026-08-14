// Author: Brijesh Dave <https://github.com/brijeshdave>
// The five cartridge reports.
//
// The two health reports are the ones worth testing hardest, because they are
// the ones somebody acts on: a report that says everything is fine when a printer
// has eaten three cartridges is worse than no report, and the difference between
// "this cartridge is bad" and "this printer is bad" is the whole reason there are
// two of them.
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

/** Run a report the way the screen does. */
function run(source: string) {
  return inject("POST", "/reports/run", {
    // No `columns`: every cartridge report has a fixed set, and the schema
    // rejects an empty array rather than treating it as "use the default".
    definition: { source, range: "this_fy", grouping: "none", filters: {} },
  });
}

/**
 * One printer that eats cartridges, and one that does not.
 *
 * Three DIFFERENT cartridges fail in the bad printer, which is the distinction
 * the printer report exists to draw: one cartridge failing repeatedly says
 * nothing about the machine.
 */
async function buildFleet() {
  await setCompanySetting(PARTS_MODULE, DEMO_COMPANY_ID, { enabled: true, failureWindowDays: 14 });

  const dept = (await inject("POST", "/departments", { name: "IT" })).json();
  const type = (
    await inject("POST", "/device-types", { departmentId: dept.id, name: "LaserJet" })
  ).json();
  const bad = (await inject("POST", "/devices", { name: "Bad printer", typeId: type.id })).json();
  const good = (await inject("POST", "/devices", { name: "Good printer", typeId: type.id })).json();
  const model = (
    await inject("POST", "/part-models", {
      name: "HP 12A",
      ratedPageYield: 2000,
      compatibleDeviceTypeIds: [type.id],
    })
  ).json();
  const kind = (
    await inject("POST", "/part-service-kinds", { name: "Refill", defaultPoints: 3 })
  ).json();
  const toner = (await inject("POST", "/consumables", { name: "Toner", unit: "g" })).json();

  const tour = async (identifier: string, deviceId: string, ok: boolean, pages: number) => {
    const part = (
      await inject("POST", "/parts", { identifier, partModelId: model.id, status: "ready" })
    ).json();
    await inject("POST", `/parts/${part.id}/services`, {
      serviceKindId: kind.id,
      consumptions: [{ consumableId: toner.id, quantity: 90 }],
    });
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId, meterStart: 1000 });
    await inject("POST", `/parts/${part.id}/return`, {
      outcome: ok ? "ok" : "faulty",
      meterEnd: 1000 + pages,
    });
    return part;
  };

  // Three different cartridges, all failing in the bad printer.
  await tour("TN-01", bad.id, false, 300);
  await tour("TN-02", bad.id, false, 350);
  await tour("TN-03", bad.id, false, 400);
  // And two healthy tours elsewhere.
  await tour("TN-04", good.id, true, 1900);
  await tour("TN-05", good.id, true, 1950);

  return { bad, good };
}

const cellsOf = (body: { groups?: { rows: { cells: Record<string, string> }[] }[] }) => {
  // A failed run has no groups; showing the envelope beats "cannot read 0".
  if (!body.groups) throw new Error(`report did not run: ${JSON.stringify(body)}`);
  return body.groups[0]!.rows.map((row) => row.cells);
};

describe("the cartridge reports", () => {
  it("refuses every one of them when the company does not use the module", async () => {
    // A 404, not an empty table titled "Cartridge health" — the same answer the
    // module's own routes give, for the same reason.
    for (const source of [
      "part_register",
      "part_services",
      "part_consumption",
      "part_health",
      "printer_health",
      "part_failures",
      "part_workload",
    ]) {
      expect((await run(source)).statusCode, source).toBe(404);
    }
  });

  it("lists the register with where each cartridge is", async () => {
    await buildFleet();
    const rows = cellsOf((await run("part_register")).json());

    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ cartridge: "TN-01", model: "HP 12A" });
    // Every one of them came back from a tour, so every one needs service.
    expect(rows.every((row) => row.partStatus === "Needs service")).toBe(true);
  });

  it("logs what was refilled, by whom, and what it used", async () => {
    await buildFleet();
    const rows = cellsOf((await run("part_services")).json());

    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ serviceKind: "Refill", used: "Toner 90g", points: "3" });
  });

  it("totals what was consumed, as usage rather than stock", async () => {
    await buildFleet();
    const rows = cellsOf((await run("part_consumption")).json());

    // Five refills at 90g. A total of what jobs used — this module has never
    // known what is left in the cupboard.
    expect(rows).toEqual([{ consumable: "Toner", unit: "g", quantity: "450", jobs: "5" }]);
  });

  it("puts the failing cartridges at the top of cartridge health", async () => {
    await buildFleet();
    const rows = cellsOf((await run("part_health")).json());

    // Worst first, so a report meant to surface trouble does not ask the reader
    // to sort it.
    expect(
      rows
        .slice(0, 3)
        .map((row) => row.cartridge)
        .sort(),
    ).toEqual(["TN-01", "TN-02", "TN-03"]);
    expect(rows[0]!.verdict).toMatch(/fails more often than it works/i);
    expect(rows[4]!.verdict).toBe("Healthy");
  });

  it("names who serviced a cartridge that then failed, and who took it out", async () => {
    // "Did the work we did hold up" — which no other report answers: the health
    // reports aggregate, and the service log stops at the refill.
    await buildFleet();
    const rows = cellsOf((await run("part_failures")).json());

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      printer: "Bad printer",
      serviceKind: "Refill",
      servicedBy: "Super Admin",
      removedBy: "Super Admin",
      // Inside the failure window, so the refill's points went back.
      reversed: "reversed",
    });
    // The tour lasted no time at all in a test, which is still an honest answer.
    expect(rows[0]!.lastedDays).toMatch(/day/);
  });

  it("says so plainly when a failed cartridge was never serviced", async () => {
    // Not somebody's work gone wrong — it arrived broken, and a blank column
    // would read as a missing name rather than an absent service.
    await buildFleet();
    const model = (await inject("GET", "/part-models")).json()[0];
    const part = (
      await inject("POST", "/parts", {
        identifier: "TN-99",
        partModelId: model.id,
        status: "ready",
      })
    ).json();
    const device = (await inject("GET", "/devices")).json().data[0];
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    await inject("POST", `/parts/${part.id}/return`, { outcome: "faulty" });

    const rows = cellsOf((await run("part_failures")).json());
    const fresh = rows.find((row) => row.cartridge === "TN-99");
    expect(fresh).toMatchObject({
      serviceKind: "never serviced",
      servicedBy: "—",
      reversed: "kept",
    });
  });

  it("tallies who serviced how many, and how much of it came back", async () => {
    await buildFleet();
    const rows = cellsOf((await run("part_workload")).json());

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      person: "Super Admin",
      services: "5",
      breakdown: "Refill 5",
      cartridges: "5",
      used: "Toner 450g",
      // Three of the five came back faulty. Twelve refills is not a fact about
      // anybody until you know whether they held up.
      cameBack: "3",
    });
  });

  it("narrows the service log to one person, and leaves the register alone", async () => {
    await buildFleet();
    const mine = (await inject("GET", "/me")).json().user.id;

    const filtered = await inject("POST", "/reports/run", {
      definition: {
        source: "part_services",
        range: "this_fy",
        grouping: "none",
        filters: { personId: [mine] },
      },
    });
    expect(cellsOf(filtered.json())).toHaveLength(5);

    const nobody = await inject("POST", "/reports/run", {
      definition: {
        source: "part_services",
        range: "this_fy",
        grouping: "none",
        filters: { personId: ["00000000-0000-0000-0000-000000000009"] },
      },
    });
    expect(cellsOf(nobody.json())).toHaveLength(0);

    // The register has no person to narrow by, so the filter is not applied
    // rather than silently emptying it — the picker does not offer it either.
    const register = await inject("POST", "/reports/run", {
      definition: {
        source: "part_register",
        range: "this_fy",
        grouping: "none",
        filters: { personId: ["00000000-0000-0000-0000-000000000009"] },
      },
    });
    expect(cellsOf(register.json())).toHaveLength(5);
  });

  it("names the printer that ate three different cartridges", async () => {
    // The report that would not exist without asking for it. One cartridge
    // failing repeatedly is a cartridge problem; three different ones failing in
    // the same machine is a printer problem, and only this grouping shows it.
    await buildFleet();
    const rows = cellsOf((await run("printer_health")).json());

    expect(rows[0]).toMatchObject({
      printer: "Bad printer",
      printerType: "LaserJet",
      failures: "3",
      cartridges: "3",
    });
    expect(rows[0]!.verdict).toBe("3 different cartridges failed here");
    expect(rows[1]).toMatchObject({ printer: "Good printer", failures: "0", verdict: "Healthy" });
  });
});
