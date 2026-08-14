// Author: Brijesh Dave <https://github.com/brijeshdave>
// What a cartridge printed, end to end.
//
// The arithmetic is unit-tested in shared. What this proves is the part the unit
// tests cannot: that the reading taken at install survives the weeks in between,
// comes back attached to the right tour, and that a second tour of the same part
// keeps its own pair rather than borrowing the first one's.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { PARTS_MODULE, pagesFor } from "@reportly/shared";
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

async function setUp() {
  await setCompanySetting(PARTS_MODULE, DEMO_COMPANY_ID, { enabled: true, failureWindowDays: 14 });

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
      ratedPageYield: 2300,
      compatibleDeviceTypeIds: [type.id],
    })
  ).json();
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
  return { device, model, part };
}

/** One tour: in at `start`, out at `end` (or with a typed count). */
async function tour(
  partId: string,
  deviceId: string,
  ends: { meterStart?: number; meterEnd?: number; pagesPrinted?: number },
) {
  await inject("POST", `/parts/${partId}/deploy`, {
    deviceId,
    ...(ends.meterStart !== undefined ? { meterStart: ends.meterStart } : {}),
  });
  await inject("POST", `/parts/${partId}/return`, {
    outcome: "ok",
    ...(ends.meterEnd !== undefined ? { meterEnd: ends.meterEnd } : {}),
    ...(ends.pagesPrinted !== undefined ? { pagesPrinted: ends.pagesPrinted } : {}),
  });
  await inject("POST", `/parts/${partId}/restock`, {});
}

describe("page counts", () => {
  it("keeps the reading taken at install and pairs it with the one taken at return", async () => {
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 48_120, meterEnd: 49_970 });

    const [latest] = (await inject("GET", `/parts/${part.id}/history`)).json();
    expect(latest).toMatchObject({ meterStart: 48_120, meterEnd: 49_970 });
    // Derived by the same function the screens call, so the two cannot disagree.
    expect(pagesFor(latest)).toEqual({ pages: 1850, from: "meters" });
  });

  it("gives each tour its own pair", async () => {
    // The bug this guards: a second tour reading the first tour's start, which
    // would quietly report the whole life of the cartridge as one refill's yield.
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 1000, meterEnd: 2000 });
    await tour(part.id, device.id, { meterStart: 5000, meterEnd: 5600 });

    const history = (await inject("GET", `/parts/${part.id}/history`)).json();
    expect(history).toHaveLength(2);
    // Newest first.
    expect(pagesFor(history[0]).pages).toBe(600);
    expect(pagesFor(history[1]).pages).toBe(1000);
  });

  it("accepts a typed count where there is no meter to read", async () => {
    const { device, part } = await setUp();
    await tour(part.id, device.id, { pagesPrinted: 1420 });

    const [latest] = (await inject("GET", `/parts/${part.id}/history`)).json();
    expect(latest).toMatchObject({ meterStart: null, meterEnd: null, pagesPrinted: 1420 });
    expect(pagesFor(latest)).toEqual({ pages: 1420, from: "entered" });
  });

  it("records nothing rather than a zero when nobody read anything", async () => {
    // A team that does not read meters still gets a working module. Null here is
    // "not known"; a zero would say the cartridge printed nothing.
    const { device, part } = await setUp();
    await tour(part.id, device.id, {});

    const [latest] = (await inject("GET", `/parts/${part.id}/history`)).json();
    expect(latest).toMatchObject({ meterStart: null, meterEnd: null, pagesPrinted: null });
    expect(pagesFor(latest)).toEqual({ pages: null, from: "unknown" });
  });

  it("stores a backwards meter as it was read, and reports it as a reset", async () => {
    // The reading is kept exactly as the person typed it — correcting it here
    // would destroy the evidence that the printer was swapped. The judgement is
    // made when the number is displayed, not when it is stored.
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 49_970, meterEnd: 120 });

    const [latest] = (await inject("GET", `/parts/${part.id}/history`)).json();
    expect(latest).toMatchObject({ meterStart: 49_970, meterEnd: 120 });
    expect(pagesFor(latest)).toEqual({ pages: null, from: "meter-reset" });
  });

  it("carries the model's rated yield to compare against", async () => {
    const { model } = await setUp();
    expect((await inject("GET", `/part-models/${model.id}`)).json().ratedPageYield).toBe(2300);

    // And null stays a legitimate answer for a model with no published figure.
    const plain = (await inject("POST", "/part-models", { name: "Unbranded refill kit" })).json();
    expect(plain.ratedPageYield).toBeNull();
  });
});

describe("the timeline", () => {
  it("merges installs, returns and services into one sequence, newest first", async () => {
    // Two lists side by side read fine and analysed badly. This is the one
    // sequence — and a placement contributes two entries, because it went in and
    // came out weeks apart.
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 1000, meterEnd: 2600 });

    const events = (await inject("GET", `/parts/${part.id}/timeline`)).json();
    expect(events.map((e: { kind: string }) => e.kind)).toEqual([
      "removed",
      "installed",
      "registered",
    ]);

    const removed = events[0];
    // The raw readings travel with it, so every screen derives the count with the
    // one function rather than the server pre-formatting a number.
    expect(removed).toMatchObject({
      meterStart: 1000,
      meterEnd: 2600,
      deviceName: "Reception LJ-01",
    });
    expect(pagesFor(removed).pages).toBe(1600);
  });

  it("starts at registration, which nothing else records", async () => {
    const { part } = await setUp();
    const events = (await inject("GET", `/parts/${part.id}/timeline`)).json();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "registered", actorName: null });
  });
});
