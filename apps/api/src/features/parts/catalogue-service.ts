// Author: Brijesh Dave <https://github.com/brijeshdave>
// Rules for the module's catalogues: service kinds, consumables, part models and
// what each model fits and pays.
//
// The rules here are mostly about retirement. Nothing in this module is deleted:
// a service kind that was used to score work stays, or the history it scored
// loses its meaning. `inactive` means "no longer offered", never "gone".
import {
  ERROR_CODES,
  type Consumable,
  type CreateConsumable,
  type CreatePartModel,
  type CreateServiceKind,
  type PartModel,
  type ServiceKind,
  type ServiceRate,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import * as repo from "@/features/parts/catalogue-repo.js";

const iso = (d: Date) => d.toISOString();

/* ------------------------------ service kinds ------------------------------ */

function toServiceKind(
  row: repo.ServiceKindRow,
  consumables: repo.KindConsumableRow[],
): ServiceKind {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    defaultPoints: row.defaultPoints,
    status: row.status === "inactive" ? "inactive" : "active",
    consumables,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function withConsumables(row: repo.ServiceKindRow): Promise<ServiceKind> {
  return toServiceKind(row, await repo.consumablesForKind(row.id));
}

export async function listServiceKinds(
  companyId: string,
  activeOnly = false,
): Promise<ServiceKind[]> {
  const rows = await repo.listServiceKinds(companyId, activeOnly);
  // One join for the page rather than a query per kind.
  const rules = await repo.consumablesForKinds(rows.map((row) => row.id));
  return rows.map((row) => toServiceKind(row, rules.get(row.id) ?? []));
}

export async function createServiceKind(
  companyId: string,
  input: CreateServiceKind,
): Promise<ServiceKind> {
  const id = await repo.insertServiceKind(companyId, {
    name: input.name,
    description: input.description ?? null,
    defaultPoints: input.defaultPoints,
  });
  if (input.consumables) await repo.replaceKindConsumables(id, input.consumables);
  return withConsumables((await repo.getServiceKind(id, companyId))!);
}

export async function updateServiceKind(
  id: string,
  companyId: string,
  patch: Partial<CreateServiceKind> & { status?: "active" | "inactive" },
): Promise<ServiceKind> {
  const existing = await repo.getServiceKind(id, companyId);
  if (!existing) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Service kind not found");

  await repo.updateServiceKind(id, companyId, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
    ...(patch.defaultPoints !== undefined ? { defaultPoints: patch.defaultPoints } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  });
  // Absent leaves the rules alone; an empty array means "no restriction", which
  // is a real thing to say and different from not mentioning them.
  if (patch.consumables !== undefined) await repo.replaceKindConsumables(id, patch.consumables);
  return withConsumables((await repo.getServiceKind(id, companyId))!);
}

/* -------------------------------- consumables ------------------------------ */

function toConsumable(row: repo.ConsumableRow): Consumable {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit === "g" ? "g" : row.unit === "ml" ? "ml" : "ea",
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listConsumables(
  companyId: string,
  activeOnly = false,
): Promise<Consumable[]> {
  return (await repo.listConsumables(companyId, activeOnly)).map(toConsumable);
}

export async function createConsumable(
  companyId: string,
  input: CreateConsumable,
): Promise<Consumable> {
  const id = await repo.insertConsumable(companyId, { name: input.name, unit: input.unit });
  return toConsumable((await repo.getConsumable(id, companyId))!);
}

export async function updateConsumable(
  id: string,
  companyId: string,
  patch: Partial<CreateConsumable> & { status?: "active" | "inactive" },
): Promise<Consumable> {
  const existing = await repo.getConsumable(id, companyId);
  if (!existing) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Consumable not found");

  await repo.updateConsumable(id, companyId, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    // The unit is deliberately editable: a company that started counting toner in
    // `ea` and moved to grams should not need a second consumable. Past events
    // keep the number they recorded — this is a label, not a conversion.
    ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  });
  return toConsumable((await repo.getConsumable(id, companyId))!);
}

/* -------------------------------- part models ------------------------------ */

async function toPartModel(row: repo.PartModelRow): Promise<PartModel> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    cycleLimit: row.cycleLimit,
    ratedPageYield: row.ratedPageYield,
    status: row.status === "inactive" ? "inactive" : "active",
    compatibleDeviceTypeIds: await repo.compatibilityFor(row.id),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listPartModels(companyId: string, activeOnly = false): Promise<PartModel[]> {
  const rows = await repo.listPartModels(companyId, activeOnly);
  // One join for the whole page rather than a compatibility query per row.
  const compat = await repo.compatibilityForMany(rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    cycleLimit: row.cycleLimit,
    ratedPageYield: row.ratedPageYield,
    status: row.status === "inactive" ? ("inactive" as const) : ("active" as const),
    compatibleDeviceTypeIds: compat.get(row.id) ?? [],
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }));
}

export async function getPartModel(id: string, companyId: string): Promise<PartModel> {
  const row = await repo.getPartModel(id, companyId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Part model not found");
  return toPartModel(row);
}

export async function createPartModel(
  companyId: string,
  input: CreatePartModel,
): Promise<PartModel> {
  const id = await repo.insertPartModel(companyId, {
    name: input.name,
    description: input.description ?? null,
    cycleLimit: input.cycleLimit ?? null,
    ratedPageYield: input.ratedPageYield ?? null,
  });
  await repo.replaceCompatibility(id, input.compatibleDeviceTypeIds);
  return getPartModel(id, companyId);
}

export async function updatePartModel(
  id: string,
  companyId: string,
  patch: Partial<CreatePartModel> & { status?: "active" | "inactive" },
): Promise<PartModel> {
  const existing = await repo.getPartModel(id, companyId);
  if (!existing) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Part model not found");

  await repo.updatePartModel(id, companyId, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
    ...(patch.cycleLimit !== undefined ? { cycleLimit: patch.cycleLimit ?? null } : {}),
    ...(patch.ratedPageYield !== undefined ? { ratedPageYield: patch.ratedPageYield ?? null } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  });
  // Absent means "leave it alone"; an empty array means "fits nothing", which is
  // a real thing to say about a model being retired.
  if (patch.compatibleDeviceTypeIds !== undefined) {
    await repo.replaceCompatibility(id, patch.compatibleDeviceTypeIds);
  }
  return getPartModel(id, companyId);
}

/* --------------------------------- rates ----------------------------------- */

export async function getRates(partModelId: string, companyId: string): Promise<ServiceRate[]> {
  await getPartModel(partModelId, companyId);
  return repo.ratesFor(partModelId);
}

/**
 * Set what a model pays for each kind.
 *
 * Every kind named has to belong to this company — otherwise a rate could quietly
 * point at another tenant's vocabulary and pay against it.
 */
export async function setRates(
  partModelId: string,
  companyId: string,
  rates: ServiceRate[],
): Promise<ServiceRate[]> {
  await getPartModel(partModelId, companyId);

  const known = new Set((await repo.listServiceKinds(companyId)).map((kind) => kind.id));
  const stranger = rates.find((rate) => !known.has(rate.serviceKindId));
  if (stranger) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That service kind does not exist here");
  }

  await repo.replaceRates(partModelId, rates);
  return repo.ratesFor(partModelId);
}
