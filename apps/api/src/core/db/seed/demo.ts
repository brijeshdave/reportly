// Author: Brijesh Dave <https://github.com/brijeshdave>
// `cli seed:demo` — a populated organisation to look at.
//
// Separate from the structural seed and never automatic. The structural seed is
// what every install needs (permissions, roles, the superadmin); this is fiction,
// and fiction in a real database is worse than an empty one. It refuses to run
// when there is real data, and it is the source the documentation screenshots are
// taken from, so what the docs show is what a fresh `seed:demo` gives you.
//
// Deterministic: fixed ids, and dates derived from a single `now` rather than
// scattered `new Date()` calls. Two runs a second apart produce the same shape,
// which is what makes a screenshot diff meaningful.
import { randomUUID } from "node:crypto";

import { count, eq } from "drizzle-orm";

import { PARTS_MODULE } from "@reportly/shared";

import { db, type Database } from "@/core/db/index.js";
import {
  assets,
  categories,
  consumables,
  departmentUsers,
  deviceTypes,
  devices,
  downtimeEntries,
  journalEntries,
  journalScores,
  journalStatuses,
  journalTargets,
  locations,
  partModelCompatibility,
  partModelServiceRates,
  partModels,
  partPlacements,
  parts,
  pointAwards,
  serviceConsumptions,
  serviceEvents,
  serviceKinds,
  settings,
  severities,
  users,
} from "@/core/db/schema.js";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111"; // the seeded demo company
const DEPT_ENGINEERING = "22222222-2222-2222-2222-222222222221";

/**
 * Fixed ids, so a re-run updates rather than duplicates and a screenshot taken
 * today matches one taken next week. `fill` is a single hex character naming the
 * kind of row; the layout is a valid UUID (8-4-4-4-12) with the version and
 * variant nibbles set, because better-auth and every uuid column want a real one.
 */
const id = (n: number, fill: string): string =>
  `${fill.repeat(8)}-${fill.repeat(4)}-4${fill.repeat(3)}-8${fill.repeat(3)}-${String(n).padStart(12, "0")}`;

interface Person {
  id: string;
  name: string;
  email: string;
  username: string;
  rank: "hod" | "lead" | "member";
  reportsTo: string | null;
}

/**
 * A small line organisation: one head, two leads, five engineers. Deep enough that
 * the reporting line, the downline walk and the roll-up leaderboard all have
 * something to show, small enough to read on a screen.
 */
function people(): Person[] {
  const hod = id(1, "a");
  const leadA = id(2, "a");
  const leadB = id(3, "a");
  return [
    {
      id: hod,
      name: "Priya Raman",
      email: "priya@acme.test",
      username: "priya",
      rank: "hod",
      reportsTo: null,
    },
    {
      id: leadA,
      name: "Daniel Okoro",
      email: "daniel@acme.test",
      username: "daniel",
      rank: "lead",
      reportsTo: hod,
    },
    {
      id: leadB,
      name: "Mei Lin",
      email: "mei@acme.test",
      username: "mei",
      rank: "lead",
      reportsTo: hod,
    },
    {
      id: id(4, "a"),
      name: "Tomas Novak",
      email: "tomas@acme.test",
      username: "tomas",
      rank: "member",
      reportsTo: leadA,
    },
    {
      id: id(5, "a"),
      name: "Aisha Bello",
      email: "aisha@acme.test",
      username: "aisha",
      rank: "member",
      reportsTo: leadA,
    },
    {
      id: id(6, "a"),
      name: "Ravi Shah",
      email: "ravi@acme.test",
      username: "ravi",
      rank: "member",
      reportsTo: leadB,
    },
    {
      id: id(7, "a"),
      name: "Elena Costa",
      email: "elena@acme.test",
      username: "elena",
      rank: "member",
      reportsTo: leadB,
    },
    {
      id: id(8, "a"),
      name: "Jonas Weber",
      email: "jonas@acme.test",
      username: "jonas",
      rank: "member",
      reportsTo: leadB,
    },
  ];
}

const ISSUE_TITLES = [
  "Conveyor belt slipping under load",
  "Hydraulic press losing pressure mid-cycle",
  "Coolant pump tripping the overload",
  "Labeller misfeeding every fortieth unit",
  "Compressor short-cycling overnight",
  "Sensor on the reject gate intermittent",
  "Bearing noise on the outfeed roller",
  "Panel HMI freezing after a shift change",
];

const WORK_TITLES = [
  "Replaced the drive belt and re-tensioned",
  "Reseated the pressure sensor loom",
  "Cleared the coolant strainer",
  "Re-calibrated the labeller feed",
  "Serviced the compressor and drained the receiver",
  "Swapped the reject-gate proximity sensor",
  "Greased the outfeed bearings",
  "Reflashed the HMI and restored the recipe set",
];

/**
 * Refuses on a database that holds real work.
 *
 * The check is journal entries rather than users: a fresh install already has the
 * superadmin, and an organisation that has started using Reportly has entries. An
 * accidental `seed:demo` against production would not destroy anything, but it
 * would put eight invented people into a real roster, and explaining that is
 * worse than the command failing.
 */
async function hasRealData(database: Database): Promise<boolean> {
  const [row] = await database.select({ n: count() }).from(journalEntries);
  return (row?.n ?? 0) > 0;
}

export async function seedDemoData(database: Database = db, now = new Date()): Promise<void> {
  if (await hasRealData(database)) {
    throw new Error(
      "This database already holds journal entries. `seed:demo` writes invented data and " +
        "refuses to run alongside real work — use an empty database.",
    );
  }

  const [site] = await database
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.companyId, COMPANY_ID));
  if (!site) throw new Error("Run `cli seed` first — the demo company and its site are missing.");

  const [severity] = await database.select({ id: severities.id }).from(severities).limit(1);
  const [status] = await database.select({ id: journalStatuses.id }).from(journalStatuses).limit(1);

  const roster = people();

  // 1. People. emailVerified so nobody has to click a link to look at the demo;
  // no password is set, so none of these accounts can actually sign in — the
  // superadmin is still the only way in.
  await database
    .insert(users)
    .values(
      roster.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        emailVerified: true,
        username: p.username,
        displayUsername: p.username,
        status: "active",
      })),
    )
    .onConflictDoNothing();

  await database
    .insert(departmentUsers)
    .values(
      roster.map((p) => ({
        departmentId: DEPT_ENGINEERING,
        userId: p.id,
        rank: p.rank,
        reportsToId: p.reportsTo,
      })),
    )
    .onConflictDoNothing();

  // 2. An asset tree three levels deep, because that is what the cascading picker
  // is for and a two-level tree does not show it working.
  const plant = id(1, "b");
  const lineOne = id(2, "b");
  const lineTwo = id(3, "b");
  await database
    .insert(assets)
    .values([
      { id: plant, companyId: COMPANY_ID, name: "Plant 1", locationId: site.id, parentId: null },
      { id: lineOne, companyId: COMPANY_ID, name: "Line 1", locationId: site.id, parentId: plant },
      { id: lineTwo, companyId: COMPANY_ID, name: "Line 2", locationId: site.id, parentId: plant },
      {
        id: id(4, "b"),
        companyId: COMPANY_ID,
        name: "Filler",
        locationId: site.id,
        parentId: lineOne,
      },
      {
        id: id(5, "b"),
        companyId: COMPANY_ID,
        name: "Capper",
        locationId: site.id,
        parentId: lineOne,
      },
      {
        id: id(6, "b"),
        companyId: COMPANY_ID,
        name: "Labeller",
        locationId: site.id,
        parentId: lineTwo,
      },
      {
        id: id(7, "b"),
        companyId: COMPANY_ID,
        name: "Palletiser",
        locationId: site.id,
        parentId: lineTwo,
      },
    ])
    .onConflictDoNothing();

  await database
    .insert(devices)
    .values([
      {
        id: id(1, "c"),
        companyId: COMPANY_ID,
        name: "Drive motor",
        assetTag: "MTR-0041",
        assetId: lineOne,
        locationId: site.id,
        departmentId: DEPT_ENGINEERING,
      },
      {
        id: id(2, "c"),
        companyId: COMPANY_ID,
        name: "Hydraulic press",
        assetTag: "HYD-0012",
        assetId: lineOne,
        locationId: site.id,
        departmentId: DEPT_ENGINEERING,
      },
      {
        id: id(3, "c"),
        companyId: COMPANY_ID,
        name: "Coolant pump",
        assetTag: "PMP-0007",
        assetId: lineTwo,
        locationId: site.id,
        departmentId: DEPT_ENGINEERING,
      },
      {
        id: id(4, "c"),
        companyId: COMPANY_ID,
        name: "Reject gate sensor",
        assetTag: "SNS-0113",
        assetId: lineTwo,
        locationId: site.id,
        departmentId: DEPT_ENGINEERING,
      },
    ])
    .onConflictDoNothing();

  // Categories are department-scoped, not company-scoped — they are the words one
  // department files against. Seeded here rather than assumed: the structural seed
  // ships no categories, so without these every entry files against nothing and
  // "Issues by category" draws an empty frame. A category per failure mode also
  // gives the recurring-issue analytics something real to group by.
  await database
    .insert(categories)
    .values(
      ["Mechanical", "Electrical", "Hydraulic", "Controls", "Wear and tear"].map((name, i) => ({
        id: id(i + 1, "f"),
        departmentId: DEPT_ENGINEERING,
        name,
      })),
    )
    .onConflictDoNothing();

  const categoryIds = (
    await database
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.departmentId, DEPT_ENGINEERING))
  ).map((c) => c.id);

  // 3. Journal entries spread across the last ten weeks, alternating issue and
  // work, cycling through the team. Spread matters: every date-ranged report and
  // the reliability trend need more than one bucket to draw anything.
  const day = 24 * 60 * 60 * 1000;
  const workers = roster.filter((p) => p.rank !== "hod");
  const entries: (typeof journalEntries.$inferInsert)[] = [];
  for (let i = 0; i < 60; i += 1) {
    const author = workers[i % workers.length]!;
    const isIssue = i % 2 === 0;
    const occurred = new Date(now.getTime() - (i + 1) * 1.2 * day);
    entries.push({
      id: id(i + 1, "e"),
      companyId: COMPANY_ID,
      authorId: author.id,
      kind: isIssue ? "issue" : "work",
      state: "submitted",
      title: isIssue
        ? ISSUE_TITLES[i % ISSUE_TITLES.length]!
        : WORK_TITLES[i % WORK_TITLES.length]!,
      categoryId: categoryIds.length > 0 ? categoryIds[i % categoryIds.length]! : null,
      departmentId: DEPT_ENGINEERING,
      severityId: severity?.id ?? null,
      statusId: status?.id ?? null,
      locationId: site.id,
      reportDate: occurred,
      occurredAt: occurred,
      issueSummary: isIssue ? "Noticed at the start of the shift and confirmed under load." : null,
      workSummary: isIssue ? null : "Carried out and handed back to production.",
    });
  }
  await database.insert(journalEntries).values(entries).onConflictDoNothing();

  // 4. What each entry is about, and — for the issues — how long the thing was
  // down. Analytics is built entirely on these two: without targets a report
  // belongs to no asset and rolls up nowhere, and without downtime every MTBF and
  // MTTR is "nothing failed", which is a true statement about an empty database
  // and a useless one about a demo.
  const LINE_ASSETS = [lineOne, lineTwo];
  await database
    .insert(journalTargets)
    .values(
      entries.map((entry, i) => ({
        reportId: entry.id!,
        targetKind: "asset",
        targetId: LINE_ASSETS[i % LINE_ASSETS.length]!,
      })),
    )
    .onConflictDoNothing();

  const issues = entries.filter((e) => e.kind === "issue");
  await database
    .insert(downtimeEntries)
    .values(
      issues.map((entry, i) => {
        const startedAt = entry.occurredAt as Date;
        // 20 minutes to a bit over four hours, varied so MTTR is a real average
        // rather than one number repeated. Every one is closed: an open downtime
        // counts as a failure but is excluded from the mean, and a demo where
        // nothing ever ends shows MTTR as "nothing closed yet".
        const minutes = 20 + ((i * 37) % 250);
        return {
          id: randomUUID(),
          companyId: COMPANY_ID,
          reportId: entry.id!,
          targetKind: "asset",
          targetId: LINE_ASSETS[i % LINE_ASSETS.length]!,
          reason: "Stopped for the fault above",
          startedAt,
          endedAt: new Date(startedAt.getTime() + minutes * 60 * 1000),
          createdBy: entry.authorId!,
        };
      }),
    )
    .onConflictDoNothing();

  // 5. Score two thirds of them, so the leaderboard has something and the review
  // queue is not empty either. Both tiers, because a one-tier score is not what
  // the model does.
  const scored = entries.slice(0, 40);
  await database
    .insert(journalScores)
    .values(
      scored.flatMap((entry, i) => {
        const points = 3 + (i % 5) * 0.5;
        const author = entry.authorId!;
        const reviewer = roster.find(
          (p) => p.id === workers.find((w) => w.id === author)?.reportsTo,
        );
        return [
          { reportId: entry.id!, subjectUserId: author, tier: "self", raterId: author, points },
          {
            reportId: entry.id!,
            subjectUserId: author,
            tier: "review",
            raterId: reviewer?.id ?? author,
            points: points + (i % 3 === 0 ? 0.5 : 0),
          },
        ];
      }),
    )
    .onConflictDoNothing();

  // 6. The ledger the leaderboard reads. `direct` for the person, `rollup` for
  // each manager above them — which is what makes a head of department's total
  // more than their own filing.
  const byId = new Map(roster.map((p) => [p.id, p]));
  const awards: (typeof pointAwards.$inferInsert)[] = [];
  for (const [i, entry] of scored.entries()) {
    const points = 3 + (i % 5) * 0.5 + (i % 3 === 0 ? 0.5 : 0);
    const earnedOn = (entry.reportDate as Date).toISOString().slice(0, 10);
    awards.push({
      id: randomUUID(),
      beneficiaryUserId: entry.authorId!,
      companyId: COMPANY_ID,
      earnedOn,
      departmentId: DEPT_ENGINEERING,
      source: "journal",
      reportId: entry.id!,
      kind: "direct",
      depth: 0,
      points,
    });
    let above = byId.get(entry.authorId!)?.reportsTo ?? null;
    let depth = 1;
    while (above) {
      awards.push({
        id: randomUUID(),
        beneficiaryUserId: above,
        companyId: COMPANY_ID,
        earnedOn,
        departmentId: DEPT_ENGINEERING,
        source: "journal",
        reportId: entry.id!,
        kind: "rollup",
        depth,
        points,
      });
      above = byId.get(above)?.reportsTo ?? null;
      depth += 1;
    }
  }
  await database.insert(pointAwards).values(awards).onConflictDoNothing();

  await seedCartridges(database, { siteId: site.id, roster, now });
}

/**
 * A working fleet: enough cartridges, tours and services for the reports to have
 * something to say.
 *
 * Four hand-written parts show the four states; these eight give the reports a
 * population — several printers, several technicians, yields that vary, and two
 * cartridges that fail repeatedly so "which of these is abnormal" has an answer
 * rather than an empty table.
 *
 * Deterministic like the rest of the seed: every date derives from `now` and
 * every id from the counter, so two runs produce the same fleet.
 */
async function seedCartridgeFleet(
  database: Database,
  {
    model,
    printers,
    kinds,
    consumables: supplies,
    technicians,
    day,
  }: {
    model: string;
    printers: string[];
    kinds: { refill: string; repair: string };
    consumables: { toner: string; drum: string };
    technicians: Person[];
    day: (back: number) => Date;
  },
): Promise<void> {
  const partRows: (typeof parts.$inferInsert)[] = [];
  const placementRows: (typeof partPlacements.$inferInsert)[] = [];
  const eventRows: (typeof serviceEvents.$inferInsert)[] = [];
  const consumptionRows: (typeof serviceConsumptions.$inferInsert)[] = [];
  const awardRows: (typeof pointAwards.$inferInsert)[] = [];

  let seq = 100;
  const nextId = (fill: string) => id(seq++, fill);

  for (let n = 0; n < 8; n += 1) {
    const partId = id(200 + n, "9");
    const identifier = `TN-01${String(n + 10).padStart(2, "0")}`;
    // Two of the eight are bad: they yield poorly and come back faulty. Without
    // them the health reports are a list of things that are fine, which proves
    // nothing about a report meant to surface trouble.
    const dud = n === 2 || n === 6;
    const tours = 2 + (n % 3);
    let cycles = 0;

    for (let t = 0; t < tours; t += 1) {
      const printer = printers[(n + t) % printers.length]!;
      const technician = technicians[(n + t) % technicians.length]!;
      const serviced = day(80 - t * 22 - n);
      const installed = day(78 - t * 22 - n);
      const removed = day(64 - t * 22 - n);

      // Refill, then out it goes. The service precedes the tour it pays for,
      // which is what the reversal rule reads.
      const eventId = nextId("7");
      const points = 3;
      eventRows.push({
        id: eventId,
        companyId: COMPANY_ID,
        partId,
        serviceKindId: t === 1 && dud ? kinds.repair : kinds.refill,
        performedBy: technician.id,
        performedAt: serviced,
        notes: t === 1 && dud ? "Replaced the drum — heavy wear." : "Cleaned and refilled.",
        points,
        // The dud's first refill is the one its faulty return reverses.
        pointsReversedAt: dud && t === 0 ? removed : null,
      });
      consumptionRows.push({
        id: nextId("6"),
        serviceEventId: eventId,
        consumableId: t === 1 && dud ? supplies.drum : supplies.toner,
        quantity: t === 1 && dud ? 1 : 80 + n,
      });

      const awardId = nextId("5");
      awardRows.push({
        id: awardId,
        beneficiaryUserId: technician.id,
        companyId: COMPANY_ID,
        earnedOn: serviced.toISOString().slice(0, 10),
        source: "service",
        serviceEventId: eventId,
        kind: "direct",
        depth: 0,
        points,
      });
      if (dud && t === 0) {
        awardRows.push({
          id: nextId("5"),
          beneficiaryUserId: technician.id,
          companyId: COMPANY_ID,
          earnedOn: removed.toISOString().slice(0, 10),
          source: "service",
          serviceEventId: eventId,
          reversesAwardId: awardId,
          kind: "direct",
          depth: 0,
          points: -points,
        });
      }
      cycles += 1;

      // A good cartridge gives most of its rated 2,300; a dud gives a fraction.
      const meterStart = 10_000 + n * 3_000 + t * 4_000;
      const yielded = dud ? 400 + n * 30 : 1_900 + ((n * 137) % 500);
      placementRows.push({
        id: nextId("8"),
        companyId: COMPANY_ID,
        partId,
        deviceId: printer,
        installedAt: installed,
        installedBy: technician.id,
        removedAt: removed,
        removedBy: technician.id,
        outcome: dud ? "faulty" : "ok",
        note: dud ? "Streaking and light print." : null,
        meterStart,
        meterEnd: meterStart + yielded,
      });
    }

    partRows.push({
      id: partId,
      companyId: COMPANY_ID,
      partModelId: model,
      identifier,
      // Everything here has come back from its last tour, so it needs service —
      // which is exactly the queue the register's filter is for.
      status: "needs_service",
      cycleCount: cycles,
      notes: dud ? "Fails early every time — consider scrapping." : null,
    });
  }

  await database.insert(parts).values(partRows).onConflictDoNothing();
  await database.insert(partPlacements).values(placementRows).onConflictDoNothing();
  await database.insert(serviceEvents).values(eventRows).onConflictDoNothing();
  await database.insert(serviceConsumptions).values(consumptionRows).onConflictDoNothing();
  await database.insert(pointAwards).values(awardRows).onConflictDoNothing();
}

/**
 * The cartridges module, switched on and populated.
 *
 * Seeded here rather than left empty because the module is off by default: a
 * reader who turns it on to look finds three blank catalogues and no way to tell
 * what it is for. This gives them a workshop mid-flow — one part on a printer,
 * one waiting for a refill, one on the shelf, and one that came back faulty and
 * had its points taken back, which is the rule worth seeing rather than reading.
 */
async function seedCartridges(
  database: Database,
  { siteId, roster, now }: { siteId: string; roster: Person[]; now: Date },
): Promise<void> {
  const technician = roster.find((p) => p.rank === "member") ?? roster[0]!;
  const day = (back: number) => new Date(now.getTime() - back * 24 * 60 * 60 * 1000);

  // Compatibility is by device TYPE, so the printers need one.
  const printerType = id(1, "d");
  await database
    .insert(deviceTypes)
    .values([
      {
        id: printerType,
        departmentId: DEPT_ENGINEERING,
        name: "HP LaserJet M404",
        description: "Office mono laser.",
      },
    ])
    .onConflictDoNothing();

  const receptionPrinter = id(11, "c");
  await database
    .insert(devices)
    .values([
      {
        id: receptionPrinter,
        companyId: COMPANY_ID,
        name: "Reception printer",
        assetTag: "PRN-0001",
        typeId: printerType,
        locationId: siteId,
        departmentId: DEPT_ENGINEERING,
      },
      {
        id: id(12, "c"),
        companyId: COMPANY_ID,
        name: "Stores printer",
        assetTag: "PRN-0002",
        typeId: printerType,
        locationId: siteId,
        departmentId: DEPT_ENGINEERING,
      },
    ])
    .onConflictDoNothing();

  const refill = id(1, "e");
  const repair = id(2, "e");
  await database
    .insert(serviceKinds)
    .values([
      {
        id: refill,
        companyId: COMPANY_ID,
        name: "Refill",
        description: "Clean it out and recharge it with toner.",
        defaultPoints: 3,
      },
      {
        id: repair,
        companyId: COMPANY_ID,
        name: "Repair",
        description: "Replace a drum, blade or chip.",
        defaultPoints: 5,
      },
    ])
    .onConflictDoNothing();

  const toner = id(1, "f");
  const drum = id(2, "f");
  await database
    .insert(consumables)
    .values([
      { id: toner, companyId: COMPANY_ID, name: "Toner powder", unit: "g" },
      { id: drum, companyId: COMPANY_ID, name: "OPC drum", unit: "ea" },
      { id: id(3, "f"), companyId: COMPANY_ID, name: "Wiper blade", unit: "ea" },
      { id: id(4, "f"), companyId: COMPANY_ID, name: "Memory chip", unit: "ea" },
    ])
    .onConflictDoNothing();

  const model = id(1, "a");
  await database
    .insert(partModels)
    .values([
      {
        id: model,
        companyId: COMPANY_ID,
        name: "HP 12A Toner",
        description: "The cartridge the office printers take.",
        cycleLimit: 6,
        ratedPageYield: 2300,
      },
    ])
    .onConflictDoNothing();
  await database
    .insert(partModelCompatibility)
    .values([{ partModelId: model, deviceTypeId: printerType }])
    .onConflictDoNothing();
  // This model pays more than the kind's default for a repair: a big cartridge is
  // a bigger job, which is the whole reason a per-model rate exists.
  await database
    .insert(partModelServiceRates)
    .values([{ partModelId: model, serviceKindId: repair, points: 6 }])
    .onConflictDoNothing();

  const installed = id(1, "9");
  const workshop = id(2, "9");
  const shelf = id(3, "9");
  const failed = id(4, "9");
  await database
    .insert(parts)
    .values([
      {
        id: installed,
        companyId: COMPANY_ID,
        partModelId: model,
        identifier: "TN-0041",
        status: "installed",
        cycleCount: 2,
      },
      {
        id: workshop,
        companyId: COMPANY_ID,
        partModelId: model,
        identifier: "TN-0042",
        status: "needs_service",
        cycleCount: 3,
      },
      {
        id: shelf,
        companyId: COMPANY_ID,
        partModelId: model,
        identifier: "TN-0043",
        status: "ready",
        cycleCount: 1,
        locationId: siteId,
      },
      {
        // Past its rated cycles and still in service, which is deliberate: the
        // limit warns and never blocks.
        id: failed,
        companyId: COMPANY_ID,
        partModelId: model,
        identifier: "TN-0044",
        status: "needs_service",
        cycleCount: 6,
        locationId: siteId,
        notes: "Came back faulty last time out.",
      },
    ])
    .onConflictDoNothing();

  await database
    .insert(partPlacements)
    .values([
      {
        id: id(1, "8"),
        companyId: COMPANY_ID,
        partId: installed,
        deviceId: receptionPrinter,
        installedAt: day(9),
        installedBy: technician.id,
        // Still in the machine, so only the opening reading exists — which is
        // what an open tour looks like.
        meterStart: 48_120,
      },
      {
        id: id(2, "8"),
        companyId: COMPANY_ID,
        partId: workshop,
        deviceId: receptionPrinter,
        installedAt: day(40),
        installedBy: technician.id,
        removedAt: day(11),
        removedBy: technician.id,
        outcome: "ok",
        note: "Ran out — nothing wrong with it.",
        // A good refill: 2,140 pages against a rated 2,300.
        meterStart: 31_400,
        meterEnd: 33_540,
      },
      {
        // Three days in a printer and back broken: inside any sensible window,
        // which is what reversed the refill below.
        id: id(3, "8"),
        companyId: COMPANY_ID,
        partId: failed,
        deviceId: id(12, "c"),
        installedAt: day(8),
        installedBy: technician.id,
        removedAt: day(5),
        removedBy: technician.id,
        outcome: "faulty",
        note: "Streaking from the first page.",
        // 640 pages against a rated 2,300 — under a third, and it came back
        // faulty inside the window, which is why its points were reversed.
        meterStart: 12_060,
        meterEnd: 12_700,
      },
    ])
    .onConflictDoNothing();

  const goodService = id(1, "7");
  const reversedService = id(2, "7");
  await database
    .insert(serviceEvents)
    .values([
      {
        id: goodService,
        companyId: COMPANY_ID,
        partId: installed,
        serviceKindId: refill,
        performedBy: technician.id,
        performedAt: day(10),
        notes: "Cleaned and refilled.",
        points: 3,
      },
      {
        id: reversedService,
        companyId: COMPANY_ID,
        partId: failed,
        serviceKindId: refill,
        performedBy: technician.id,
        performedAt: day(9),
        notes: "Refilled and tested.",
        points: 3,
        // The mark that says these points came back. The award and its reversal
        // both stay in the ledger below — nothing is ever deleted from it.
        pointsReversedAt: day(5),
      },
    ])
    .onConflictDoNothing();

  await database
    .insert(serviceConsumptions)
    .values([
      { id: id(1, "6"), serviceEventId: goodService, consumableId: toner, quantity: 85 },
      { id: id(2, "6"), serviceEventId: goodService, consumableId: drum, quantity: 1 },
      { id: id(3, "6"), serviceEventId: reversedService, consumableId: toner, quantity: 80 },
    ])
    .onConflictDoNothing();

  const paidAward = id(1, "5");
  await database
    .insert(pointAwards)
    .values([
      {
        id: paidAward,
        beneficiaryUserId: technician.id,
        companyId: COMPANY_ID,
        earnedOn: day(10).toISOString().slice(0, 10),
        source: "service",
        serviceEventId: goodService,
        kind: "direct",
        depth: 0,
        points: 3,
      },
      {
        id: id(2, "5"),
        beneficiaryUserId: technician.id,
        companyId: COMPANY_ID,
        earnedOn: day(9).toISOString().slice(0, 10),
        source: "service",
        serviceEventId: reversedService,
        kind: "direct",
        depth: 0,
        points: 3,
      },
      {
        // The compensating entry, dated when the failure was booked in rather
        // than backdated over the award it answers.
        id: id(3, "5"),
        beneficiaryUserId: technician.id,
        companyId: COMPANY_ID,
        earnedOn: day(5).toISOString().slice(0, 10),
        source: "service",
        serviceEventId: reversedService,
        reversesAwardId: id(2, "5"),
        kind: "direct",
        depth: 0,
        points: -3,
      },
    ])
    .onConflictDoNothing();

  await seedCartridgeFleet(database, {
    model,
    printers: [receptionPrinter, id(12, "c")],
    kinds: { refill, repair },
    consumables: { toner, drum },
    technicians: roster.filter((p) => p.rank !== "hod").slice(0, 3),
    day,
  });

  // Last: switch the module on for the demo company, so everything above is
  // reachable the moment somebody signs in.
  await database
    .insert(settings)
    .values({
      namespace: PARTS_MODULE.namespace,
      key: PARTS_MODULE.key,
      scope: "company",
      companyId: COMPANY_ID,
      value: { enabled: true, failureWindowDays: 14 },
    })
    .onConflictDoNothing();
}
