// Author: Brijesh Dave <https://github.com/brijeshdave>
// Group service calls. Assignment writes replace the whole set, so an editor must
// read `fetchGroupAssignments` first — saving one tab must not wipe another.
import type { Group } from "@reportly/shared";

import { download, http } from "@/services/http.js";

/* ------------------------------ Import / export ---------------------------- */

export interface ImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/** Download groups and the roles they carry as an .xlsx. */
export function exportGroups(): Promise<void> {
  return download("/groups/export", "groups.xlsx");
}

/** Download the blank group import template. */
export function downloadGroupTemplate(): Promise<void> {
  return download("/groups/import/template", "group-import-template.xlsx");
}

/** Upload a spreadsheet of groups — all-or-nothing on the server. */
export function importGroups(file: File): Promise<ImportOutcome> {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<ImportOutcome>("/groups/import", form);
}

export interface GroupAssignments {
  users: string[];
  roles: string[];
}

export type AssignmentKind = keyof GroupAssignments;

export function fetchGroup(id: string): Promise<Group> {
  return http.get<Group>(`/groups/${id}`);
}

export function fetchGroupAssignments(id: string): Promise<GroupAssignments> {
  return http.get<GroupAssignments>(`/groups/${id}/assignments`);
}

export function createGroup(name: string): Promise<Group> {
  return http.post<Group>("/groups", { name });
}

export function renameGroup(id: string, name: string): Promise<Group> {
  return http.patch<Group>(`/groups/${id}`, { name });
}

/** Turn the two-factor requirement on or off for everybody in this group. */
export function setGroupTwoFactor(id: string, requiresTwoFactor: boolean): Promise<Group> {
  return http.patch<Group>(`/groups/${id}`, { requiresTwoFactor });
}

/**
 * What deleting this group would revoke. A group holds no data of its own, so the
 * delete is not guarded — but it does take away its members' access, and the
 * confirmation should say how many people that is.
 */
export interface GroupImpact {
  members: number;
  roles: number;
}

export function fetchGroupImpact(id: string): Promise<GroupImpact> {
  return http.get<GroupImpact>(`/groups/${id}/impact`);
}

export function deleteGroup(id: string): Promise<void> {
  return http.delete<void>(`/groups/${id}`);
}

/** System groups are immutable; cloning gives you an editable copy of them. */
export function cloneGroup(id: string, name: string): Promise<Group> {
  return http.post<Group>(`/groups/${id}/clone`, { name });
}

/** Replaces the entire set for `kind`. Pass every id you want to keep. */
export function setGroupAssignment(
  id: string,
  kind: AssignmentKind,
  ids: string[],
): Promise<{ assigned: string[] }> {
  return http.put<{ assigned: string[] }>(`/groups/${id}/${kind}`, { ids });
}
