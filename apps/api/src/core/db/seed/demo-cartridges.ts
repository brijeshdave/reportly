// Author: Brijesh Dave <https://github.com/brijeshdave>
// `cli seed:demo-cartridges` — a fleet of invented cartridges with a history.
//
// Separate from `seed:demo`, which refuses to run on a database holding real
// work. That refusal is right: eight invented people in a real roster is a mess
// to explain. But a company evaluating the cartridges module has a catalogue and
// two cartridges, and the health reports need a population before they say
// anything — so this adds ONLY cartridges and their history, using the company's
// own models, printers, service kinds and consumables rather than a parallel set
// of fictional ones.
//
// Every identifier is prefixed `DEMO-`, so what it wrote can be found and removed
// in one statement. It is idempotent: a second run adds nothing.
import { and, eq, inArray } from "drizzle-orm";

import { db, type Database } from "@/core/db/index.js";
import {
  consumables,
  devices,
  partModelCompatibility,
  partModels,
  partPlacements,
  parts,
  pointAwards,
  serviceConsumptions,
  serviceEvents,
  serviceKindConsumables,
  serviceKinds,
  userCompanies,
  users,
} from "@/core/db/schema.js";

/** How many cartridges to invent. Enough for a health report to rank. */
const FLEET = 10;
const PREFIX = "DEMO-";

export interface DemoCartridgeResult {
  created: number;
  skipped: boolean;
  reason?: string;
}

export async function seedDemoCartridges(
  companyId: string,
  database: Database = db,
  now = new Date(),
): Promise<DemoCartridgeResult> {
  const already = await database
    .select({ id: parts.id })
    .from(parts)
    .where(and(eq(parts.companyId, companyId), inArray(parts.identifier, [`${PREFIX}01`])));
  if (already.length > 0) return { created: 0, skipped: true, reason: "already seeded" };

  // The company's own catalogue. Nothing here invents a model or a printer: a
  // demo fleet of parts that fit nothing the company owns would demonstrate the
  // reports and nothing else.
  const models = await database
    .select({ id: partModels.id, name: partModels.name, rated: partModels.ratedPageYield })
    .from(partModels)
    .where(and(eq(partModels.companyId, companyId), eq(partModels.status, "active")));
  if (models.length === 0) {
    return {
      created: 0,
      skipped: true,
      reason: "no cartridge models — add one in Cartridge setup",
    };
  }

  const kinds = await database
    .select({ id: serviceKinds.id, name: serviceKinds.name, points: serviceKinds.defaultPoints })
    .from(serviceKinds)
    .where(and(eq(serviceKinds.companyId, companyId), eq(serviceKinds.status, "active")));
  if (kinds.length === 0) {
    return { created: 0, skipped: true, reason: "no service kinds — add one in Cartridge setup" };
  }

  const compat = await database
    .select({
      partModelId: partModelCompatibility.partModelId,
      deviceId: devices.id,
    })
    .from(partModelCompatibility)
    .innerJoin(devices, eq(devices.typeId, partModelCompatibility.deviceTypeId))
    .where(eq(devices.companyId, companyId));
  const devicesByModel = new Map<string, string[]>();
  for (const row of compat) {
    devicesByModel.set(row.partModelId, [
      ...(devicesByModel.get(row.partModelId) ?? []),
      row.deviceId,
    ]);
  }
  if (devicesByModel.size === 0) {
    return {
      created: 0,
      skipped: true,
      reason:
        "no printer fits any model — set 'Fits' on a model, and register a device of that type",
    };
  }

  // What each kind may consume, so the invented jobs obey the same rules the app
  // enforces. A refill that recorded a drum would be demo data contradicting the
  // product it is demonstrating.
  const rules = await database
    .select({
      serviceKindId: serviceKindConsumables.serviceKindId,
      consumableId: serviceKindConsumables.consumableId,
      minQuantity: serviceKindConsumables.minQuantity,
    })
    .from(serviceKindConsumables)
    .where(
      inArray(
        serviceKindConsumables.serviceKindId,
        kinds.map((kind) => kind.id),
      ),
    );
  const allConsumables = await database
    .select({ id: consumables.id })
    .from(consumables)
    .where(and(eq(consumables.companyId, companyId), eq(consumables.status, "active")));
  const consumablesFor = (kindId: string): { id: string; quantity: number }[] => {
    const own = rules.filter((rule) => rule.serviceKindId === kindId);
    if (own.length > 0) {
      return own.map((rule) => ({
        id: rule.consumableId,
        quantity: Math.max(rule.minQuantity, 1),
      }));
    }
    // Unrestricted kind: use the first consumable so the line is not empty.
    return allConsumables.slice(0, 1).map((row) => ({ id: row.id, quantity: 1 }));
  };

  // Somebody to credit. A real member of the company, so the points land where a
  // person can see them.
  const [person] = await database
    .select({ id: users.id })
    .from(userCompanies)
    .innerJoin(users, eq(users.id, userCompanies.userId))
    .where(and(eq(userCompanies.companyId, companyId), eq(users.status, "active")))
    .limit(1);
  const performedBy = person?.id ?? null;

  const day = (back: number) => new Date(now.getTime() - back * 24 * 60 * 60 * 1000);
  const partRows: (typeof parts.$inferInsert)[] = [];
  const placementRows: (typeof partPlacements.$inferInsert)[] = [];
  const eventRows: (typeof serviceEvents.$inferInsert)[] = [];
  const consumptionRows: (typeof serviceConsumptions.$inferInsert)[] = [];
  const awardRows: (typeof pointAwards.$inferInsert)[] = [];

  const modelsWithDevices = models.filter((model) => devicesByModel.has(model.id));

  for (let n = 0; n < FLEET; n += 1) {
    const model = modelsWithDevices[n % modelsWithDevices.length]!;
    const fitting = devicesByModel.get(model.id)!;
    const partId = crypto.randomUUID();
    // Two of the ten fail early every time. Without them the health reports are a
    // list of things that are fine, which proves nothing about a report built to
    // find trouble.
    const dud = n === 2 || n === 6;
    const tours = 2 + (n % 3);
    let cycles = 0;

    for (let t = 0; t < tours; t += 1) {
      const deviceId = fitting[(n + t) % fitting.length]!;
      const kind = kinds[dud && t === 1 ? Math.min(1, kinds.length - 1) : 0]!;
      const serviced = day(80 - t * 22 - n);
      const installed = day(78 - t * 22 - n);
      const removed = day(64 - t * 22 - n);

      const eventId = crypto.randomUUID();
      eventRows.push({
        id: eventId,
        companyId,
        partId,
        serviceKindId: kind.id,
        performedBy,
        performedAt: serviced,
        notes: "Demo data.",
        points: kind.points,
        pointsReversedAt: dud && t === 0 ? removed : null,
      });
      for (const line of consumablesFor(kind.id)) {
        consumptionRows.push({
          id: crypto.randomUUID(),
          serviceEventId: eventId,
          consumableId: line.id,
          quantity: line.quantity,
        });
      }

      if (performedBy && kind.points > 0) {
        const awardId = crypto.randomUUID();
        awardRows.push({
          id: awardId,
          beneficiaryUserId: performedBy,
          companyId,
          earnedOn: serviced.toISOString().slice(0, 10),
          source: "service",
          serviceEventId: eventId,
          kind: "direct",
          depth: 0,
          points: kind.points,
        });
        if (dud && t === 0) {
          awardRows.push({
            id: crypto.randomUUID(),
            beneficiaryUserId: performedBy,
            companyId,
            earnedOn: removed.toISOString().slice(0, 10),
            source: "service",
            serviceEventId: eventId,
            reversesAwardId: awardId,
            kind: "direct",
            depth: 0,
            points: -kind.points,
          });
        }
      }
      cycles += 1;

      // A healthy cartridge gives most of what its model is rated for; a dud a
      // fraction of it. Where the model states no rating, plausible absolutes.
      const rated = model.rated ?? 2_000;
      const meterStart = 10_000 + n * 3_000 + t * 4_000;
      const yielded = dud
        ? Math.round(rated * 0.2) + n * 10
        : Math.round(rated * 0.85) + ((n * 137) % 200);
      placementRows.push({
        id: crypto.randomUUID(),
        companyId,
        partId,
        deviceId,
        installedAt: installed,
        installedBy: performedBy,
        removedAt: removed,
        removedBy: performedBy,
        outcome: dud ? "faulty" : "ok",
        note: dud ? "Streaking and light print." : null,
        meterStart,
        meterEnd: meterStart + yielded,
      });
    }

    partRows.push({
      id: partId,
      companyId,
      partModelId: model.id,
      identifier: `${PREFIX}${String(n + 1).padStart(2, "0")}`,
      // All back from their last tour, which is the queue the register filters on.
      status: "needs_service",
      cycleCount: cycles,
      notes: dud ? "Demo data — fails early every time." : "Demo data.",
    });
  }

  await database.transaction(async (tx) => {
    await tx.insert(parts).values(partRows).onConflictDoNothing();
    await tx.insert(partPlacements).values(placementRows).onConflictDoNothing();
    await tx.insert(serviceEvents).values(eventRows).onConflictDoNothing();
    await tx.insert(serviceConsumptions).values(consumptionRows).onConflictDoNothing();
    if (awardRows.length > 0) await tx.insert(pointAwards).values(awardRows).onConflictDoNothing();
  });

  return { created: partRows.length, skipped: false };
}
