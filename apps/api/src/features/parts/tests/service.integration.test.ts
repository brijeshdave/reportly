// Author: Brijesh Dave <https://github.com/brijeshdave>
// Services, what they pay, and taking it back.
//
// The reversal is the only rule in this module that moves somebody's score, so it
// is the one worth pinning down: it fires once for one bad refill, it does not
// fire twice for the same one, and it does not fire at all for a part that simply
// wore out weeks later. Each of those, got wrong, is a technician quietly losing
// points they earned.
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

/**
 * A printer, a cartridge that fits it, a Refill worth 5, and toner to do it with.
 *
 * `failureWindowDays` is a parameter because two of these tests are entirely about
 * which side of it a return falls on.
 */
async function setUp(failureWindowDays = 14) {
  await setCompanySetting(PARTS_MODULE, DEMO_COMPANY_ID, { enabled: true, failureWindowDays });

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
      compatibleDeviceTypeIds: [type.id],
    })
  ).json();
  const refill = (
    await inject("POST", "/part-service-kinds", { name: "Refill", defaultPoints: 5 })
  ).json();
  const toner = (await inject("POST", "/consumables", { name: "Toner powder", unit: "g" })).json();
  const part = (
    await inject("POST", "/parts", {
      identifier: "TN-0042",
      partModelId: model.id,
      // Ready, because most of these tests start by sending it out. A part
      // registered as needing service cannot be installed, which is the point of
      // the state and is asserted where it belongs.
      status: "ready",
    })
  ).json();

  return { device, model, refill, toner, part };
}

/** Every cartridge award in the ledger, and what they come to. */
async function serviceLedger() {
  const res = await inject("GET", "/points/ledger?range=this_fy&source=service");
  expect(res.statusCode).toBe(200);
  return res.json() as { rows: { detail: string; points: number }[]; total: number };
}

/** Refill the part currently in the workshop. */
function refill(partId: string, refillId: string, tonerId: string) {
  return inject("POST", `/parts/${partId}/services`, {
    serviceKindId: refillId,
    consumptions: [{ consumableId: tonerId, quantity: 85 }],
    notes: "Cleaned and refilled.",
  });
}

describe("recording a service", () => {
  it("pays the model's rate, counts a cycle, and puts the part back in stock", async () => {
    const { device, part, refill: kind, toner } = await setUp();

    // Out and back, so it is in the workshop where a service belongs.
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    await inject("POST", `/parts/${part.id}/return`, { outcome: "ok" });

    const res = await refill(part.id, kind.id, toner.id);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      serviceKindName: "Refill",
      points: 5,
      pointsReversedAt: null,
      // What it consumed, kept with the job rather than deducted from a stock
      // level somewhere — this module records work, it does not run a cupboard.
      consumptions: [{ consumableName: "Toner powder", unit: "g", quantity: 85 }],
    });

    const after = (await inject("GET", `/parts/${part.id}`)).json();
    expect(after).toMatchObject({ status: "ready", cycleCount: 1 });

    // And it reached the shared ledger, where it is comparable with a point earned
    // filing work — that is the whole reason for not having a second scale.
    const ledger = await serviceLedger();
    expect(ledger.total).toBe(5);
    expect(ledger.rows[0]!.detail).toBe("Refill — TN-0042");
  });

  it("services a cartridge straight off the shelf, and that is what makes it ready", async () => {
    // The first refill of a newly registered part, which is the commonest one of
    // all — and the transition that earns `ready`. A part registered as needing
    // service cannot be installed until something like this happens to it.
    const { model, refill: kind, toner } = await setUp();
    // Its own part, registered the default way: collected for refilling, not
    // usable yet.
    const part = (
      await inject("POST", "/parts", { identifier: "TN-0099", partModelId: model.id })
    ).json();
    expect(part.status).toBe("needs_service");

    const res = await refill(part.id, kind.id, toner.id);
    expect(res.statusCode).toBe(201);
    expect((await inject("GET", `/parts/${part.id}`)).json()).toMatchObject({
      status: "ready",
      cycleCount: 1,
    });
    expect((await serviceLedger()).total).toBe(5);
  });

  it("refuses to service a scrapped part", async () => {
    const { part, refill: kind, toner } = await setUp();
    await inject("POST", `/parts/${part.id}/scrap`);

    const res = await refill(part.id, kind.id, toner.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/scrapped/i);
  });

  it("refuses to service a part that is still in a machine", async () => {
    const { device, part, refill: kind, toner } = await setUp();
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });

    const res = await refill(part.id, kind.id, toner.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/book the part back in/i);

    // Nothing was paid for the job that did not happen.
    expect((await serviceLedger()).total).toBe(0);
  });

  it("resolves the rate from the model, not from the caller", async () => {
    const { device, model, part, refill: kind, toner } = await setUp();
    // A big cartridge is a bigger job: this model pays 8 for the same kind.
    await inject("PUT", `/part-models/${model.id}/rates`, {
      rates: [{ serviceKindId: kind.id, points: 8 }],
    });

    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    await inject("POST", `/parts/${part.id}/return`, { outcome: "ok" });
    expect((await refill(part.id, kind.id, toner.id)).json().points).toBe(8);
    expect((await serviceLedger()).total).toBe(8);
  });
});

describe("what a kind may consume", () => {
  /** Refill: toner only, at least 1 and at most 2. Repair: spares, none required. */
  async function withRules() {
    const base = await setUp();
    const drum = (await inject("POST", "/consumables", { name: "OPC drum", unit: "ea" })).json();
    const repair = (
      await inject("POST", "/part-service-kinds", {
        name: "Repair",
        defaultPoints: 5,
        consumables: [{ consumableId: drum.id, minQuantity: 0, maxQuantity: null }],
      })
    ).json();
    await inject("PATCH", `/part-service-kinds/${base.refill.id}`, {
      consumables: [{ consumableId: base.toner.id, minQuantity: 1, maxQuantity: 2 }],
    });
    return { ...base, drum, repair };
  }

  const service = (partId: string, kindId: string, lines: unknown[]) =>
    inject("POST", `/parts/${partId}/services`, { serviceKindId: kindId, consumptions: lines });

  it("refuses a consumable the kind does not use", async () => {
    // A drum fitted during a refill is a record that is not true, and the form
    // does not offer it — but a stale tab or a second client would not know.
    const { part, refill: kind, drum } = await withRules();
    const res = await service(part.id, kind.id, [{ consumableId: drum.id, quantity: 1 }]);

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe("A Refill does not use OPC drum.");
  });

  it("requires the consumable a kind cannot do without", async () => {
    const { part, refill: kind } = await withRules();
    const res = await service(part.id, kind.id, []);

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe("A Refill needs at least 1 Toner powder.");
  });

  it("caps the quantity", async () => {
    const { part, refill: kind, toner } = await withRules();
    const res = await service(part.id, kind.id, [{ consumableId: toner.id, quantity: 3 }]);

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe("A Refill uses at most 2 Toner powder.");
  });

  it("accepts a job inside the rules", async () => {
    const { part, refill: kind, toner } = await withRules();
    expect(
      (await service(part.id, kind.id, [{ consumableId: toner.id, quantity: 2 }])).statusCode,
    ).toBe(201);
  });

  it("lets a kind be recorded with nothing at all when nothing is required", async () => {
    // A repair may be a repair — somebody cleaned a contact and it worked.
    const { part, repair } = await withRules();
    expect((await service(part.id, repair.id, [])).statusCode).toBe(201);
  });

  it("leaves a kind with no rules unrestricted", async () => {
    // Which is how every kind behaved before rules existed, so adding them
    // breaks nothing that predates them.
    const { part, toner } = await setUp();
    const loose = (
      await inject("POST", "/part-service-kinds", { name: "Deep clean", defaultPoints: 1 })
    ).json();
    expect(
      (await service(part.id, loose.id, [{ consumableId: toner.id, quantity: 9 }])).statusCode,
    ).toBe(201);
  });
});

describe("the reversal", () => {
  it("takes the points back when the part comes straight back faulty — once", async () => {
    const { device, part, refill: kind, toner } = await setUp();

    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    await inject("POST", `/parts/${part.id}/return`, { outcome: "ok" });
    const serviced = (await refill(part.id, kind.id, toner.id)).json();
    expect((await serviceLedger()).total).toBe(5);

    // Out it goes, and back it comes broken.
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    const first = await inject("POST", `/parts/${part.id}/return`, {
      outcome: "faulty",
      note: "Streaking from the first page.",
    });
    // Said out loud on the response: a reversal the technician only discovers on
    // a leaderboard next week is how a scheme stops being believed.
    expect(first.json().pointsReversed).toBe(true);

    let ledger = await serviceLedger();
    expect(ledger.total).toBe(0);
    // Both rows survive. The award is not deleted or edited — the ledger is
    // append-only, and a score dropping with nothing to show for it is worse than
    // one showing the award and its reversal side by side.
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.rows.map((r) => r.points).sort()).toEqual([-5, 5]);
    expect(ledger.rows.some((r) => /reversed — came back faulty/.test(r.detail))).toBe(true);

    // Now the same bad refill fails a second time. Nothing new was done to the
    // part, so there is nothing further to take back: reversing twice would
    // charge somebody 10 for a job that paid 5.
    await inject("POST", `/parts/${part.id}/restock`, {});
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    const second = await inject("POST", `/parts/${part.id}/return`, { outcome: "faulty" });
    expect(second.json().pointsReversed).toBe(false);

    ledger = await serviceLedger();
    expect(ledger.total).toBe(0);
    expect(ledger.rows).toHaveLength(2);

    // The service itself carries the mark, so the history says which refill was
    // the bad one rather than leaving it to be inferred from the ledger.
    const history = (await inject("GET", `/parts/${part.id}/services`)).json();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(serviced.id);
    expect(history[0].pointsReversedAt).not.toBeNull();
  });

  it("leaves the points alone when the part comes back working", async () => {
    const { device, part, refill: kind, toner } = await setUp();
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    await inject("POST", `/parts/${part.id}/return`, { outcome: "ok" });
    await refill(part.id, kind.id, toner.id);

    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    const res = await inject("POST", `/parts/${part.id}/return`, { outcome: "ok" });
    expect(res.json().pointsReversed).toBe(false);
    expect((await serviceLedger()).total).toBe(5);
  });

  it("leaves the points alone once the part has outlived the window", async () => {
    // A zero-day window: anything that lasted at all is outside it. Standing in
    // for the real case — a cartridge that ran for two months and then failed,
    // which is wear rather than a bad refill.
    const { device, part, refill: kind, toner } = await setUp(0);
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    await inject("POST", `/parts/${part.id}/return`, { outcome: "ok" });
    await refill(part.id, kind.id, toner.id);

    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    const res = await inject("POST", `/parts/${part.id}/return`, { outcome: "faulty" });
    expect(res.json().pointsReversed).toBe(false);
    expect((await serviceLedger()).total).toBe(5);
  });

  it("leaves a service that paid nothing unmarked", async () => {
    const { device, part, toner } = await setUp();
    // Some jobs are logged for the history and pay nothing — a company may not
    // score cleaning at all.
    const clean = (
      await inject("POST", "/part-service-kinds", { name: "Clean", defaultPoints: 0 })
    ).json();

    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    await inject("POST", `/parts/${part.id}/return`, { outcome: "ok" });
    await inject("POST", `/parts/${part.id}/services`, {
      serviceKindId: clean.id,
      consumptions: [{ consumableId: toner.id, quantity: 5 }],
    });

    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    expect(
      (await inject("POST", `/parts/${part.id}/return`, { outcome: "faulty" })).json()
        .pointsReversed,
    ).toBe(false);

    // And the event is not stamped: "points reversed" on a job that never paid
    // any would be the record saying something that did not happen.
    const history = (await inject("GET", `/parts/${part.id}/services`)).json();
    expect(history[0]).toMatchObject({ points: 0, pointsReversedAt: null });
  });

  it("has nothing to reverse when the part was never serviced", async () => {
    const { device, part } = await setUp();
    // Registered, deployed straight away, and faulty out of the box. Nobody
    // refilled it, so nobody is charged for it failing.
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id });
    const res = await inject("POST", `/parts/${part.id}/return`, { outcome: "faulty" });
    expect(res.statusCode).toBe(200);
    expect(res.json().pointsReversed).toBe(false);
    expect((await serviceLedger()).total).toBe(0);
  });
});
