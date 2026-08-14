// Author: Brijesh Dave <https://github.com/brijeshdave>
// Service events, what they consumed, and the ledger rows they produce.
//
// The ledger is shared with the journal and the routines, deliberately: a point
// earned refilling a cartridge has to be comparable with a point earned filing
// work, or the leaderboard is two scales pretending to be one.
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  consumables,
  pointAwards,
  serviceConsumptions,
  serviceEvents,
  serviceKinds,
} from "@/core/db/schema.js";

export interface ServiceEventRow {
  id: string;
  partId: string;
  serviceKindId: string;
  serviceKindName: string;
  performedBy: string | null;
  performedByName: string | null;
  performedAt: Date;
  notes: string | null;
  points: number;
  pointsReversedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function eventQuery() {
  return db
    .select({
      id: serviceEvents.id,
      partId: serviceEvents.partId,
      serviceKindId: serviceEvents.serviceKindId,
      serviceKindName: serviceKinds.name,
      performedBy: serviceEvents.performedBy,
      performedByName: sql<string | null>`performer.name`,
      performedAt: serviceEvents.performedAt,
      notes: serviceEvents.notes,
      points: serviceEvents.points,
      pointsReversedAt: serviceEvents.pointsReversedAt,
      createdAt: serviceEvents.createdAt,
      updatedAt: serviceEvents.updatedAt,
    })
    .from(serviceEvents)
    .innerJoin(serviceKinds, eq(serviceKinds.id, serviceEvents.serviceKindId))
    .leftJoin(sql`users performer`, sql`performer.id = ${serviceEvents.performedBy}`);
}

export async function eventsFor(partId: string, companyId: string): Promise<ServiceEventRow[]> {
  return eventQuery()
    .where(and(eq(serviceEvents.partId, partId), eq(serviceEvents.companyId, companyId)))
    .orderBy(desc(serviceEvents.performedAt));
}

export async function getEvent(id: string, companyId: string): Promise<ServiceEventRow | null> {
  const [row] = await eventQuery().where(
    and(eq(serviceEvents.id, id), eq(serviceEvents.companyId, companyId)),
  );
  return row ?? null;
}

/**
 * The last service before a given moment, and not yet reversed.
 *
 * This is what a faulty return reverses. Bounded by `before` — the moment the
 * part went into the machine — because a service performed *after* it came out
 * cannot be what made it fail.
 */
export async function lastServiceBefore(
  partId: string,
  companyId: string,
  before: Date,
): Promise<ServiceEventRow | null> {
  const [row] = await eventQuery()
    .where(
      and(
        eq(serviceEvents.partId, partId),
        eq(serviceEvents.companyId, companyId),
        lt(serviceEvents.performedAt, before),
        isNull(serviceEvents.pointsReversedAt),
      ),
    )
    .orderBy(desc(serviceEvents.performedAt));
  return row ?? null;
}

export interface ConsumptionRow {
  consumableId: string;
  consumableName: string;
  unit: string;
  quantity: number;
}

export async function consumptionsFor(serviceEventId: string): Promise<ConsumptionRow[]> {
  return db
    .select({
      consumableId: serviceConsumptions.consumableId,
      consumableName: consumables.name,
      unit: consumables.unit,
      quantity: serviceConsumptions.quantity,
    })
    .from(serviceConsumptions)
    .innerJoin(consumables, eq(consumables.id, serviceConsumptions.consumableId))
    .where(eq(serviceConsumptions.serviceEventId, serviceEventId));
}

/**
 * Write the service, its consumption lines, and its ledger entry as one.
 *
 * In a transaction because a service event without its award pays nobody, and an
 * award without its event is points from nowhere. Either both land or neither
 * does.
 */
export async function insertService(
  companyId: string,
  values: {
    partId: string;
    serviceKindId: string;
    performedBy: string;
    performedAt: Date;
    notes: string | null;
    points: number;
    departmentId: string | null;
    consumptions: { consumableId: string; quantity: number }[];
  },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .insert(serviceEvents)
      .values({
        companyId,
        partId: values.partId,
        serviceKindId: values.serviceKindId,
        performedBy: values.performedBy,
        performedAt: values.performedAt,
        notes: values.notes,
        points: values.points,
      })
      .returning({ id: serviceEvents.id });

    if (values.consumptions.length > 0) {
      await tx.insert(serviceConsumptions).values(
        values.consumptions.map((line) => ({
          serviceEventId: event!.id,
          consumableId: line.consumableId,
          quantity: line.quantity,
        })),
      );
    }

    // A zero-point service still happened and still belongs in the history; it
    // just has nothing to pay, and a zero row in the ledger is noise.
    if (values.points > 0) {
      await tx.insert(pointAwards).values({
        beneficiaryUserId: values.performedBy,
        companyId,
        earnedOn: values.performedAt.toISOString().slice(0, 10),
        departmentId: values.departmentId,
        source: "service",
        reportId: null,
        routineId: null,
        serviceEventId: event!.id,
        kind: "direct",
        depth: 0,
        points: values.points,
      });
    }

    return event!.id;
  });
}

/**
 * Reverse a service's points with a compensating entry.
 *
 * A new row with the negative amount, pointing at the original — never a delete
 * or an edit. The ledger is frozen by design, and a technician's score dropping
 * with nothing to show for it is worse than one showing the award and its
 * reversal side by side.
 *
 * Returns false when there was nothing to reverse, so the caller can tell "no
 * points were at stake" from "reversed".
 */
export async function reverseService(serviceEventId: string, companyId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select({
        id: serviceEvents.id,
        points: serviceEvents.points,
        reversedAt: serviceEvents.pointsReversedAt,
      })
      .from(serviceEvents)
      .where(and(eq(serviceEvents.id, serviceEventId), eq(serviceEvents.companyId, companyId)));

    // Already reversed: do nothing, twice is not a reversal.
    if (!event || event.reversedAt !== null) return false;

    // A service that paid nothing has nothing to take back. Stamping
    // `pointsReversedAt` on it would leave the history saying points were
    // reversed when none ever existed.
    if (event.points <= 0) return false;

    // Found before anything is written, so a missing award — which should be
    // impossible — leaves the event untouched rather than marked reversed with
    // nothing behind the mark.
    const [original] = await tx
      .select()
      .from(pointAwards)
      .where(
        and(eq(pointAwards.serviceEventId, serviceEventId), isNull(pointAwards.reversesAwardId)),
      );
    if (!original) return false;

    await tx
      .update(serviceEvents)
      .set({ pointsReversedAt: new Date(), updatedAt: new Date() })
      .where(eq(serviceEvents.id, serviceEventId));

    await tx.insert(pointAwards).values({
      beneficiaryUserId: original.beneficiaryUserId,
      companyId,
      // Dated today, not backdated to the original: the reversal is a thing that
      // happened now. Backdating would quietly rewrite a month that may already
      // have been reported on.
      earnedOn: new Date().toISOString().slice(0, 10),
      departmentId: original.departmentId,
      source: "service",
      reportId: null,
      routineId: null,
      serviceEventId,
      reversesAwardId: original.id,
      kind: "direct",
      depth: 0,
      points: -original.points,
    });
    return true;
  });
}
