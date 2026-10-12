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
  ends: {
    meterStart?: number;
    meterEnd?: number;
    pagesPrinted?: number;
    /** The printer was replaced or its total cleared, so a lower reading is real. */
    meterReset?: boolean;
  },
) {
  await inject("POST", `/parts/${partId}/deploy`, {
    deviceId,
    ...(ends.meterStart !== undefined ? { meterStart: ends.meterStart } : {}),
    ...(ends.meterReset ? { meterReset: true } : {}),
  });
  await inject("POST", `/parts/${partId}/return`, {
    outcome: "ok",
    ...(ends.meterEnd !== undefined ? { meterEnd: ends.meterEnd } : {}),
    ...(ends.pagesPrinted !== undefined ? { pagesPrinted: ends.pagesPrinted } : {}),
    ...(ends.meterReset ? { meterReset: true } : {}),
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

  it("stores a declared reset as it was read, and reports it as a reset", async () => {
    // The reading is kept exactly as the person typed it — correcting it here
    // would destroy the evidence that the printer was swapped. The judgement is
    // made when the number is displayed, not when it is stored.
    //
    // Saying the counter restarted is now required to get here: a backwards
    // reading that nobody vouches for is refused (below), because accepting them
    // silently is what filled a live register with impossible tours.
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 49_970, meterEnd: 120, meterReset: true });

    const [latest] = (await inject("GET", `/parts/${part.id}/history`)).json();
    expect(latest).toMatchObject({ meterStart: 49_970, meterEnd: 120 });
    expect(pagesFor(latest)).toEqual({ pages: null, from: "meter-reset" });
  });

  it("refuses a reading below the printer's last one unless the reset is declared", async () => {
    // The guard the register needed. A counter only goes up; when one appears to
    // go down it is a replaced machine — worth recording — or somebody read the
    // wrong number, which is what produced tours of minus a hundred thousand pages
    // and one claiming fifty-two thousand in two days.
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 10_000, meterEnd: 12_000 });

    const res = await inject("POST", `/parts/${part.id}/deploy`, {
      deviceId: device.id,
      meterStart: 500,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/does not go down/i);
    // Named for the box it is about, so it lands under the field.
    expect(res.json().error.fields.meterStart).toMatch(/12,000|12000/);
  });

  it("offers the printer's own counter, not the cartridge's", async () => {
    // The thing that made this hard to get right by hand: the counter belongs to
    // the machine and carries on across cartridge swaps, so the next install's
    // reading follows the last *removal* from that printer — not whatever the
    // incoming cartridge read in some other machine.
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 10_000, meterEnd: 12_000 });

    const meter = (await inject("GET", `/devices/${device.id}/meter`)).json();
    expect(meter.last.pages).toBe(12_000);
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

describe("the counter's history", () => {
  // Asked for from use: "on reset there should be a history for tracking all
  // those." A reset is the one legitimate way for the series to go backwards, and
  // it is what tells the page-count reports not to read the drop as pages
  // printed — so a wrong one quietly changes every figure built on it. Being able
  // to see where the breaks are, and who declared them, is how a wrong one is
  // found.
  it("keeps every reading, says where it came from, and names who took it", async () => {
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 10_000, meterEnd: 12_000 });

    const { readings, last } = (await inject("GET", `/devices/${device.id}/meter`)).json();

    expect(readings.map((r: { source: string }) => r.source)).toEqual(["install", "removal"]);
    expect(readings.map((r: { pages: number }) => r.pages)).toEqual([10_000, 12_000]);
    expect(readings[0].readByName).toBeTruthy();
    expect(last.pages).toBe(12_000);
  });

  it("records a declared reset as its own kind, with a reason", async () => {
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 10_000, meterEnd: 12_000 });
    await tour(part.id, device.id, { meterStart: 5, meterEnd: 300, meterReset: true });

    const { readings } = (await inject("GET", `/devices/${device.id}/meter`)).json();
    const reset = readings.find((r: { source: string }) => r.source === "reset");

    expect(reset).toMatchObject({ pages: 5 });
    expect(reset.note).toMatch(/reset|replaced/i);
    // And the series carries on from there rather than being thrown away.
    expect(readings.map((r: { pages: number }) => r.pages)).toEqual([10_000, 12_000, 5, 300]);
  });

  it("takes a reading on a round, between swaps", async () => {
    // The reason this is a first-class thing: between two cartridge swaps a
    // printer may run for months, and its output over any shorter window cannot
    // be worked out from swap readings alone.
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 10_000, meterEnd: 12_000 });

    const made = await inject("POST", `/devices/${device.id}/meter`, {
      pages: 12_600,
      note: "Monthly round",
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ source: "manual", pages: 12_600, note: "Monthly round" });

    const { last } = (await inject("GET", `/devices/${device.id}/meter`)).json();
    expect(last.pages).toBe(12_600);
  });

  it("refuses a reading on a round that goes backwards, like any other", async () => {
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 10_000, meterEnd: 12_000 });

    const res = await inject("POST", `/devices/${device.id}/meter`, { pages: 900 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/does not go down/i);
  });
});

describe("correcting a tour that is already over", () => {
  // The register on a live install carried sixteen closed tours whose numbers
  // could not be right: negatives where a printer had been swapped, one claiming
  // fifty-two thousand pages in two days, several at nought. They predate any
  // checking, and nothing after the fact can say which digit was wrong — so
  // clearing has to be as easy as editing.
  it("changes a reading, and moves the printer's series with it", async () => {
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 10_000, meterEnd: 12_000 });
    const [t] = (await inject("GET", `/parts/${part.id}/history`)).json();

    const res = await inject("PATCH", `/parts/${part.id}/tours/${t.id}`, { meterEnd: 11_000 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()[0]).toMatchObject({ meterStart: 10_000, meterEnd: 11_000 });

    // The series has to follow, or the two page-count reports — one built on
    // tours, one on the series — start disagreeing about the same printer.
    const { last } = (await inject("GET", `/devices/${device.id}/meter`)).json();
    expect(last.pages).toBe(11_000);
  });

  it("clears a reading nobody can recall, rather than demanding a guess", async () => {
    const { device, part } = await setUp();
    await tour(part.id, device.id, { meterStart: 10_000, meterEnd: 62_000 });
    const [t] = (await inject("GET", `/parts/${part.id}/history`)).json();

    const res = await inject("PATCH", `/parts/${part.id}/tours/${t.id}`, { meterEnd: null });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].meterEnd).toBeNull();
    // Cleared, not stored as nought — a reading of zero is a claim.
    expect(pagesFor(res.json()[0])).toEqual({ pages: null, from: "unknown" });

    const { readings } = (await inject("GET", `/devices/${device.id}/meter`)).json();
    expect(readings.map((r: { source: string }) => r.source)).toEqual(["install"]);
  });

  it("refuses to touch a tour that has not finished", async () => {
    // Its end has not happened, and its start is what the next reading is checked
    // against. Correcting either behind the register's back is a different act
    // from repairing finished history.
    const { device, part } = await setUp();
    await inject("POST", `/parts/${part.id}/deploy`, { deviceId: device.id, meterStart: 500 });
    const [open] = (await inject("GET", `/parts/${part.id}/history`)).json();

    const res = await inject("PATCH", `/parts/${part.id}/tours/${open.id}`, { meterStart: 400 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/still in the printer/i);
  });

  it("refuses a tour that belongs to a different cartridge", async () => {
    const { device, part, model } = await setUp();
    await tour(part.id, device.id, { meterStart: 10_000, meterEnd: 12_000 });
    const [t] = (await inject("GET", `/parts/${part.id}/history`)).json();
    const other = (
      await inject("POST", "/parts", { identifier: "TN-OTHER", partModelId: model.id })
    ).json();

    const res = await inject("PATCH", `/parts/${other.id}/tours/${t.id}`, { meterEnd: 1 });
    expect(res.statusCode).toBe(404);
  });
});
