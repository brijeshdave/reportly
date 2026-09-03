// Author: Brijesh Dave <https://github.com/brijeshdave>
// Cartridge calls: the catalogues a company fills in, the parts themselves, and
// what has been done to each one.
//
// Every one of these 404s at a company that has not switched the module on. The
// screens are kept off the sidebar in that case rather than left to discover it
// — see `modules.parts` on the session.
import type {
  Consumable,
  CreateConsumable,
  CreatePart,
  CreatePartModel,
  CreateServiceKind,
  Part,
  PartEvent,
  PartModel,
  Placement,
  PlacementOutcome,
  RecordService,
  ReturnedPart,
  ServiceEvent,
  ServiceKind,
  ServiceRate,
} from "@reportly/shared";

import { http } from "@/services/http.js";

/* -------------------------------- catalogues ------------------------------- */

export const fetchServiceKinds = (activeOnly = false) =>
  http.get<ServiceKind[]>("/part-service-kinds", { query: activeOnly ? { activeOnly } : {} });
export const createServiceKind = (input: CreateServiceKind) =>
  http.post<ServiceKind>("/part-service-kinds", input);
export const updateServiceKind = (
  id: string,
  input: Partial<CreateServiceKind> & { status?: "active" | "inactive" },
) => http.patch<ServiceKind>(`/part-service-kinds/${id}`, input);

export const fetchConsumables = (activeOnly = false) =>
  http.get<Consumable[]>("/consumables", { query: activeOnly ? { activeOnly } : {} });
export const createConsumable = (input: CreateConsumable) =>
  http.post<Consumable>("/consumables", input);
export const updateConsumable = (
  id: string,
  input: Partial<CreateConsumable> & { status?: "active" | "inactive" },
) => http.patch<Consumable>(`/consumables/${id}`, input);

export const fetchPartModels = (activeOnly = false) =>
  http.get<PartModel[]>("/part-models", { query: activeOnly ? { activeOnly } : {} });
export const fetchPartModel = (id: string) => http.get<PartModel>(`/part-models/${id}`);
export const createPartModel = (input: CreatePartModel) =>
  http.post<PartModel>("/part-models", input);
export const updatePartModel = (
  id: string,
  input: Partial<CreatePartModel> & { status?: "active" | "inactive" },
) => http.patch<PartModel>(`/part-models/${id}`, input);

export const fetchRates = (partModelId: string) =>
  http.get<ServiceRate[]>(`/part-models/${partModelId}/rates`);
export const setRates = (partModelId: string, rates: ServiceRate[]) =>
  http.put<ServiceRate[]>(`/part-models/${partModelId}/rates`, { rates });

/* ---------------------------------- parts ---------------------------------- */

/** The devices this part's model fits — what the install picker offers.
 *  `occupiedBy` is the cartridge already in that machine, which the picker draws
 *  greyed rather than hiding. */
export const fetchFittingDevices = (id: string) =>
  http.get<{ id: string; name: string; typeName: string | null; occupiedBy: string | null }[]>(
    `/parts/${id}/fitting-devices`,
  );
export const fetchPart = (id: string) => http.get<Part>(`/parts/${id}`);
export const createPart = (input: CreatePart) => http.post<Part>("/parts", input);
export const updatePart = (
  id: string,
  input: { identifier?: string; notes?: string | null; locationId?: string | null },
) => http.patch<Part>(`/parts/${id}`, input);

export const fetchPartHistory = (id: string) => http.get<Placement[]>(`/parts/${id}/history`);
/** Installs, returns and services in one sequence — what the detail page reads. */
export const fetchPartTimeline = (id: string) => http.get<PartEvent[]>(`/parts/${id}/timeline`);

export const deployPart = (id: string, input: { deviceId: string; note?: string }) =>
  http.post<Part>(`/parts/${id}/deploy`, input);
/** Returns the part **and** whether booking it in took points back. */
export const returnPart = (id: string, input: { outcome: PlacementOutcome; note?: string }) =>
  http.post<ReturnedPart>(`/parts/${id}/return`, input);
export const restockPart = (id: string, locationId?: string | null) =>
  http.post<Part>(`/parts/${id}/restock`, { locationId });
export const scrapPart = (id: string) => http.post<Part>(`/parts/${id}/scrap`);

/* ------------------------------ service events ----------------------------- */

export const fetchPartServices = (id: string) => http.get<ServiceEvent[]>(`/parts/${id}/services`);
export const recordService = (id: string, input: RecordService) =>
  http.post<ServiceEvent>(`/parts/${id}/services`, input);
