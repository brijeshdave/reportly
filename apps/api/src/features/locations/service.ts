// Author: Brijesh Dave <https://github.com/brijeshdave>
// Location business logic: serialization, the unique-name-per-company invariant
// (surfaced as 409), protection of the immutable Remote location, and the rule
// that a referenced location is deactivated rather than deleted.
import { ERROR_CODES, type AuthContext, type EntityStatus, type Location } from "@reportly/shared";

import { withLocations } from "@/core/db/scoped.js";
import { AppError } from "@/core/errors.js";
import { isUniqueViolation } from "@/lib/db-errors.js";
import {
  companyLocationsForImport,
  deleteLocationRow,
  detachFromGroups,
  getLocation as getLocationRow,
  groupsReferencing,
  insertLocation,
  type LocationReference,
  type LocationRow,
  listLocations as listRows,
  updateLocationName,
  updateLocationStatus,
  upsertLocations,
} from "@/features/locations/repo.js";
import type { LocationExportRow, LocationParseResult } from "@/features/locations/import-parse.js";
import { locations as locationsTable } from "@/core/db/schema.js";

function serialize(row: LocationRow): Location {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    isRemote: row.isRemote,
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const DUPLICATE = () =>
  new AppError(
    409,
    ERROR_CODES.CONFLICT,
    "A location with that name already exists in this company",
  );

/**
 * Location scoping enters here and at `requireLocation` below — between them they
 * cover every read and every write in this feature, because nothing reaches a
 * location row without passing through one of the two.
 *
 * `locations.id` is the location, so this is the non-nullable helper: unlike an
 * asset, a location cannot be "unplaced".
 */
export async function listLocations(companyId: string, ctx: AuthContext): Promise<Location[]> {
  return (await listRows(companyId, withLocations(ctx, locationsTable.id))).map(serialize);
}

export async function getLocation(
  id: string,
  companyId: string,
  ctx: AuthContext,
): Promise<Location> {
  return serialize(await requireLocation(id, companyId, ctx));
}

export async function createLocation(companyId: string, name: string): Promise<Location> {
  try {
    return serialize(await insertLocation(companyId, name));
  } catch (err) {
    if (isUniqueViolation(err)) throw DUPLICATE();
    throw err;
  }
}

export async function updateLocation(
  id: string,
  companyId: string,
  name: string,
  ctx: AuthContext,
): Promise<Location> {
  await requireLocation(id, companyId, ctx);
  try {
    const row = await updateLocationName(id, companyId, name);
    return serialize(row!);
  } catch (err) {
    if (isUniqueViolation(err)) throw DUPLICATE();
    throw err;
  }
}

/**
 * 404, not 403, for a location outside the caller's scope — the same answer as one
 * that does not exist. A distinct "forbidden" would confirm that a site exists at
 * a company the caller cannot survey, which is the enumeration leak the pen-check
 * already closed elsewhere.
 */
async function requireLocation(
  id: string,
  companyId: string,
  ctx: AuthContext,
): Promise<LocationRow> {
  const row = await getLocationRow(id, companyId, withLocations(ctx, locationsTable.id));
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Location not found");
  return row;
}

/** The Remote location is every company's fallback; it must always be usable. */
function requireNotRemote(row: LocationRow, verb: string): void {
  if (row.isRemote) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, `The Remote location cannot be ${verb}`);
  }
}

/**
 * Deactivating keeps every group scope pointing at this location. It is the safe
 * counterpart to deletion, which cannot be undone.
 */
export async function setStatus(
  id: string,
  companyId: string,
  status: EntityStatus,
  ctx: AuthContext,
): Promise<Location> {
  const existing = await requireLocation(id, companyId, ctx);
  if (status === "inactive") requireNotRemote(existing, "deactivated");
  const row = await updateLocationStatus(id, companyId, status);
  return serialize(row!);
}

/* ------------------------------ Import / export ---------------------------- */

/** Export the company's sites — one row per location. */
export async function exportLocations(
  companyId: string,
  ctx: AuthContext,
): Promise<LocationExportRow[]> {
  return (await listLocations(companyId, ctx)).map((l) => ({ name: l.name, status: l.status }));
}

export interface LocationImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/**
 * Apply an uploaded location file. Sites are keyed by name; all-or-nothing, so any bad
 * row (a repeat within the file, or an attempt to deactivate the protected Remote site)
 * leaves the sites untouched and every problem comes back with its line number.
 */
export async function importLocations(
  companyId: string,
  parsed: LocationParseResult,
): Promise<LocationImportOutcome> {
  const problems = [...parsed.problems];
  if (parsed.rows.length === 0) return { created: 0, updated: 0, problems };

  const existing = await companyLocationsForImport(companyId);
  const remoteNames = new Set(
    existing.filter((l) => l.isRemote).map((l) => l.name.trim().toLowerCase()),
  );

  const seen = new Set<string>();
  for (const row of parsed.rows) {
    const key = row.name.trim().toLowerCase();
    if (seen.has(key))
      problems.push({
        line: row.line,
        message: `"${row.name}" appears more than once in the file`,
      });
    seen.add(key);
    if (row.status === "inactive" && remoteNames.has(key)) {
      problems.push({ line: row.line, message: "The Remote location cannot be deactivated" });
    }
  }
  if (problems.length > 0) return { created: 0, updated: 0, problems };

  const { created, updated } = await upsertLocations(
    companyId,
    parsed.rows.map((r) => ({ name: r.name, status: r.status })),
  );
  return { created, updated, problems: [] };
}

/** The groups that would silently lose this location if it were deleted. */
export async function locationReferences(
  id: string,
  companyId: string,
  ctx: AuthContext,
): Promise<LocationReference[]> {
  await requireLocation(id, companyId, ctx);
  return groupsReferencing(id);
}

/**
 * `group_locations` cascades on delete, so a plain delete would strip this
 * location from every group's scope without saying so. Deletion is therefore
 * refused while anything references it, and the refusal names what does. Passing
 * `cascade` detaches those references first — an explicit, audited choice.
 */
export async function deleteLocation(
  id: string,
  companyId: string,
  ctx: AuthContext,
  cascade = false,
): Promise<{ detachedFrom: LocationReference[] }> {
  const existing = await requireLocation(id, companyId, ctx);
  requireNotRemote(existing, "deleted");

  const references = await groupsReferencing(id);
  if (references.length > 0 && !cascade) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This location is used by one or more groups. Deactivate it, or remove it from those groups first.",
      { groups: references },
    );
  }

  if (references.length > 0) await detachFromGroups(id);
  await deleteLocationRow(id, companyId);
  return { detachedFrom: references };
}
