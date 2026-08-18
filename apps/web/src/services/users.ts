// Author: Brijesh Dave <https://github.com/brijeshdave>
// User service calls. Lists go through the generic list service; everything else
// is a plain request against the users API.
import type { CreateUser, Group, PageSize, UpdateUser, User } from "@reportly/shared";

import { PICKER_PAGE_SIZE, download, http } from "@/services/http.js";

/* ------------------------------ Import / export ---------------------------- */

export interface ImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/** Download the roster (with each person's groups and companies) as an .xlsx. */
export function exportUsers(): Promise<void> {
  return download("/users/export", "users.xlsx");
}

/** Download the blank user import template. */
export function downloadUserTemplate(): Promise<void> {
  return download("/users/import/template", "user-import-template.xlsx");
}

/** Upload a roster — new people are invited (no passwords in the file). */
export function importUsers(file: File): Promise<ImportOutcome> {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<ImportOutcome>("/users/import", form);
}

export function fetchUser(id: string): Promise<User> {
  return http.get<User>(`/users/${id}`);
}

/**
 * A page of users matching a search term — the server does the matching.
 *
 * A picker that downloads everybody and filters in the browser is fine at fifty
 * people and unusable at five thousand; this asks for the handful that match.
 *
 * `limit` is a `PageSize`, not a number. The API accepts only the sizes in the
 * shared list, and this asked for 8 — so every search 400'd, the error was swallowed
 * into an empty result, and the box reported "nobody matches" for everybody who
 * exists. Typing it against the same list the API validates against is what stops
 * that being expressible again.
 */
export function searchUsers(term: string, limit: PageSize = 10): Promise<User[]> {
  const filters = term.trim()
    ? JSON.stringify([{ field: "name", op: "contains", value: term.trim() }])
    : undefined;
  return http
    .get<{ data: User[] }>("/users", {
      query: { page: 1, pageSize: limit, sortBy: "name", sortDir: "asc", filters },
    })
    .then((body) => body.data);
}

/**
 * Create a user outright. With a password they can sign in at once (and are made
 * to change it); without one they get the same set-password email an invite sends.
 */
export function createUser(input: CreateUser): Promise<User> {
  return http.post<User>("/users", input);
}

/** The groups this user belongs to — the only thing that grants them access. */
export function fetchUserGroups(id: string): Promise<Group[]> {
  return http.get<Group[]>(`/users/${id}/groups`);
}

export function inviteUser(input: { name: string; email: string }): Promise<User> {
  return http.post<User>("/users/invite", input);
}

export function updateUser(id: string, input: UpdateUser): Promise<User> {
  return http.patch<User>(`/users/${id}`, input);
}

/**
 * Remove a user's two-factor enrolment, so they can set it up again after losing
 * their authenticator and their recovery codes. Signs them out everywhere and
 * emails them that it happened.
 */
export function resetUserTwoFactor(id: string): Promise<{ user: User; wasEnabled: boolean }> {
  return http.post<{ user: User; wasEnabled: boolean }>(`/users/${id}/two-factor/reset`);
}

/** Set a new password on a user's account (admin only). Forces a change at next sign-in. */
export function resetUserPassword(id: string, password: string): Promise<User> {
  return http.post<User>(`/users/${id}/reset-password`, { password });
}

/** Deactivation is reversible and never deletes; the last superadmin is protected. */
export function setUserStatus(id: string, status: "active" | "inactive"): Promise<User> {
  return http.post<User>(`/users/${id}/${status === "active" ? "reactivate" : "deactivate"}`);
}

/** One of a user's live sessions, as an administrator sees it. */
export interface UserSession {
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  /** True for the session making the request (only ever the viewer's own). */
  current: boolean;
}

export function fetchUserSessions(id: string): Promise<UserSession[]> {
  return http.get<UserSession[]>(`/users/${id}/sessions`);
}

/** The token travels in the body: every request URL is written to the log database. */
export function revokeUserSession(id: string, token: string): Promise<void> {
  return http.post<void>(`/users/${id}/sessions/revoke`, { token });
}

export function updateMyProfile(input: {
  name?: string;
  avatarUrl?: string | null;
}): Promise<User> {
  return http.patch<User>("/me/profile", input);
}

/** Where a person may work: the companies they may open, and the sites within them. */
export interface UserScope {
  companies: string[];
  /** Empty means every site of those companies. */
  locations: string[];
}

export const fetchUserScope = (id: string) => http.get<UserScope>(`/users/${id}/scope`);

export const saveUserCompanies = (id: string, ids: string[]) =>
  http.put<{ assigned: string[] }>(`/users/${id}/companies`, { ids });

export const saveUserLocations = (id: string, ids: string[]) =>
  http.put<{ assigned: string[] }>(`/users/${id}/locations`, { ids });

/** Every company, for the scope picker. */
export const fetchAllCompanies = () =>
  http
    .get<{ data: { id: string; name: string }[] }>("/companies", {
      query: { pageSize: PICKER_PAGE_SIZE },
    })
    .then((r) => r.data);

export const saveUserGroups = (id: string, ids: string[]) =>
  http.put<{ assigned: string[] }>(`/users/${id}/groups`, { ids });

export const saveUserDepartments = (
  id: string,
  departments: {
    departmentId: string;
    rank: string;
    // Omitted means "leave it as the department's own Members tab set it".
    reportsToId?: string | null;
    locationIds?: string[];
  }[],
) => http.put<{ assigned: number }>(`/users/${id}/departments`, { departments });

/** Every group, for the picker on a user's Groups tab. */
export const fetchAllGroups = () =>
  http
    .get<{ data: { id: string; name: string; isSystem: boolean }[] }>("/groups", {
      query: { pageSize: PICKER_PAGE_SIZE },
    })
    .then((r) => r.data);

/** The roles a person ends up with, and what those roles add up to. */
export interface EffectiveAccess {
  roles: { id: string; name: string; isSystem: boolean }[];
  permissions: string[];
}
export const fetchUserAccess = (id: string) => http.get<EffectiveAccess>(`/users/${id}/access`);
