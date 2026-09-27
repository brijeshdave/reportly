// Author: Brijesh Dave <https://github.com/brijeshdave>
// End users — the supported people who have no Reportly account. The list itself
// goes through `useListResource` like every other table; only the single-record
// calls and the journal's picker live here.
import type { CreateEndUser, EndUser, UpdateEndUser } from "@reportly/shared";

import { download, http } from "@/services/http.js";

export const fetchEndUser = (id: string) => http.get<EndUser>(`/end-users/${id}`);

export const createEndUser = (input: CreateEndUser) => http.post<EndUser>("/end-users", input);

export const updateEndUser = (id: string, input: UpdateEndUser) =>
  http.patch<EndUser>(`/end-users/${id}`, input);

export const deleteEndUser = (id: string) => http.delete<void>(`/end-users/${id}`);

export interface PickableEndUser {
  id: string;
  fullName: string;
  employeeNumber: string;
  departmentName: string | null;
}

/**
 * The active people the journal may offer, narrowed to the departments chosen on
 * the entry.
 *
 * The narrowing is the server's, not the browser's: the whole list could be
 * thousands of people, and filtering a list you already downloaded is only cheap
 * until it isn't.
 */
export function fetchPickableEndUsers(departmentIds: string[]): Promise<PickableEndUser[]> {
  const query = departmentIds.length > 0 ? `?departmentIds=${departmentIds.join(",")}` : "";
  return http.get<PickableEndUser[]>(`/end-users/pickable${query}`);
}

/** Download the list as a spreadsheet, in the shape the import reads back. */
export const exportEndUsers = () => download("/end-users/export", "end-users.xlsx");

export const downloadEndUserTemplate = () =>
  download("/end-users/import/template", "end-user-import-template.xlsx");

export interface EndUserImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/** Upload a spreadsheet of people — all or nothing on the server. */
export const importEndUsers = (file: File): Promise<EndUserImportOutcome> => {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<EndUserImportOutcome>("/end-users/import", form);
};
