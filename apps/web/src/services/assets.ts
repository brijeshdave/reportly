// Author: Brijesh Dave <https://github.com/brijeshdave>
// The scope master lists: the asset tree (small, fetched whole — it is the handful
// of structural things) and the device registry (searchable and paginated — there
// may be thousands, so it is never fetched whole).
import type {
  Asset,
  AssetNode,
  AssetTypeRow,
  CreateAsset,
  CreateAssetType,
  CreateDevice,
  Device,
  PaginatedResult,
  JournalEntryRow,
  UpdateAsset,
  UpdateAssetType,
  UpdateDevice,
} from "@reportly/shared";

import type { ListState } from "@/lib/list-query.js";
import { download, http } from "@/services/http.js";
import { fetchList } from "@/services/list.js";

/* Asset types — the vocabulary the tree is built from. */
export const fetchAssetTypes = () => http.get<AssetTypeRow[]>("/asset-types");
export const fetchAssetTypeOptions = () =>
  http.get<{ id: string; name: string }[]>("/asset-types/options");
export const createAssetType = (input: CreateAssetType) =>
  http.post<AssetTypeRow>("/asset-types", input);
export const updateAssetType = (id: string, input: UpdateAssetType) =>
  http.patch<AssetTypeRow>(`/asset-types/${id}`, input);
export const deleteAssetType = (id: string) => http.delete<void>(`/asset-types/${id}`);

/* Assets — flat over the wire; the page assembles the tree from parentId. */
export const fetchAssets = () => http.get<AssetNode[]>("/assets");
export const createAsset = (input: CreateAsset) => http.post<Asset>("/assets", input);
export const updateAsset = (id: string, input: UpdateAsset) =>
  http.patch<Asset>(`/assets/${id}`, input);
export const deleteAsset = (id: string) => http.delete<void>(`/assets/${id}`);

/** The roll-up: reports on this asset, anything under it, or the devices there. */
export const fetchReportsUnderAsset = (
  id: string,
  state: ListState,
): Promise<PaginatedResult<JournalEntryRow>> =>
  fetchList<JournalEntryRow>(`/assets/${id}/journal`, state);

/* Devices — searchable, never fetched whole. */
export const fetchDevices = (state: ListState): Promise<PaginatedResult<Device>> =>
  fetchList<Device>("/devices", state);
export const createDevice = (input: CreateDevice) => http.post<Device>("/devices", input);
export const updateDevice = (id: string, input: UpdateDevice) =>
  http.patch<Device>(`/devices/${id}`, input);
export const deleteDevice = (id: string) => http.delete<void>(`/devices/${id}`);

/** One row that could not be created, and why — reported per line, never dropped. */
export interface DeviceImportProblem {
  line: number;
  message: string;
}
export interface DeviceImportOutcome {
  created: number;
  problems: DeviceImportProblem[];
}

/** Download the device register as an .xlsx (the same columns the import reads). */
export const exportDevices = () => download("/devices/export", "devices.xlsx");

/** Download the blank .xlsx template with its header row and an example. */
export const downloadDeviceTemplate = () =>
  download("/devices/import/template", "device-import-template.xlsx");

/**
 * Upload a spreadsheet of devices. It is all-or-nothing on the server: a rejected
 * file answers 422 with the per-line problems, which arrive here as an ApiError
 * carrying the same shape in its details.
 */
export const importDevices = (
  file: File,
  departmentId: string | null,
): Promise<DeviceImportOutcome> => {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<DeviceImportOutcome>("/devices/import", form, {
    query: { departmentId: departmentId ?? undefined },
  });
};

/* ------------------------------ Asset import / export ---------------------- */

export interface AssetImportOutcome {
  created: number;
  updated: number;
  problems: DeviceImportProblem[];
}

/** Download the whole asset tree as an .xlsx (one row per asset, by path). */
export const exportAssets = () => download("/assets/export", "assets.xlsx");

/** Download the blank asset import template. */
export const downloadAssetTemplate = () =>
  download("/assets/import/template", "asset-import-template.xlsx");

/** Upload a spreadsheet to build/update the asset tree — all-or-nothing on the server. */
export const importAssets = (file: File): Promise<AssetImportOutcome> => {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<AssetImportOutcome>("/assets/import", form);
};

/* --------------------------- Asset type import / export -------------------- */

/** Download the asset-type vocabulary as an .xlsx. */
export const exportAssetTypes = () => download("/asset-types/export", "asset-types.xlsx");

/** Download the blank asset-type import template. */
export const downloadAssetTypeTemplate = () =>
  download("/asset-types/import/template", "asset-type-import-template.xlsx");

/** Upload a spreadsheet of asset types — all-or-nothing on the server. */
export const importAssetTypes = (file: File): Promise<AssetImportOutcome> => {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<AssetImportOutcome>("/asset-types/import", form);
};
