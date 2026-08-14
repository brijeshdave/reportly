// Author: Brijesh Dave <https://github.com/brijeshdave>
// The catalogues behind the module: what can be done to a part, what gets used
// up doing it, and the kinds of part themselves.
//
// Every read and write is scoped by companyId. These are per-tenant vocabularies
// — two companies calling a service kind "Refill" mean their own — and a query
// that forgets is SF-006.
import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  consumables,
  partModelCompatibility,
  partModelServiceRates,
  partModels,
  serviceKindConsumables,
  serviceKinds,
} from "@/core/db/schema.js";

/* ------------------------------ service kinds ------------------------------ */

export interface ServiceKindRow {
  id: string;
  name: string;
  description: string | null;
  defaultPoints: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function listServiceKinds(
  companyId: string,
  activeOnly = false,
): Promise<ServiceKindRow[]> {
  return db
    .select({
      id: serviceKinds.id,
      name: serviceKinds.name,
      description: serviceKinds.description,
      defaultPoints: serviceKinds.defaultPoints,
      status: serviceKinds.status,
      createdAt: serviceKinds.createdAt,
      updatedAt: serviceKinds.updatedAt,
    })
    .from(serviceKinds)
    .where(
      and(
        eq(serviceKinds.companyId, companyId),
        activeOnly ? eq(serviceKinds.status, "active") : undefined,
      ),
    )
    .orderBy(asc(serviceKinds.name));
}

export async function getServiceKind(
  id: string,
  companyId: string,
): Promise<ServiceKindRow | null> {
  const [row] = await db
    .select({
      id: serviceKinds.id,
      name: serviceKinds.name,
      description: serviceKinds.description,
      defaultPoints: serviceKinds.defaultPoints,
      status: serviceKinds.status,
      createdAt: serviceKinds.createdAt,
      updatedAt: serviceKinds.updatedAt,
    })
    .from(serviceKinds)
    .where(and(eq(serviceKinds.id, id), eq(serviceKinds.companyId, companyId)));
  return row ?? null;
}

export async function insertServiceKind(
  companyId: string,
  values: { name: string; description?: string | null; defaultPoints: number },
): Promise<string> {
  const [row] = await db
    .insert(serviceKinds)
    .values({ companyId, ...values, description: values.description ?? null })
    .returning({ id: serviceKinds.id });
  return row!.id;
}

export async function updateServiceKind(
  id: string,
  companyId: string,
  patch: Partial<{
    name: string;
    description: string | null;
    defaultPoints: number;
    status: string;
  }>,
): Promise<void> {
  await db
    .update(serviceKinds)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(serviceKinds.id, id), eq(serviceKinds.companyId, companyId)));
}

/** What a kind may consume, and the quantities it is bounded by. */
export interface KindConsumableRow {
  consumableId: string;
  minQuantity: number;
  maxQuantity: number | null;
}

export async function consumablesForKind(serviceKindId: string): Promise<KindConsumableRow[]> {
  return db
    .select({
      consumableId: serviceKindConsumables.consumableId,
      minQuantity: serviceKindConsumables.minQuantity,
      maxQuantity: serviceKindConsumables.maxQuantity,
    })
    .from(serviceKindConsumables)
    .where(eq(serviceKindConsumables.serviceKindId, serviceKindId));
}

/** The same for several kinds at once — the catalogue list's join. */
export async function consumablesForKinds(
  serviceKindIds: string[],
): Promise<Map<string, KindConsumableRow[]>> {
  const out = new Map<string, KindConsumableRow[]>();
  if (serviceKindIds.length === 0) return out;
  const rows = await db
    .select({
      serviceKindId: serviceKindConsumables.serviceKindId,
      consumableId: serviceKindConsumables.consumableId,
      minQuantity: serviceKindConsumables.minQuantity,
      maxQuantity: serviceKindConsumables.maxQuantity,
    })
    .from(serviceKindConsumables)
    .where(inArray(serviceKindConsumables.serviceKindId, serviceKindIds));
  for (const row of rows) {
    const list = out.get(row.serviceKindId) ?? [];
    list.push({
      consumableId: row.consumableId,
      minQuantity: row.minQuantity,
      maxQuantity: row.maxQuantity,
    });
    out.set(row.serviceKindId, list);
  }
  return out;
}

/** Replace a kind's consumable rules wholesale — the same shape as compatibility. */
export async function replaceKindConsumables(
  serviceKindId: string,
  rows: KindConsumableRow[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(serviceKindConsumables)
      .where(eq(serviceKindConsumables.serviceKindId, serviceKindId));
    if (rows.length === 0) return;
    await tx.insert(serviceKindConsumables).values(
      rows.map((row) => ({
        serviceKindId,
        consumableId: row.consumableId,
        minQuantity: row.minQuantity,
        maxQuantity: row.maxQuantity,
      })),
    );
  });
}

/* -------------------------------- consumables ------------------------------ */

export interface ConsumableRow {
  id: string;
  name: string;
  unit: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function listConsumables(
  companyId: string,
  activeOnly = false,
): Promise<ConsumableRow[]> {
  return db
    .select({
      id: consumables.id,
      name: consumables.name,
      unit: consumables.unit,
      status: consumables.status,
      createdAt: consumables.createdAt,
      updatedAt: consumables.updatedAt,
    })
    .from(consumables)
    .where(
      and(
        eq(consumables.companyId, companyId),
        activeOnly ? eq(consumables.status, "active") : undefined,
      ),
    )
    .orderBy(asc(consumables.name));
}

export async function getConsumable(id: string, companyId: string): Promise<ConsumableRow | null> {
  const [row] = await db
    .select({
      id: consumables.id,
      name: consumables.name,
      unit: consumables.unit,
      status: consumables.status,
      createdAt: consumables.createdAt,
      updatedAt: consumables.updatedAt,
    })
    .from(consumables)
    .where(and(eq(consumables.id, id), eq(consumables.companyId, companyId)));
  return row ?? null;
}

/** The ones a service event may name, checked in one query rather than per line. */
export async function consumablesByIds(
  ids: string[],
  companyId: string,
): Promise<Map<string, ConsumableRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: consumables.id,
      name: consumables.name,
      unit: consumables.unit,
      status: consumables.status,
      createdAt: consumables.createdAt,
      updatedAt: consumables.updatedAt,
    })
    .from(consumables)
    .where(and(inArray(consumables.id, ids), eq(consumables.companyId, companyId)));
  return new Map(rows.map((row) => [row.id, row]));
}

export async function insertConsumable(
  companyId: string,
  values: { name: string; unit: string },
): Promise<string> {
  const [row] = await db
    .insert(consumables)
    .values({ companyId, ...values })
    .returning({ id: consumables.id });
  return row!.id;
}

export async function updateConsumable(
  id: string,
  companyId: string,
  patch: Partial<{ name: string; unit: string; status: string }>,
): Promise<void> {
  await db
    .update(consumables)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(consumables.id, id), eq(consumables.companyId, companyId)));
}

/* -------------------------------- part models ------------------------------ */

export interface PartModelRow {
  id: string;
  name: string;
  description: string | null;
  cycleLimit: number | null;
  ratedPageYield: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const partModelColumns = {
  id: partModels.id,
  name: partModels.name,
  description: partModels.description,
  cycleLimit: partModels.cycleLimit,
  ratedPageYield: partModels.ratedPageYield,
  status: partModels.status,
  createdAt: partModels.createdAt,
  updatedAt: partModels.updatedAt,
};

export async function listPartModels(
  companyId: string,
  activeOnly = false,
): Promise<PartModelRow[]> {
  return db
    .select(partModelColumns)
    .from(partModels)
    .where(
      and(
        eq(partModels.companyId, companyId),
        activeOnly ? eq(partModels.status, "active") : undefined,
      ),
    )
    .orderBy(asc(partModels.name));
}

export async function getPartModel(id: string, companyId: string): Promise<PartModelRow | null> {
  const [row] = await db
    .select(partModelColumns)
    .from(partModels)
    .where(and(eq(partModels.id, id), eq(partModels.companyId, companyId)));
  return row ?? null;
}

export async function insertPartModel(
  companyId: string,
  values: {
    name: string;
    description?: string | null;
    cycleLimit?: number | null;
    ratedPageYield?: number | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(partModels)
    .values({
      companyId,
      name: values.name,
      description: values.description ?? null,
      cycleLimit: values.cycleLimit ?? null,
      ratedPageYield: values.ratedPageYield ?? null,
    })
    .returning({ id: partModels.id });
  return row!.id;
}

export async function updatePartModel(
  id: string,
  companyId: string,
  patch: Partial<{
    name: string;
    description: string | null;
    cycleLimit: number | null;
    ratedPageYield: number | null;
    status: string;
  }>,
): Promise<void> {
  await db
    .update(partModels)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(partModels.id, id), eq(partModels.companyId, companyId)));
}

/* ----------------------------- compatibility ------------------------------- */

export async function compatibilityFor(partModelId: string): Promise<string[]> {
  const rows = await db
    .select({ deviceTypeId: partModelCompatibility.deviceTypeId })
    .from(partModelCompatibility)
    .where(eq(partModelCompatibility.partModelId, partModelId));
  return rows.map((row) => row.deviceTypeId);
}

/** The compatible types for several models at once — the list screen's join. */
export async function compatibilityForMany(partModelIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (partModelIds.length === 0) return out;
  const rows = await db
    .select({
      partModelId: partModelCompatibility.partModelId,
      deviceTypeId: partModelCompatibility.deviceTypeId,
    })
    .from(partModelCompatibility)
    .where(inArray(partModelCompatibility.partModelId, partModelIds));
  for (const row of rows) {
    out.set(row.partModelId, [...(out.get(row.partModelId) ?? []), row.deviceTypeId]);
  }
  return out;
}

/** Replace the whole set — the screen edits it as one list, not row by row. */
export async function replaceCompatibility(
  partModelId: string,
  deviceTypeIds: string[],
): Promise<void> {
  await db
    .delete(partModelCompatibility)
    .where(eq(partModelCompatibility.partModelId, partModelId));
  if (deviceTypeIds.length === 0) return;
  await db
    .insert(partModelCompatibility)
    .values(deviceTypeIds.map((deviceTypeId) => ({ partModelId, deviceTypeId })));
}

/* --------------------------------- rates ----------------------------------- */

export async function ratesFor(
  partModelId: string,
): Promise<{ serviceKindId: string; points: number }[]> {
  return db
    .select({
      serviceKindId: partModelServiceRates.serviceKindId,
      points: partModelServiceRates.points,
    })
    .from(partModelServiceRates)
    .where(eq(partModelServiceRates.partModelId, partModelId));
}

export async function replaceRates(
  partModelId: string,
  rates: { serviceKindId: string; points: number }[],
): Promise<void> {
  await db.delete(partModelServiceRates).where(eq(partModelServiceRates.partModelId, partModelId));
  if (rates.length === 0) return;
  await db.insert(partModelServiceRates).values(rates.map((rate) => ({ partModelId, ...rate })));
}

/**
 * What one service of this kind on this model is worth.
 *
 * The model's own rate if it has one, else the kind's default. Resolved here
 * rather than at the call site so the award and anything that displays the rate
 * cannot disagree about it.
 */
export async function rateFor(
  partModelId: string,
  serviceKindId: string,
  companyId: string,
): Promise<number> {
  const [override] = await db
    .select({ points: partModelServiceRates.points })
    .from(partModelServiceRates)
    .where(
      and(
        eq(partModelServiceRates.partModelId, partModelId),
        eq(partModelServiceRates.serviceKindId, serviceKindId),
      ),
    );
  if (override) return override.points;

  const kind = await getServiceKind(serviceKindId, companyId);
  return kind?.defaultPoints ?? 0;
}
