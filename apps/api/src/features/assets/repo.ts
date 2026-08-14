// Author: Brijesh Dave <https://github.com/brijeshdave>
// Asset repository — the only code touching the asset_types and assets tables. The
// tree is per-company; asset *types* are a global vocabulary. Every asset query is
// scoped to a company id so a caller can never reach another company's tree.
import { type SQL, and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/core/db/index.js";
import {
  assetTypes,
  assets,
  devices,
  downtimeEntries,
  locations,
  journalTargets,
} from "@/core/db/schema.js";

/* ------------------------------ Asset types -------------------------------- */

export interface AssetTypeRowRaw {
  id: string;
  name: string;
  orderIndex: number;
  tracksDowntime: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  assetCount: number;
}

const typeCols = {
  id: assetTypes.id,
  name: assetTypes.name,
  orderIndex: assetTypes.orderIndex,
  tracksDowntime: assetTypes.tracksDowntime,
  status: assetTypes.status,
  createdAt: assetTypes.createdAt,
  updatedAt: assetTypes.updatedAt,
};

/** Every type with how many assets use it — the count you want before retiring one.
 * Ordered by the explicit order, then name. */
export async function listAssetTypes(): Promise<AssetTypeRowRaw[]> {
  return db
    .select({ ...typeCols, assetCount: sql<number>`count(${assets.id})::int` })
    .from(assetTypes)
    .leftJoin(assets, eq(assets.typeId, assetTypes.id))
    .groupBy(assetTypes.id)
    .orderBy(assetTypes.orderIndex, assetTypes.name);
}

/** Active types only, for the picker when building the tree. */
export async function activeAssetTypes(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: assetTypes.id, name: assetTypes.name })
    .from(assetTypes)
    .where(eq(assetTypes.status, "active"))
    .orderBy(assetTypes.orderIndex, assetTypes.name);
}

export async function getAssetType(id: string): Promise<AssetTypeRowRaw | null> {
  const [row] = await db
    .select({ ...typeCols, assetCount: sql<number>`count(${assets.id})::int` })
    .from(assetTypes)
    .leftJoin(assets, eq(assets.typeId, assetTypes.id))
    .where(eq(assetTypes.id, id))
    .groupBy(assetTypes.id);
  return row ?? null;
}

export async function insertAssetType(
  values: Pick<AssetTypeRowRaw, "name" | "orderIndex" | "status" | "tracksDowntime">,
): Promise<AssetTypeRowRaw> {
  const [row] = await db.insert(assetTypes).values(values).returning(typeCols);
  return { ...row!, assetCount: 0 };
}

export async function updateAssetTypeRow(
  id: string,
  fields: Partial<Pick<AssetTypeRowRaw, "name" | "orderIndex" | "status" | "tracksDowntime">>,
): Promise<void> {
  await db
    .update(assetTypes)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(assetTypes.id, id));
}

export async function deleteAssetTypeRow(id: string): Promise<void> {
  await db.delete(assetTypes).where(eq(assetTypes.id, id));
}

/** A resolved asset-type import row: null order/status mean "leave as is on update". */
export interface ResolvedAssetTypeRow {
  name: string;
  orderIndex: number | null;
  status: string | null;
}

/**
 * Apply an asset-type import in one transaction, keyed by name (which is unique). An
 * existing type has its order/status updated where the row gives them; a new name is
 * inserted. All-or-nothing: a failure rolls the whole import back.
 */
export async function upsertAssetTypes(
  rows: ResolvedAssetTypeRow[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: assetTypes.id, name: assetTypes.name }).from(assetTypes);
    const byName = new Map(existing.map((t) => [t.name.trim().toLowerCase(), t.id]));
    for (const row of rows) {
      const id = byName.get(row.name.trim().toLowerCase());
      if (id) {
        await tx
          .update(assetTypes)
          .set({
            ...(row.orderIndex !== null ? { orderIndex: row.orderIndex } : {}),
            ...(row.status !== null ? { status: row.status } : {}),
            updatedAt: new Date(),
          })
          .where(eq(assetTypes.id, id));
        updated += 1;
      } else {
        const [ins] = await tx
          .insert(assetTypes)
          .values({
            name: row.name,
            orderIndex: row.orderIndex ?? 0,
            status: row.status ?? "active",
          })
          .returning({ id: assetTypes.id });
        byName.set(row.name.trim().toLowerCase(), ins!.id);
        created += 1;
      }
    }
  });
  return { created, updated };
}

/* --------------------------------- Assets ---------------------------------- */

export interface AssetRowRaw {
  id: string;
  companyId: string;
  parentId: string | null;
  typeId: string | null;
  typeName: string | null;
  locationId: string | null;
  locationName: string | null;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deviceCount: number;
}

const assetCols = {
  id: assets.id,
  companyId: assets.companyId,
  parentId: assets.parentId,
  typeId: assets.typeId,
  locationId: assets.locationId,
  name: assets.name,
  status: assets.status,
  createdAt: assets.createdAt,
  updatedAt: assets.updatedAt,
};

/** Every asset of one company, type-named, with the count of devices that live at
 * it. Flat; the caller assembles the tree from `parentId` (like departments). */
/**
 * `scope` is the caller's location constraint (from `withLocationsNullable`, so
 * unplaced assets stay visible), or undefined when they reach every site. Required,
 * not optional: a new read here must decide about scoping out loud.
 */
export async function listAssets(
  companyId: string,
  scope: SQL | undefined,
): Promise<AssetRowRaw[]> {
  return db
    .select({
      ...assetCols,
      typeName: assetTypes.name,
      locationName: locations.name,
      deviceCount: sql<number>`count(${devices.id})::int`,
    })
    .from(assets)
    .leftJoin(assetTypes, eq(assetTypes.id, assets.typeId))
    .leftJoin(locations, eq(locations.id, assets.locationId))
    .leftJoin(devices, eq(devices.assetId, assets.id))
    .where(and(eq(assets.companyId, companyId), scope))
    .groupBy(assets.id, assetTypes.name, locations.name)
    .orderBy(assets.name);
}

export async function getAsset(
  id: string,
  companyId: string,
  scope: SQL | undefined,
): Promise<AssetRowRaw | null> {
  const [row] = await db
    .select({
      ...assetCols,
      typeName: assetTypes.name,
      locationName: locations.name,
      deviceCount: sql<number>`count(${devices.id})::int`,
    })
    .from(assets)
    .leftJoin(assetTypes, eq(assetTypes.id, assets.typeId))
    .leftJoin(locations, eq(locations.id, assets.locationId))
    .leftJoin(devices, eq(devices.assetId, assets.id))
    .where(and(eq(assets.id, id), eq(assets.companyId, companyId), scope))
    .groupBy(assets.id, assetTypes.name, locations.name);
  return row ?? null;
}

export async function insertAsset(
  companyId: string,
  values: {
    name: string;
    parentId: string | null;
    typeId: string | null;
    locationId: string | null;
    status: string;
  },
): Promise<string> {
  const [row] = await db
    .insert(assets)
    .values({ companyId, ...values })
    .returning({ id: assets.id });
  return row!.id;
}

export async function updateAssetFields(
  id: string,
  companyId: string,
  fields: Partial<{
    name: string;
    parentId: string | null;
    typeId: string | null;
    locationId: string | null;
    status: string;
  }>,
): Promise<void> {
  await db
    .update(assets)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(assets.id, id), eq(assets.companyId, companyId)));
}

export async function deleteAssetRow(id: string, companyId: string): Promise<void> {
  await db.delete(assets).where(and(eq(assets.id, id), eq(assets.companyId, companyId)));
}

/** The company's sites, for resolving an import's site names to ids. */
export async function companyLocations(companyId: string): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(eq(locations.companyId, companyId));
}

/** A resolved import row: its path segments and the ids/values its leaf takes. */
export interface ResolvedAssetImportRow {
  segments: string[];
  typeId: string | null;
  locationId: string | null;
  status: string;
}

const pathKey = (segments: string[]): string =>
  segments.map((s) => s.trim().toLowerCase()).join(" › ");

/**
 * Apply an asset import in one transaction: for each row, walk its path creating any
 * missing ancestors (with no type/site — the leaf carries those), then create the leaf or
 * update its type/site/status if the path already exists. `existingByPath` is the current
 * tree keyed by lower-cased path. All-or-nothing: a failure rolls the whole import back.
 */
export async function upsertAssetTree(
  companyId: string,
  existingByPath: Map<string, string>,
  rows: ResolvedAssetImportRow[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    const byPath = new Map(existingByPath);
    // Shortest paths first, so a parent's own row is applied before its children's.
    const ordered = [...rows].sort((a, b) => a.segments.length - b.segments.length);
    for (const row of ordered) {
      let parentId: string | null = null;
      for (let i = 0; i < row.segments.length; i += 1) {
        const isLeaf = i === row.segments.length - 1;
        const key = pathKey(row.segments.slice(0, i + 1));
        const found = byPath.get(key);
        let id: string;
        if (found) {
          id = found;
          if (isLeaf) {
            await tx
              .update(assets)
              .set({
                typeId: row.typeId,
                locationId: row.locationId,
                status: row.status,
                updatedAt: new Date(),
              })
              .where(and(eq(assets.id, id), eq(assets.companyId, companyId)));
            updated += 1;
          }
        } else {
          const [ins] = await tx
            .insert(assets)
            .values({
              companyId,
              name: row.segments[i]!,
              parentId,
              typeId: isLeaf ? row.typeId : null,
              locationId: isLeaf ? row.locationId : null,
              status: isLeaf ? row.status : "active",
            })
            .returning({ id: assets.id });
          id = ins!.id;
          byPath.set(key, id);
          if (isLeaf) created += 1;
        }
        parentId = id;
      }
    }
  });
  return { created, updated };
}

const children = alias(assets, "children");

/**
 * What still depends on an asset — so a delete that would orphan history is refused.
 * Counts its child assets, the devices that live at it, and the reports and downtime
 * entries that name it in their scope (a polymorphic link with no foreign key of its
 * own). Non-zero means "retire it, do not delete it".
 */
export async function assetDependents(
  id: string,
  companyId: string,
): Promise<{ children: number; devices: number; references: number }> {
  const [childRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(children)
    .where(and(eq(children.parentId, id), eq(children.companyId, companyId)));
  const [deviceRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(devices)
    .where(and(eq(devices.assetId, id), eq(devices.companyId, companyId)));
  const [targetRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(journalTargets)
    .where(and(eq(journalTargets.targetKind, "asset"), eq(journalTargets.targetId, id)));
  const [downtimeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(downtimeEntries)
    .where(and(eq(downtimeEntries.targetKind, "asset"), eq(downtimeEntries.targetId, id)));

  return {
    children: childRow?.count ?? 0,
    devices: deviceRow?.count ?? 0,
    references: (targetRow?.count ?? 0) + (downtimeRow?.count ?? 0),
  };
}

/** Whether a type is referenced by any asset (guards its delete). */
export async function assetTypeInUse(id: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assets)
    .where(eq(assets.typeId, id));
  return row?.count ?? 0;
}
