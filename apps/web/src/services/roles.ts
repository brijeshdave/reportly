// Author: Brijesh Dave <https://github.com/brijeshdave>
// Role service calls. System roles are immutable but clonable — editing one would
// silently re-grant every group that holds it. Custom roles are fully editable.
import type { Permission, Role } from "@reportly/shared";

import { download, http } from "@/services/http.js";

/* ------------------------------ Import / export ---------------------------- */

export interface ImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/** Download roles and the permissions they grant as an .xlsx. */
export function exportRoles(): Promise<void> {
  return download("/roles/export", "roles.xlsx");
}

/** Download the blank role import template. */
export function downloadRoleTemplate(): Promise<void> {
  return download("/roles/import/template", "role-import-template.xlsx");
}

/** Upload a spreadsheet of roles — all-or-nothing on the server. */
export function importRoles(file: File): Promise<ImportOutcome> {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<ImportOutcome>("/roles/import", form);
}
import type { Reference } from "@/services/locations.js";

/** How many people would lose all access if the shipped roles were switched off. */
export function fetchSystemRoleImpact(): Promise<{ users: number; groups: number }> {
  return http.get<{ users: number; groups: number }>("/roles/system-impact");
}

export function fetchRole(id: string): Promise<Role> {
  return http.get<Role>(`/roles/${id}`);
}

export function createRole(name: string, permissions: Permission[]): Promise<Role> {
  return http.post<Role>("/roles", { name, permissions });
}

/** Omit a field to leave it alone. System roles are refused with 400. */
export function updateRole(
  id: string,
  input: { name?: string; permissions?: Permission[] },
): Promise<Role> {
  return http.patch<Role>(`/roles/${id}`, input);
}

/** An editable copy of any role, system ones included. */
export function cloneRole(id: string, name: string): Promise<Role> {
  return http.post<Role>(`/roles/${id}/clone`, { name });
}

/** Refused with 409 while any group holds the role. */
export function deleteRole(id: string): Promise<void> {
  return http.delete<void>(`/roles/${id}`);
}

/** The groups a change or deletion would affect. */
export function fetchRoleReferences(id: string): Promise<Reference[]> {
  return http.get<{ groups: Reference[] }>(`/roles/${id}/references`).then((body) => body.groups);
}
