// Author: Brijesh Dave <https://github.com/brijeshdave>
// Asset business logic: a global type vocabulary and a per-company nested tree.
// Names in the tree are deliberately *not* unique — "Station 1" recurs under every
// line — so the only guard is on the type names, which are. In-use types and assets
// are retired, never deleted, so history that points at them is never disturbed.
import {
  type Asset,
  type AssetType,
  type AuthContext,
  type CreateAsset,
  type CreateAssetType,
  ERROR_CODES,
  type UpdateAsset,
  type UpdateAssetType,
} from "@reportly/shared";

import { assets as assetsTable } from "@/core/db/schema.js";
import { mayUseLocation, withLocationsNullable } from "@/core/db/scoped.js";
import { AppError } from "@/core/errors.js";
import { isUniqueViolation } from "@/lib/db-errors.js";
import {
  activeAssetTypes,
  type AssetRowRaw,
  type AssetTypeRowRaw,
  type ResolvedAssetImportRow,
  assetDependents,
  assetTypeInUse,
  companyLocations,
  deleteAssetRow,
  deleteAssetTypeRow,
  getAsset as getAssetRow,
  getAssetType as getAssetTypeRow,
  insertAsset,
  insertAssetType,
  listAssets as listAssetRows,
  listAssetTypes as listAssetTypeRows,
  updateAssetFields,
  updateAssetTypeRow,
  upsertAssetTree,
  upsertAssetTypes,
} from "@/features/assets/repo.js";
import {
  ASSET_PATH_SEPARATOR,
  type AssetExportRow,
  type ParseResult,
} from "@/features/assets/import-parse.js";
import type {
  AssetTypeExportRow,
  AssetTypeParseResult,
} from "@/features/assets/asset-type-import.js";

const status = (s: string): "active" | "inactive" => (s === "inactive" ? "inactive" : "active");

/* ------------------------------ Asset types -------------------------------- */

interface AssetTypeOut extends AssetType {
  assetCount: number;
}

function serializeType(row: AssetTypeRowRaw): AssetTypeOut {
  return {
    id: row.id,
    name: row.name,
    orderIndex: row.orderIndex,
    tracksDowntime: row.tracksDowntime,
    status: status(row.status),
    assetCount: row.assetCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const TYPE_DUPLICATE = () =>
  new AppError(409, ERROR_CODES.CONFLICT, "An asset type with that name already exists");

async function requireType(id: string): Promise<AssetTypeRowRaw> {
  const row = await getAssetTypeRow(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Asset type not found");
  return row;
}

export async function listAssetTypes(): Promise<AssetTypeOut[]> {
  return (await listAssetTypeRows()).map(serializeType);
}

/** Active types, for the picker when building the tree. */
export async function typeOptions(): Promise<{ id: string; name: string }[]> {
  return activeAssetTypes();
}

export async function createAssetType(input: CreateAssetType): Promise<AssetTypeOut> {
  try {
    return serializeType(await insertAssetType(input));
  } catch (err) {
    if (isUniqueViolation(err)) throw TYPE_DUPLICATE();
    throw err;
  }
}

export async function updateAssetType(id: string, input: UpdateAssetType): Promise<AssetTypeOut> {
  await requireType(id);
  try {
    await updateAssetTypeRow(id, input);
  } catch (err) {
    if (isUniqueViolation(err)) throw TYPE_DUPLICATE();
    throw err;
  }
  return serializeType(await requireType(id));
}

export async function deleteAssetType(id: string): Promise<void> {
  await requireType(id);
  const inUse = await assetTypeInUse(id);
  if (inUse > 0) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      `${inUse} ${inUse === 1 ? "asset uses" : "assets use"} this type. Deactivate it instead — those assets keep it, and it stops being offered.`,
      { assetCount: inUse },
    );
  }
  await deleteAssetTypeRow(id);
}

/** Export the type vocabulary — one row per type, in display order. */
export async function exportAssetTypes(): Promise<AssetTypeExportRow[]> {
  return (await listAssetTypeRows()).map((t) => ({
    name: t.name,
    orderIndex: t.orderIndex,
    status: status(t.status),
  }));
}

export interface TypeImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/**
 * Apply an uploaded asset-type file. Types are keyed by name; all-or-nothing, so any bad
 * row (or a name that repeats within the file) leaves the vocabulary untouched and every
 * problem comes back with its line number.
 */
export async function importAssetTypes(parsed: AssetTypeParseResult): Promise<TypeImportOutcome> {
  const problems = [...parsed.problems];
  if (parsed.rows.length === 0) return { created: 0, updated: 0, problems };

  const seen = new Set<string>();
  for (const row of parsed.rows) {
    const key = row.name.trim().toLowerCase();
    if (seen.has(key))
      problems.push({
        line: row.line,
        message: `"${row.name}" appears more than once in the file`,
      });
    seen.add(key);
  }
  if (problems.length > 0) return { created: 0, updated: 0, problems };

  const { created, updated } = await upsertAssetTypes(
    parsed.rows.map((r) => ({ name: r.name, orderIndex: r.orderIndex, status: r.status })),
  );
  return { created, updated, problems: [] };
}

/* --------------------------------- Assets ---------------------------------- */

function serializeAsset(row: AssetRowRaw): Asset & { deviceCount: number } {
  return {
    id: row.id,
    companyId: row.companyId,
    parentId: row.parentId,
    typeId: row.typeId,
    typeName: row.typeName,
    locationId: row.locationId,
    locationName: row.locationName,
    name: row.name,
    status: status(row.status),
    deviceCount: row.deviceCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Every asset read passes through here, so location scoping is applied once. An
 * asset outside the caller's sites is a 404 — the same answer as one that does not
 * exist, so a scoped user cannot enumerate another plant's machines by id.
 */
async function requireAsset(id: string, companyId: string, ctx: AuthContext): Promise<AssetRowRaw> {
  const row = await getAssetRow(id, companyId, withLocationsNullable(ctx, assetsTable.locationId));
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Asset not found");
  return row;
}

/** Flat list of the company's assets; the client assembles the tree from parentId. */
export async function listAssets(
  companyId: string,
  ctx: AuthContext,
): Promise<(Asset & { deviceCount: number })[]> {
  return (await listAssetRows(companyId, withLocationsNullable(ctx, assetsTable.locationId))).map(
    serializeAsset,
  );
}

export async function getAsset(
  id: string,
  companyId: string,
  ctx: AuthContext,
): Promise<Asset & { deviceCount: number }> {
  return serializeAsset(await requireAsset(id, companyId, ctx));
}

/** A parent must exist in the same company, and be one the caller can actually
 *  see — otherwise a scoped user could hang their asset off another site's tree
 *  and learn its shape from the roll-up. A null parent is a root. */
async function assertParent(
  parentId: string | null | undefined,
  companyId: string,
  ctx: AuthContext,
): Promise<void> {
  if (!parentId) return;
  const parent = await getAssetRow(
    parentId,
    companyId,
    withLocationsNullable(ctx, assetsTable.locationId),
  );
  if (!parent) throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Parent asset not found");
}

/**
 * Writing into a location you cannot see is refused, not filtered. Reading a scope
 * you lack yields a shorter list; *placing* a record there would put it somewhere
 * you can never look at again, so it is a 403 with a reason.
 */
function assertMayPlace(locationId: string | null | undefined, ctx: AuthContext): void {
  if (locationId === undefined) return;
  if (!mayUseLocation(ctx, locationId)) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You cannot place this at that location");
  }
}

export async function createAsset(
  companyId: string,
  input: CreateAsset,
  ctx: AuthContext,
): Promise<Asset & { deviceCount: number }> {
  assertMayPlace(input.locationId, ctx);
  await assertParent(input.parentId ?? null, companyId, ctx);
  const id = await insertAsset(companyId, {
    name: input.name,
    parentId: input.parentId ?? null,
    typeId: input.typeId ?? null,
    locationId: input.locationId ?? null,
    status: input.status,
  });
  return serializeAsset(await requireAsset(id, companyId, ctx));
}

export async function updateAsset(
  id: string,
  companyId: string,
  input: UpdateAsset,
  ctx: AuthContext,
): Promise<Asset & { deviceCount: number }> {
  await requireAsset(id, companyId, ctx);
  assertMayPlace(input.locationId, ctx);
  if (input.parentId !== undefined) {
    if (input.parentId === id) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "An asset cannot be its own parent");
    }
    await assertParent(input.parentId, companyId, ctx);
  }
  await updateAssetFields(id, companyId, input);
  return serializeAsset(await requireAsset(id, companyId, ctx));
}

/**
 * Deleting is refused while anything still points at the asset — child assets,
 * devices that live at it, or reports/downtime that name it in scope. Every case
 * ends the same way: retire it (status inactive) so it stops being offered while
 * the history that references it stays intact.
 */
export async function deleteAsset(id: string, companyId: string, ctx: AuthContext): Promise<void> {
  await requireAsset(id, companyId, ctx);
  const dep = await assetDependents(id, companyId);
  const total = dep.children + dep.devices + dep.references;
  if (total > 0) {
    const parts: string[] = [];
    if (dep.children) parts.push(`${dep.children} child asset(s)`);
    if (dep.devices) parts.push(`${dep.devices} device(s)`);
    if (dep.references) parts.push(`${dep.references} report/downtime reference(s)`);
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      `This asset is still in use (${parts.join(", ")}). Deactivate it instead.`,
      dep,
    );
  }
  await deleteAssetRow(id, companyId);
}

/* ------------------------------ Import / export ---------------------------- */

/** Every asset's full path from the root — cycle-guarded, since parentId is editable. */
function pathsByAsset(rows: AssetRowRaw[]): Map<string, string[]> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string[]>();
  for (const row of rows) {
    const names: string[] = [];
    const seen = new Set<string>();
    let cur: AssetRowRaw | undefined = row;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      names.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    out.set(row.id, names);
  }
  return out;
}

/** The flattened tree as export rows — one per asset, parent before child. */
export async function exportAssets(companyId: string, ctx: AuthContext): Promise<AssetExportRow[]> {
  const rows = await listAssetRows(companyId, withLocationsNullable(ctx, assetsTable.locationId));
  const paths = pathsByAsset(rows);
  return rows
    .map((r) => ({
      path: (paths.get(r.id) ?? [r.name]).join(ASSET_PATH_SEPARATOR),
      type: r.typeName,
      site: r.locationName,
      status: status(r.status),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export interface ImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/**
 * Apply an uploaded asset file. Names are resolved to ids (type, site) and the whole tree
 * is upserted by path; all-or-nothing, so any bad row leaves the tree untouched and every
 * problem comes back with its line number.
 */
export async function importAssets(
  companyId: string,
  parsed: ParseResult,
  ctx: AuthContext,
): Promise<ImportOutcome> {
  const problems = [...parsed.problems];
  if (parsed.rows.length === 0) return { created: 0, updated: 0, problems };

  const [types, sites, existing] = await Promise.all([
    listAssetTypeRows(),
    companyLocations(companyId),
    listAssetRows(companyId, withLocationsNullable(ctx, assetsTable.locationId)),
  ]);
  const typeIds = new Map(types.map((t) => [t.name.trim().toLowerCase(), t.id]));
  const siteIds = new Map(sites.map((s) => [s.name.trim().toLowerCase(), s.id]));

  const resolved: ResolvedAssetImportRow[] = [];
  for (const row of parsed.rows) {
    const fail = (message: string) => problems.push({ line: row.line, message });

    let typeId: string | null = null;
    if (row.type) {
      typeId = typeIds.get(row.type.toLowerCase()) ?? null;
      if (!typeId) {
        fail(`"${row.type}" is not an asset type`);
        continue;
      }
    }
    let locationId: string | null = null;
    if (row.site) {
      locationId = siteIds.get(row.site.toLowerCase()) ?? null;
      if (!locationId) {
        fail(`No site called "${row.site}"`);
        continue;
      }
      if (!mayUseLocation(ctx, locationId)) {
        fail(`You do not have access to the site "${row.site}"`);
        continue;
      }
    }
    resolved.push({
      segments: row.segments,
      typeId,
      locationId,
      status: status(row.status ?? "active"),
    });
  }

  if (problems.length > 0) return { created: 0, updated: 0, problems };

  // The current tree keyed by lower-cased path, so an existing node is updated in place.
  const paths = pathsByAsset(existing);
  const existingByPath = new Map<string, string>();
  for (const asset of existing) {
    const key = (paths.get(asset.id) ?? [asset.name])
      .map((n) => n.trim().toLowerCase())
      .join(" › ");
    existingByPath.set(key, asset.id);
  }

  const { created, updated } = await upsertAssetTree(companyId, existingByPath, resolved);
  return { created, updated, problems: [] };
}
