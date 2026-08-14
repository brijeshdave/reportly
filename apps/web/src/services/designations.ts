// Author: Brijesh Dave <https://github.com/brijeshdave>
// Designation service calls. Users point at one by id, so a rename here corrects
// everybody holding it — which is why the picker fetches the catalogue rather than
// letting anyone type a job title afresh.
import type { CreateDesignation, DesignationRow, UpdateDesignation } from "@reportly/shared";

import { http } from "@/services/http.js";

/** The choices offered on a profile: active ones only. */
export interface DesignationOption {
  id: string;
  name: string;
}

export function fetchDesignationOptions(): Promise<DesignationOption[]> {
  return http.get<DesignationOption[]>("/designations/options");
}

export function fetchDesignation(id: string): Promise<DesignationRow> {
  return http.get<DesignationRow>(`/designations/${id}`);
}

export function createDesignation(input: CreateDesignation): Promise<DesignationRow> {
  return http.post<DesignationRow>("/designations", input);
}

export function updateDesignation(id: string, input: UpdateDesignation): Promise<DesignationRow> {
  return http.patch<DesignationRow>(`/designations/${id}`, input);
}

/** Refused while anybody holds it — retire it instead, and they keep it. */
export function deleteDesignation(id: string): Promise<void> {
  return http.delete<void>(`/designations/${id}`);
}
