// Author: Brijesh Dave <https://github.com/brijeshdave>
// Device types and tags — a department's own vocabulary. Both are small
// per-department catalogues fetched whole (a department has tens of these, not
// thousands), so neither is paginated.
import type {
  CreateDeviceType,
  CreateTag,
  DeviceTypeRow,
  TagRow,
  UpdateDeviceType,
  UpdateTag,
} from "@reportly/shared";

import { http } from "@/services/http.js";

/** Both lists take a department filter — the pickers ask for their own only. */
const byDepartment = (departmentId?: string): string =>
  departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : "";

/* ------------------------------- device types ------------------------------ */

export const fetchDeviceTypes = (departmentId?: string) =>
  http.get<DeviceTypeRow[]>(`/device-types${byDepartment(departmentId)}`);

export const createDeviceType = (input: CreateDeviceType) =>
  http.post<DeviceTypeRow>("/device-types", input);

export const updateDeviceType = (id: string, input: UpdateDeviceType) =>
  http.patch<DeviceTypeRow>(`/device-types/${id}`, input);

export const deleteDeviceType = (id: string) => http.delete<void>(`/device-types/${id}`);

/* ----------------------------------- tags ---------------------------------- */

export const fetchTags = (departmentId?: string) =>
  http.get<TagRow[]>(`/tags${byDepartment(departmentId)}`);

export const createTag = (input: CreateTag) => http.post<TagRow>("/tags", input);

export const updateTag = (id: string, input: UpdateTag) => http.patch<TagRow>(`/tags/${id}`, input);

export const deleteTag = (id: string) => http.delete<void>(`/tags/${id}`);
