// Author: Brijesh Dave <https://github.com/brijeshdave>
// Department service calls. Departments belong to the active company, so — like
// locations — every call is scoped by the active-company header the http client
// already attaches. The list comes back flat; the tree is assembled from
// `parentId` on the page.
import type {
  Department,
  DepartmentMember,
  DepartmentNode,
  DownlineMember,
  OrgChartNode,
  OrgPerson,
  SetDepartmentMembers,
  UserDepartment,
} from "@reportly/shared";

import { download, http } from "@/services/http.js";

export function fetchDepartments(): Promise<DepartmentNode[]> {
  return http.get<DepartmentNode[]>("/departments");
}

/* ------------------------------ Import / export ---------------------------- */

export interface ImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/** Download the org tree as an .xlsx (one row per department, by path). */
export function exportDepartments(): Promise<void> {
  return download("/departments/export", "departments.xlsx");
}

/** Download the blank department import template. */
export function downloadDepartmentTemplate(): Promise<void> {
  return download("/departments/import/template", "department-import-template.xlsx");
}

/** Upload a spreadsheet to build/update the org tree — all-or-nothing on the server. */
export function importDepartments(file: File): Promise<ImportOutcome> {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<ImportOutcome>("/departments/import", form);
}

export function fetchDepartment(id: string): Promise<Department> {
  return http.get<Department>(`/departments/${id}`);
}

export function createDepartment(input: {
  name: string;
  parentId?: string | null;
}): Promise<Department> {
  return http.post<Department>("/departments", input);
}

export function updateDepartment(
  id: string,
  input: { name?: string; parentId?: string | null },
): Promise<Department> {
  return http.patch<Department>(`/departments/${id}`, input);
}

export function setDepartmentStatus(
  id: string,
  status: "active" | "inactive",
): Promise<Department> {
  const action = status === "active" ? "reactivate" : "deactivate";
  return http.post<Department>(`/departments/${id}/${action}`);
}

export function deleteDepartment(id: string): Promise<void> {
  return http.delete<void>(`/departments/${id}`);
}

export function fetchDepartmentMembers(id: string): Promise<DepartmentMember[]> {
  return http.get<DepartmentMember[]>(`/departments/${id}/members`);
}

export function setDepartmentMembers(
  id: string,
  members: SetDepartmentMembers["members"],
): Promise<DepartmentMember[]> {
  return http.put<DepartmentMember[]>(`/departments/${id}/members`, { members });
}

/**
 * The whole organisation chart for the active company: every membership with its
 * reporting edge. One call — the page draws the forest without a request per node.
 */
export function fetchOrgChart(): Promise<OrgChartNode[]> {
  return http.get<OrgChartNode[]>("/departments/org-chart");
}

/**
 * Everyone with a membership in the active company. These are the only people a
 * reporting edge may name, so the manager picker is built from exactly this list.
 */
export function fetchOrgPeople(): Promise<OrgPerson[]> {
  return http.get<OrgPerson[]>("/departments/people");
}

/**
 * Everyone below this person in the reporting line, at any depth — the set the
 * reports feature will scope on.
 */
export function fetchDownline(userId: string): Promise<DownlineMember[]> {
  return http.get<DownlineMember[]>(`/users/${userId}/downline`);
}

/** The departments a given user belongs to, shown on their profile. */
export function fetchUserDepartments(userId: string): Promise<UserDepartment[]> {
  return http.get<UserDepartment[]>(`/users/${userId}/departments`);
}
