// Author: Brijesh Dave <https://github.com/brijeshdave>
// Device business logic: a flat registry, each device optionally living at an asset
// and owned by a department — both validated to belong to the same company. A device
// named in any report or downtime is retired, not deleted, so history is never lost.
import {
  type AuthContext,
  type CreateDevice,
  type Device,
  ERROR_CODES,
  type PaginatedResult,
  type ResolvedListQuery,
  type UpdateDevice,
  toPaginatedResult,
} from "@reportly/shared";

import { devices as devicesTable } from "@/core/db/schema.js";
import { mayUseLocation, withLocationsNullable } from "@/core/db/scoped.js";
import { AppError } from "@/core/errors.js";
import { isUniqueViolation } from "@/lib/db-errors.js";
import {
  assetInCompany,
  departmentInCompany,
  assetsOf,
  deleteDeviceRow,
  departmentsOf,
  deviceReferenceCount,
  deviceTypesOf,
  type DeviceRowRaw,
  getDevice as getDeviceRow,
  insertDevice,
  insertDevices,
  listAllDevices,
  listDevices as listDeviceRows,
  locationsOf,
  type NewDevice,
  updateDeviceFields,
} from "@/features/devices/repo.js";
import type { DeviceExportRow, ParseResult } from "@/features/devices/import-parse.js";

function serialize(row: DeviceRowRaw): Device {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    identifier: row.identifier,
    assetTag: row.assetTag,
    typeId: row.typeId,
    typeName: row.typeName,
    assetId: row.assetId,
    assetName: row.assetName,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    locationId: row.locationId,
    locationName: row.locationName,
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Every device read passes through here, so location scoping is applied once. A
 * device at a site the caller cannot reach is a 404, not a 403 — the same answer
 * as one that does not exist, so ids cannot be probed.
 */
async function requireDevice(
  id: string,
  companyId: string,
  ctx: AuthContext,
): Promise<DeviceRowRaw> {
  const row = await getDeviceRow(
    id,
    companyId,
    withLocationsNullable(ctx, devicesTable.locationId),
  );
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Device not found");
  return row;
}

/** Placing a device at a site you cannot see is refused, not filtered. */
function assertMayPlace(locationId: string | null | undefined, ctx: AuthContext): void {
  if (locationId === undefined) return;
  if (!mayUseLocation(ctx, locationId)) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You cannot place this at that location");
  }
}

/** An asset/department link, when set, must be one of this company's own. */
async function assertLinks(
  companyId: string,
  assetId: string | null,
  departmentId: string | null,
): Promise<void> {
  if (assetId && !(await assetInCompany(assetId, companyId))) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Asset not found in this company");
  }
  if (departmentId && !(await departmentInCompany(departmentId, companyId))) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Department not found in this company");
  }
}

export async function listDevices(
  companyId: string,
  query: ResolvedListQuery,
  ctx: AuthContext,
): Promise<PaginatedResult<Device>> {
  const { rows, total } = await listDeviceRows(
    companyId,
    query,
    withLocationsNullable(ctx, devicesTable.locationId),
  );
  return toPaginatedResult(rows.map(serialize), total, query);
}

export async function getDevice(id: string, companyId: string, ctx: AuthContext): Promise<Device> {
  return serialize(await requireDevice(id, companyId, ctx));
}

/**
 * The asset ID is unique per company, so a clash is a 409 with a usable message
 * rather than a 500. Goes through `isUniqueViolation` — drizzle wraps the pg error
 * and moves the code onto `.cause`, so reading `err.code` here would never match.
 */
const DUPLICATE_TAG = () =>
  new AppError(
    409,
    ERROR_CODES.CONFLICT,
    "Another device in this company already has that asset ID",
  );

export async function createDevice(
  companyId: string,
  input: CreateDevice,
  ctx: AuthContext,
): Promise<Device> {
  assertMayPlace(input.locationId, ctx);
  const values: NewDevice = {
    name: input.name,
    identifier: input.identifier?.trim() || null,
    assetTag: input.assetTag?.trim() || null,
    typeId: input.typeId ?? null,
    assetId: input.assetId ?? null,
    departmentId: input.departmentId ?? null,
    locationId: input.locationId ?? null,
    status: input.status,
  };
  await assertLinks(companyId, values.assetId, values.departmentId);
  let id: string;
  try {
    id = await insertDevice(companyId, values);
  } catch (err) {
    if (isUniqueViolation(err)) throw DUPLICATE_TAG();
    throw err;
  }
  return serialize(await requireDevice(id, companyId, ctx));
}

export async function updateDevice(
  id: string,
  companyId: string,
  input: UpdateDevice,
  ctx: AuthContext,
): Promise<Device> {
  const current = await requireDevice(id, companyId, ctx);
  assertMayPlace(input.locationId, ctx);
  const nextAsset = input.assetId !== undefined ? input.assetId : current.assetId;
  const nextDept = input.departmentId !== undefined ? input.departmentId : current.departmentId;
  await assertLinks(companyId, nextAsset, nextDept);

  const fields: Partial<NewDevice> = {};
  if (input.name !== undefined) fields.name = input.name;
  if (input.identifier !== undefined) fields.identifier = input.identifier?.trim() || null;
  if (input.assetTag !== undefined) fields.assetTag = input.assetTag?.trim() || null;
  if (input.typeId !== undefined) fields.typeId = input.typeId;
  if (input.assetId !== undefined) fields.assetId = input.assetId;
  if (input.departmentId !== undefined) fields.departmentId = input.departmentId;
  if (input.locationId !== undefined) fields.locationId = input.locationId;
  if (input.status !== undefined) fields.status = input.status;

  try {
    await updateDeviceFields(id, companyId, fields);
  } catch (err) {
    if (isUniqueViolation(err)) throw DUPLICATE_TAG();
    throw err;
  }
  return serialize(await requireDevice(id, companyId, ctx));
}

/**
 * Deleting is refused while any report or downtime names the device — retire it
 * (status inactive) instead, so the history keeps its label.
 */
export async function deleteDevice(id: string, companyId: string, ctx: AuthContext): Promise<void> {
  await requireDevice(id, companyId, ctx);
  const refs = await deviceReferenceCount(id);
  if (refs > 0) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      `This device is named in ${refs} report/downtime record(s). Deactivate it instead.`,
      { references: refs },
    );
  }
  await deleteDeviceRow(id, companyId);
}

/** Export the company's device register — one row per device, in the import's columns. */
export async function exportDevices(
  companyId: string,
  ctx: AuthContext,
): Promise<DeviceExportRow[]> {
  const rows = await listAllDevices(companyId, withLocationsNullable(ctx, devicesTable.locationId));
  return rows.map((r) => ({
    name: r.name,
    identifier: r.identifier,
    assetTag: r.assetTag,
    type: r.typeName,
    site: r.locationName,
    asset: r.assetName,
    status: r.status === "inactive" ? "inactive" : "active",
  }));
}

// --- bulk import ---

export interface ImportOutcome {
  /** Rows written. */
  created: number;
  /** Rows refused, each with its line number and why — never silently dropped. */
  problems: { line: number; message: string }[];
}

/**
 * Create devices from a parsed spreadsheet, all into one department chosen up front.
 *
 * The department is picked once in the dialog rather than named per row, because a
 * device **type** belongs to a department — matching a type name across the whole
 * company would be ambiguous the moment two departments both have a "Sensor". So the
 * type on every row is resolved *within* the chosen department, and one that is not
 * on that department's list is rejected by name. `departmentId` may be null for
 * devices that belong to no department, in which case a type cannot be given.
 *
 * Two rules carry the rest. **All or nothing**: the whole file is validated before a
 * single row is written, so a file that is half wrong does not leave half a plant
 * registered. And names are resolved the way people write them — a site or an asset
 * by its name — with a name that matches nothing reported per line, not made null.
 */
export async function importDevices(
  companyId: string,
  departmentId: string | null,
  parsed: ParseResult,
  ctx: AuthContext,
): Promise<ImportOutcome> {
  const problems = [...parsed.problems];

  // The chosen department must be one of this company's.
  let departmentName: string | null = null;
  if (departmentId) {
    const dept = (await departmentsOf(companyId)).find((d) => d.id === departmentId);
    if (!dept) {
      return { created: 0, problems: [{ line: 0, message: "That department does not exist" }] };
    }
    departmentName = dept.name;
  }

  if (parsed.rows.length === 0) {
    return { created: 0, problems };
  }

  const [types, sites, assetRows] = await Promise.all([
    // Types are that one department's own list; with no department there are none.
    departmentId ? deviceTypesOf(departmentId) : Promise.resolve([]),
    locationsOf(companyId),
    assetsOf(companyId),
  ]);
  const byName = <T extends { id: string; name: string }>(rows: T[]) =>
    new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));
  const typeIds = byName(types);
  const siteIds = byName(sites);
  const assetIds = byName(assetRows);

  const resolved: NewDevice[] = [];
  const seenTags = new Set<string>();

  for (const row of parsed.rows) {
    const fail = (message: string) => problems.push({ line: row.line, message });

    let typeId: string | null = null;
    if (row.type) {
      if (!departmentId) {
        fail(`Row names a type ("${row.type}") but no department was chosen for the import`);
        continue;
      }
      typeId = typeIds.get(row.type.toLowerCase()) ?? null;
      if (!typeId) {
        fail(`"${row.type}" is not a device type in ${departmentName}`);
        continue;
      }
    }
    // Every device is placed at a site — an unplaced import is a list of machines
    // nobody can scope a report to, which is the opposite of the point.
    if (!row.site) {
      fail("Site is required");
      continue;
    }
    const locationId = siteIds.get(row.site.toLowerCase());
    if (!locationId) {
      fail(`No site called "${row.site}"`);
      continue;
    }
    const assetId = row.asset ? assetIds.get(row.asset.toLowerCase()) : null;
    if (row.asset && !assetId) {
      fail(`No asset called "${row.asset}"`);
      continue;
    }

    // The same site rule the single-device form enforces: you cannot file a device
    // at a plant you cannot reach.
    if (locationId && !mayUseLocation(ctx, locationId)) {
      fail(`You do not have access to the site "${row.site}"`);
      continue;
    }

    // Asset tags are unique per company; catch collisions inside the file too,
    // which the database constraint would only report one at a time.
    if (row.assetTag) {
      const key = row.assetTag.toLowerCase();
      if (seenTags.has(key)) {
        fail(`Asset tag "${row.assetTag}" appears more than once in this file`);
        continue;
      }
      seenTags.add(key);
    }

    resolved.push({
      name: row.name,
      identifier: row.identifier,
      assetTag: row.assetTag,
      typeId,
      assetId: assetId ?? null,
      departmentId,
      locationId: locationId ?? null,
      status: row.status === "inactive" ? "inactive" : "active",
    });
  }

  // Anything wrong anywhere means nothing is written.
  if (problems.length > 0) return { created: 0, problems };

  try {
    await insertDevices(companyId, resolved);
  } catch (err) {
    if (isUniqueViolation(err)) throw DUPLICATE_TAG();
    throw err;
  }
  return { created: resolved.length, problems: [] };
}
