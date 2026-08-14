// Author: Brijesh Dave <https://github.com/brijeshdave>
// Device repository — the only code touching the devices table. A flat, searchable
// registry, scoped to a company; the asset it lives at and the department that owns
// it are resolved by left join. Search is the standard list query (filter `name`
// contains …), not a tree walk — there can be thousands of these.
import { type SQL, and, eq, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  assets,
  departments,
  deviceTypes,
  devices,
  downtimeEntries,
  locations,
  journalTargets,
} from "@/core/db/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";
import type { ResolvedListQuery } from "@reportly/shared";

export interface DeviceRowRaw {
  id: string;
  companyId: string;
  name: string;
  identifier: string | null;
  assetTag: string | null;
  typeId: string | null;
  typeName: string | null;
  assetId: string | null;
  assetName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  locationId: string | null;
  locationName: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const cols = {
  id: devices.id,
  companyId: devices.companyId,
  name: devices.name,
  identifier: devices.identifier,
  assetTag: devices.assetTag,
  typeId: devices.typeId,
  typeName: deviceTypes.name,
  assetId: devices.assetId,
  assetName: assets.name,
  departmentId: devices.departmentId,
  departmentName: departments.name,
  locationId: devices.locationId,
  locationName: locations.name,
  status: devices.status,
  createdAt: devices.createdAt,
  updatedAt: devices.updatedAt,
};

function selectDevices() {
  return db
    .select(cols)
    .from(devices)
    .leftJoin(assets, eq(assets.id, devices.assetId))
    .leftJoin(departments, eq(departments.id, devices.departmentId))
    .leftJoin(locations, eq(locations.id, devices.locationId))
    .leftJoin(deviceTypes, eq(deviceTypes.id, devices.typeId));
}

const listConfig: ListConfig = {
  columns: {
    name: devices.name,
    identifier: devices.identifier,
    assetTag: devices.assetTag,
    status: devices.status,
    createdAt: devices.createdAt,
    // Filterable so a picker can ask for "the devices at this asset" rather than
    // fetching the register and narrowing it in the browser — there may be
    // thousands, and only a handful stand at any one place.
    assetId: devices.assetId,
    departmentId: devices.departmentId,
    locationId: devices.locationId,
  },
  defaultSort: devices.name,
};

/**
 * `scope` is the caller's location constraint (nullable-aware: a device not yet
 * placed at a site stays visible to everyone). Required rather than optional, so a
 * new read here has to decide about scoping rather than quietly skip it.
 */
export async function listDevices(
  companyId: string,
  query: ResolvedListQuery,
  scope: SQL | undefined,
): Promise<{ rows: DeviceRowRaw[]; total: number }> {
  const parts = buildListParts(listConfig, query);
  const where = and(eq(devices.companyId, companyId), scope, parts.where);

  const rows = await selectDevices()
    .where(where)
    .orderBy(parts.orderBy)
    .limit(parts.limit)
    .offset(parts.offset);

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(devices)
    .where(where);

  return { rows, total: counted?.count ?? 0 };
}

/** Every device of a company (no pagination) — for the export. */
export async function listAllDevices(
  companyId: string,
  scope: SQL | undefined,
): Promise<DeviceRowRaw[]> {
  return selectDevices()
    .where(and(eq(devices.companyId, companyId), scope))
    .orderBy(devices.name);
}

export async function getDevice(
  id: string,
  companyId: string,
  scope: SQL | undefined,
): Promise<DeviceRowRaw | null> {
  const [row] = await selectDevices().where(
    and(eq(devices.id, id), eq(devices.companyId, companyId), scope),
  );
  return row ?? null;
}

export interface NewDevice {
  name: string;
  identifier: string | null;
  assetTag: string | null;
  typeId: string | null;
  assetId: string | null;
  departmentId: string | null;
  locationId: string | null;
  status: string;
}

export async function insertDevice(companyId: string, values: NewDevice): Promise<string> {
  const [row] = await db
    .insert(devices)
    .values({ companyId, ...values })
    .returning({ id: devices.id });
  return row!.id;
}

export async function updateDeviceFields(
  id: string,
  companyId: string,
  fields: Partial<NewDevice>,
): Promise<void> {
  await db
    .update(devices)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(devices.id, id), eq(devices.companyId, companyId)));
}

export async function deleteDeviceRow(id: string, companyId: string): Promise<void> {
  await db.delete(devices).where(and(eq(devices.id, id), eq(devices.companyId, companyId)));
}

/** Reports/downtime that name this device in scope — the in-use guard for deletes. */
export async function deviceReferenceCount(id: string): Promise<number> {
  const targetKind = eq(journalTargets.targetKind, "device");
  const [targets] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(journalTargets)
    .where(and(targetKind, eq(journalTargets.targetId, id)));
  const [dt] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(downtimeEntries)
    .where(and(eq(downtimeEntries.targetKind, "device"), eq(downtimeEntries.targetId, id)));
  return (targets?.count ?? 0) + (dt?.count ?? 0);
}

/** That an asset belongs to this company (a device may only live at its own). */
export async function assetInCompany(assetId: string, companyId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.companyId, companyId)))
    .limit(1);
  return row !== undefined;
}

/** That a department belongs to this company. */
export async function departmentInCompany(
  departmentId: string,
  companyId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.companyId, companyId)))
    .limit(1);
  return row !== undefined;
}

// --- bulk import: the lookups a spreadsheet's names are resolved against ---

export async function departmentsOf(companyId: string): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.companyId, companyId));
}

/** The device types of one department — types belong to a department, not a company. */
export async function deviceTypesOf(departmentId: string): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: deviceTypes.id, name: deviceTypes.name })
    .from(deviceTypes)
    .where(eq(deviceTypes.departmentId, departmentId));
}

export async function locationsOf(companyId: string): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(eq(locations.companyId, companyId));
}

export async function assetsOf(companyId: string): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: assets.id, name: assets.name })
    .from(assets)
    .where(eq(assets.companyId, companyId));
}

/** Insert many devices in one transaction — all of them, or none. */
export async function insertDevices(companyId: string, rows: NewDevice[]): Promise<void> {
  if (rows.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.insert(devices).values(rows.map((values) => ({ ...values, companyId })));
  });
}
