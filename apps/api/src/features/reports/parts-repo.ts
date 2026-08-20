// Author: Brijesh Dave <https://github.com/brijeshdave>
// The cartridge reports' data.
//
// Here rather than in `features/parts` on purpose. That module is optional and
// must stay removable, which the isolation guard enforces by refusing any import
// of it from outside — so reports reads the tables through `core/db` exactly as
// it does the journal's, and depends on the module not at all.
import type { AuthContext } from "@reportly/shared";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { withLocationsNullable } from "@/core/db/scoped.js";
import {
  consumables,
  deviceTypes,
  devices,
  locations,
  partModels,
  partPlacements,
  parts,
  serviceConsumptions,
  serviceEvents,
  serviceKinds,
  users,
} from "@/core/db/schema.js";

export interface RegisterRow {
  id: string;
  identifier: string;
  modelName: string;
  status: string;
  cycleCount: number;
  cycleLimit: number | null;
  ratedPageYield: number | null;
  locationName: string | null;
  deviceName: string | null;
}

/** Every cartridge, with where it is now. The register, as a report. */
export async function registerRows(ctx: AuthContext, companyId: string): Promise<RegisterRow[]> {
  return (
    db
      .select({
        id: parts.id,
        identifier: parts.identifier,
        modelName: partModels.name,
        status: parts.status,
        cycleCount: parts.cycleCount,
        cycleLimit: partModels.cycleLimit,
        ratedPageYield: partModels.ratedPageYield,
        locationName: locations.name,
        // The open placement's device, if it is in one. A left join on "no removal
        // yet" rather than a second query per row.
        deviceName: sql<string | null>`(
        SELECT d.name FROM part_placements pl
        JOIN devices d ON d.id = pl.device_id
        WHERE pl.part_id = ${parts.id} AND pl.removed_at IS NULL
        ORDER BY pl.installed_at DESC LIMIT 1
      )`,
      })
      .from(parts)
      .innerJoin(partModels, eq(partModels.id, parts.partModelId))
      .leftJoin(locations, eq(locations.id, parts.locationId))
      // A part not yet placed anywhere is visible to everybody — it is unplaced, not
      // secret — which is why this is the nullable helper.
      .where(and(eq(parts.companyId, companyId), withLocationsNullable(ctx, parts.locationId)))
      .orderBy(parts.identifier)
  );
}

export interface ServiceRow {
  id: string;
  performedAt: Date;
  partId: string;
  identifier: string;
  serviceKindName: string;
  personName: string | null;
  points: number;
  pointsReversedAt: Date | null;
}

/** One row per refill or repair in the window. */
export async function serviceRows(
  ctx: AuthContext,
  companyId: string,
  from: Date,
  to: Date,
  personIds?: string[],
): Promise<ServiceRow[]> {
  return db
    .select({
      id: serviceEvents.id,
      performedAt: serviceEvents.performedAt,
      partId: parts.id,
      identifier: parts.identifier,
      serviceKindName: serviceKinds.name,
      personName: users.name,
      points: serviceEvents.points,
      pointsReversedAt: serviceEvents.pointsReversedAt,
    })
    .from(serviceEvents)
    .innerJoin(parts, eq(parts.id, serviceEvents.partId))
    .innerJoin(serviceKinds, eq(serviceKinds.id, serviceEvents.serviceKindId))
    .leftJoin(users, eq(users.id, serviceEvents.performedBy))
    .where(
      and(
        eq(serviceEvents.companyId, companyId),
        // The part's site, not the event's: a service is performed on a cartridge,
        // and the cartridge is the thing that lives somewhere.
        withLocationsNullable(ctx, parts.locationId),
        gte(serviceEvents.performedAt, from),
        lt(serviceEvents.performedAt, to),
        personIds?.length ? inArray(serviceEvents.performedBy, personIds) : undefined,
      ),
    )
    .orderBy(sql`${serviceEvents.performedAt} DESC`);
}

/** What each service used, so the log can say it without a query per row. */
export async function consumptionsForServices(
  serviceIds: string[],
): Promise<Map<string, { name: string; unit: string; quantity: number }[]>> {
  const out = new Map<string, { name: string; unit: string; quantity: number }[]>();
  if (serviceIds.length === 0) return out;
  const rows = await db
    .select({
      serviceEventId: serviceConsumptions.serviceEventId,
      name: consumables.name,
      unit: consumables.unit,
      quantity: serviceConsumptions.quantity,
    })
    .from(serviceConsumptions)
    .innerJoin(consumables, eq(consumables.id, serviceConsumptions.consumableId))
    .where(inArray(serviceConsumptions.serviceEventId, serviceIds));
  for (const row of rows) {
    out.set(row.serviceEventId, [
      ...(out.get(row.serviceEventId) ?? []),
      { name: row.name, unit: row.unit, quantity: row.quantity },
    ]);
  }
  return out;
}

/**
 * How much of each consumable went, over a window.
 *
 * A usage total, not a stock level. This module records what jobs consumed and
 * has never known what is in the cupboard — see the module's own docs.
 */
export async function consumptionTotals(
  ctx: AuthContext,
  companyId: string,
  from: Date,
  to: Date,
  personIds?: string[],
): Promise<{ name: string; unit: string; quantity: number; jobs: number }[]> {
  return db
    .select({
      name: consumables.name,
      unit: consumables.unit,
      quantity: sql<number>`sum(${serviceConsumptions.quantity})::float`,
      jobs: sql<number>`count(distinct ${serviceEvents.id})::int`,
    })
    .from(serviceConsumptions)
    .innerJoin(serviceEvents, eq(serviceEvents.id, serviceConsumptions.serviceEventId))
    .innerJoin(parts, eq(parts.id, serviceEvents.partId))
    .innerJoin(consumables, eq(consumables.id, serviceConsumptions.consumableId))
    .where(
      and(
        eq(serviceEvents.companyId, companyId),
        // Joined to the part purely to reach its site: totals must count only what
        // was used on cartridges the reader may see.
        withLocationsNullable(ctx, parts.locationId),
        gte(serviceEvents.performedAt, from),
        lt(serviceEvents.performedAt, to),
        personIds?.length ? inArray(serviceEvents.performedBy, personIds) : undefined,
      ),
    )
    .groupBy(consumables.name, consumables.unit)
    .orderBy(sql`sum(${serviceConsumptions.quantity}) DESC`);
}

export interface FailureRow {
  placementId: string;
  identifier: string;
  deviceName: string;
  installedAt: Date;
  /** Never null in practice — the query only takes finished tours — but typed as
   *  the column is, because a cast that merely asserts otherwise is how a string
   *  reached code calling `.getTime()` on it. */
  removedAt: Date | null;
  removedByName: string | null;
  meterStart: number | null;
  meterEnd: number | null;
  pagesPrinted: number | null;
  serviceKindName: string | null;
  servicedByName: string | null;
  /** The service this failure follows, so a workload report can mark it. */
  serviceEventId: string | null;
  servicedById: string | null;
  pointsReversedAt: Date | null;
}

/**
 * Every faulty return in the window, with the service it had been given first.
 *
 * The service is found the same way the reversal finds it — the last one before
 * the part went in — so this report and the points agree about which piece of
 * work a failure follows. A correlated subquery rather than a join, because
 * "the latest row before a timestamp" is exactly what a join cannot express
 * without a window function and a wrapper.
 */
export async function failureRows(
  ctx: AuthContext,
  companyId: string,
  from: Date,
  to: Date,
): Promise<FailureRow[]> {
  return db
    .select({
      placementId: partPlacements.id,
      identifier: parts.identifier,
      deviceName: devices.name,
      installedAt: partPlacements.installedAt,
      removedAt: partPlacements.removedAt,
      removedByName: sql<string | null>`remover.name`,
      meterStart: partPlacements.meterStart,
      meterEnd: partPlacements.meterEnd,
      pagesPrinted: partPlacements.pagesPrinted,
      serviceKindName: sql<string | null>`(
        SELECT sk.name FROM service_events se
        JOIN service_kinds sk ON sk.id = se.service_kind_id
        WHERE se.part_id = ${partPlacements.partId}
          AND se.performed_at < ${partPlacements.installedAt}
        ORDER BY se.performed_at DESC LIMIT 1
      )`,
      servicedByName: sql<string | null>`(
        SELECT u.name FROM service_events se
        JOIN users u ON u.id = se.performed_by
        WHERE se.part_id = ${partPlacements.partId}
          AND se.performed_at < ${partPlacements.installedAt}
        ORDER BY se.performed_at DESC LIMIT 1
      )`,
      servicedById: sql<string | null>`(
        SELECT se.performed_by FROM service_events se
        WHERE se.part_id = ${partPlacements.partId}
          AND se.performed_at < ${partPlacements.installedAt}
        ORDER BY se.performed_at DESC LIMIT 1
      )`,
      serviceEventId: sql<string | null>`(
        SELECT se.id FROM service_events se
        WHERE se.part_id = ${partPlacements.partId}
          AND se.performed_at < ${partPlacements.installedAt}
        ORDER BY se.performed_at DESC LIMIT 1
      )`,
      pointsReversedAt: sql<Date | null>`(
        SELECT se.points_reversed_at FROM service_events se
        WHERE se.part_id = ${partPlacements.partId}
          AND se.performed_at < ${partPlacements.installedAt}
        ORDER BY se.performed_at DESC LIMIT 1
      )`,
    })
    .from(partPlacements)
    .innerJoin(parts, eq(parts.id, partPlacements.partId))
    .innerJoin(devices, eq(devices.id, partPlacements.deviceId))
    .leftJoin(sql`users remover`, sql`remover.id = ${partPlacements.removedBy}`)
    .where(
      and(
        eq(partPlacements.companyId, companyId),
        // The device the part sat in is the thing at a site.
        withLocationsNullable(ctx, devices.locationId),
        eq(partPlacements.outcome, "faulty"),
        sql`${partPlacements.removedAt} IS NOT NULL`,
        gte(partPlacements.removedAt, from),
        lt(partPlacements.removedAt, to),
      ),
    )
    .orderBy(sql`${partPlacements.removedAt} DESC`);
}

export interface TourRow {
  partId: string;
  identifier: string;
  modelName: string;
  ratedPageYield: number | null;
  deviceId: string;
  deviceName: string;
  deviceTypeName: string | null;
  outcome: string | null;
  meterStart: number | null;
  meterEnd: number | null;
  pagesPrinted: number | null;
}

/**
 * Every finished tour of duty in the window — the raw material for both health
 * reports.
 *
 * Returned unaggregated so the page counts are derived by the one shared
 * `pagesFor`, rather than a second implementation of that arithmetic in SQL.
 */
export async function finishedTours(
  ctx: AuthContext,
  companyId: string,
  from: Date,
  to: Date,
): Promise<TourRow[]> {
  return db
    .select({
      partId: parts.id,
      identifier: parts.identifier,
      modelName: partModels.name,
      ratedPageYield: partModels.ratedPageYield,
      deviceId: devices.id,
      deviceName: devices.name,
      deviceTypeName: deviceTypes.name,
      outcome: partPlacements.outcome,
      meterStart: partPlacements.meterStart,
      meterEnd: partPlacements.meterEnd,
      pagesPrinted: partPlacements.pagesPrinted,
    })
    .from(partPlacements)
    .innerJoin(parts, eq(parts.id, partPlacements.partId))
    .innerJoin(partModels, eq(partModels.id, parts.partModelId))
    .innerJoin(devices, eq(devices.id, partPlacements.deviceId))
    .leftJoin(deviceTypes, eq(deviceTypes.id, devices.typeId))
    .where(
      and(
        eq(partPlacements.companyId, companyId),
        withLocationsNullable(ctx, devices.locationId),
        sql`${partPlacements.removedAt} IS NOT NULL`,
        gte(partPlacements.removedAt, from),
        lt(partPlacements.removedAt, to),
      ),
    );
}
