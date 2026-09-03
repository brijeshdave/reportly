// Author: Brijesh Dave <https://github.com/brijeshdave>
// Parts and their tours of duty — the only code that touches those two tables.
//
// Company-scoped on every read and write. A part belongs to one tenant and its
// history belongs with it; a query that forgets which company it is in is SF-006.
import { type SQL, and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { ResolvedListQuery } from "@reportly/shared";

import { db } from "@/core/db/index.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";
import {
  deviceTypes,
  devices,
  locations,
  partModelCompatibility,
  partModels,
  partPlacements,
  parts,
} from "@/core/db/schema.js";

export interface PartRow {
  id: string;
  identifier: string;
  partModelId: string;
  partModelName: string;
  cycleLimit: number | null;
  status: string;
  cycleCount: number;
  locationId: string | null;
  locationName: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The part, its model, and where it sits.
 *
 * The device it is on is NOT here — that lives on the open placement, and joining
 * it in would mean two answers to "where is this" that could disagree. The
 * service asks for the open placement separately when it needs one.
 */
const partColumns = {
  id: parts.id,
  identifier: parts.identifier,
  partModelId: parts.partModelId,
  partModelName: partModels.name,
  cycleLimit: partModels.cycleLimit,
  status: parts.status,
  cycleCount: parts.cycleCount,
  locationId: parts.locationId,
  locationName: locations.name,
  notes: parts.notes,
  createdAt: parts.createdAt,
  updatedAt: parts.updatedAt,
};

function partsQuery() {
  return db
    .select(partColumns)
    .from(parts)
    .innerJoin(partModels, eq(partModels.id, parts.partModelId))
    .leftJoin(locations, eq(locations.id, parts.locationId));
}

/**
 * Sortable and filterable columns.
 *
 * The register is the one screen in this module that grows without limit — a
 * company with three hundred cartridges needs to ask "what is in the workshop"
 * and "which of these is past its cycles" rather than scroll. Paging and sorting
 * are the server's job here, as everywhere else: the browser never sees the rows
 * it is not showing.
 */
const listConfig: ListConfig = {
  columns: {
    identifier: parts.identifier,
    status: parts.status,
    cycleCount: parts.cycleCount,
    partModelId: parts.partModelId,
    locationId: parts.locationId,
    createdAt: parts.createdAt,
    updatedAt: parts.updatedAt,
  },
  defaultSort: parts.identifier,
};

export async function listParts(
  companyId: string,
  query: ResolvedListQuery,
  locationScope: SQL | undefined = undefined,
): Promise<{ rows: PartRow[]; total: number }> {
  const listParts_ = buildListParts(listConfig, query);
  const where = and(eq(parts.companyId, companyId), locationScope, listParts_.where);

  const rows = await partsQuery()
    .where(where)
    .orderBy(listParts_.orderBy)
    .limit(listParts_.limit)
    .offset(listParts_.offset);

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(parts)
    .where(where);

  return { rows, total: counted?.count ?? 0 };
}

/**
 * One cartridge, if the caller's sites reach it.
 *
 * The scope is applied here rather than checked afterwards, so a cartridge at
 * another plant comes back as "not found" instead of "forbidden" — the same answer
 * the register gives, and it does not confirm the thing exists.
 */
export async function getPart(
  id: string,
  companyId: string,
  locationScope: SQL | undefined = undefined,
): Promise<PartRow | null> {
  const [row] = await partsQuery().where(
    and(eq(parts.id, id), eq(parts.companyId, companyId), locationScope),
  );
  return row ?? null;
}

export async function insertPart(
  companyId: string,
  values: {
    identifier: string;
    partModelId: string;
    status?: string;
    locationId?: string | null;
    notes?: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(parts)
    .values({
      companyId,
      identifier: values.identifier,
      partModelId: values.partModelId,
      ...(values.status ? { status: values.status } : {}),
      locationId: values.locationId ?? null,
      notes: values.notes ?? null,
    })
    .returning({ id: parts.id });
  return row!.id;
}

export async function updatePart(
  id: string,
  companyId: string,
  patch: Partial<{
    identifier: string;
    locationId: string | null;
    notes: string | null;
    status: string;
  }>,
): Promise<void> {
  await db
    .update(parts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(parts.id, id), eq(parts.companyId, companyId)));
}

/** Bump the cycle count by one. Written as an expression so two services racing
 *  cannot both read the same number and write it back. */
export async function incrementCycleCount(id: string, companyId: string): Promise<void> {
  await db
    .update(parts)
    .set({ cycleCount: sql`${parts.cycleCount} + 1`, updatedAt: new Date() })
    .where(and(eq(parts.id, id), eq(parts.companyId, companyId)));
}

/* ------------------------------- placements -------------------------------- */

export interface PlacementRow {
  id: string;
  partId: string;
  deviceId: string;
  deviceName: string;
  installedAt: Date;
  installedByName: string | null;
  removedAt: Date | null;
  removedByName: string | null;
  outcome: string | null;
  note: string | null;
  meterStart: number | null;
  meterEnd: number | null;
  pagesPrinted: number | null;
  createdAt: Date;
  updatedAt: Date;
}

function placementQuery() {
  return db
    .select({
      id: partPlacements.id,
      partId: partPlacements.partId,
      deviceId: partPlacements.deviceId,
      deviceName: devices.name,
      installedAt: partPlacements.installedAt,
      installedByName: sql<string | null>`installed_user.name`,
      removedAt: partPlacements.removedAt,
      removedByName: sql<string | null>`removed_user.name`,
      outcome: partPlacements.outcome,
      note: partPlacements.note,
      meterStart: partPlacements.meterStart,
      meterEnd: partPlacements.meterEnd,
      pagesPrinted: partPlacements.pagesPrinted,
      createdAt: partPlacements.createdAt,
      updatedAt: partPlacements.updatedAt,
    })
    .from(partPlacements)
    .innerJoin(devices, eq(devices.id, partPlacements.deviceId))
    .leftJoin(sql`users installed_user`, sql`installed_user.id = ${partPlacements.installedBy}`)
    .leftJoin(sql`users removed_user`, sql`removed_user.id = ${partPlacements.removedBy}`);
}

/** Every tour this part has done, newest first. */
export async function placementsFor(partId: string, companyId: string): Promise<PlacementRow[]> {
  return placementQuery()
    .where(and(eq(partPlacements.partId, partId), eq(partPlacements.companyId, companyId)))
    .orderBy(desc(partPlacements.installedAt));
}

/** The tour it is on now, if any. */
export async function openPlacement(
  partId: string,
  companyId: string,
): Promise<PlacementRow | null> {
  const [row] = await placementQuery()
    .where(
      and(
        eq(partPlacements.partId, partId),
        eq(partPlacements.companyId, companyId),
        isNull(partPlacements.removedAt),
      ),
    )
    .orderBy(desc(partPlacements.installedAt));
  return row ?? null;
}

export async function insertPlacement(
  companyId: string,
  values: {
    partId: string;
    deviceId: string;
    installedBy: string;
    note?: string | null;
    meterStart?: number | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(partPlacements)
    .values({
      companyId,
      partId: values.partId,
      deviceId: values.deviceId,
      installedBy: values.installedBy,
      note: values.note ?? null,
      meterStart: values.meterStart ?? null,
    })
    .returning({ id: partPlacements.id });
  return row!.id;
}

export async function closePlacement(
  id: string,
  companyId: string,
  values: {
    removedBy: string;
    outcome: string;
    note?: string | null;
    meterEnd?: number | null;
    pagesPrinted?: number | null;
  },
): Promise<void> {
  await db
    .update(partPlacements)
    .set({
      removedAt: new Date(),
      removedBy: values.removedBy,
      outcome: values.outcome,
      ...(values.note ? { note: values.note } : {}),
      // Written only when given, so booking a part in without a reading does not
      // wipe one somebody entered.
      ...(values.meterEnd !== undefined ? { meterEnd: values.meterEnd } : {}),
      ...(values.pagesPrinted !== undefined ? { pagesPrinted: values.pagesPrinted } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(partPlacements.id, id), eq(partPlacements.companyId, companyId)));
}

/* --------------------------------- devices --------------------------------- */

/**
 * The devices a model actually fits.
 *
 * Answered here rather than by the screen filtering the whole register: the
 * server already decides compatibility when a deploy is attempted, and a second
 * copy of that rule in the browser is one that can disagree with it. Offering a
 * machine the API will certainly refuse is worse than a short list.
 */
/**
 * The printers a cartridge model fits — at the caller's own sites.
 *
 * This feeds the install picker, so an unscoped list offers machines somewhere the
 * person has never been: they pick one, and the cartridge disappears from their
 * register into a plant they cannot see.
 */
export async function devicesFittingModel(
  partModelId: string,
  companyId: string,
  locationScope: SQL | undefined = undefined,
  // The cartridge's own site, when it has one: stock belonging to a plant goes into
  // that plant's machines and no others. Null means unplaced stock, which may still
  // go anywhere the caller can reach — and adopts the site of whatever it goes into.
  atLocationId: string | null = null,
): Promise<{ id: string; name: string; typeName: string | null }[]> {
  return db
    .select({ id: devices.id, name: devices.name, typeName: deviceTypes.name })
    .from(devices)
    .innerJoin(partModelCompatibility, eq(partModelCompatibility.deviceTypeId, devices.typeId))
    .leftJoin(deviceTypes, eq(deviceTypes.id, devices.typeId))
    .where(
      and(
        eq(devices.companyId, companyId),
        eq(partModelCompatibility.partModelId, partModelId),
        atLocationId ? eq(devices.locationId, atLocationId) : undefined,
        locationScope,
      ),
    )
    .orderBy(asc(devices.name));
}

/** A device's type, so a deploy can check the part actually fits it. */
/**
 * The device a cartridge is about to go into — if the caller's sites reach it.
 *
 * Scoped in the lookup, so installing into a printer at another plant answers
 * "device not found" rather than succeeding quietly. A cartridge in a machine you
 * cannot see is a cartridge nobody will book back in.
 */
export async function deviceTypeOf(
  deviceId: string,
  companyId: string,
  locationScope: SQL | undefined = undefined,
): Promise<{ id: string; name: string; typeId: string | null; locationId: string | null } | null> {
  const [row] = await db
    .select({
      id: devices.id,
      name: devices.name,
      typeId: devices.typeId,
      // The site, because a cartridge may only go into a machine at its own plant.
      locationId: devices.locationId,
    })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.companyId, companyId), locationScope));
  return row ?? null;
}
