// Author: Brijesh Dave <https://github.com/brijeshdave>
// Location service calls. Names are unique per company, and each company's
// auto-created Remote location cannot be deleted.
//
// Every one of these endpoints is scoped by the active-company header rather than
// by a companyId in the path or body. The company detail page acts on the company
// it is showing, which is not necessarily the one selected in the top-bar switcher
// (and may be none at all, when "All companies" is chosen). So each call states
// its company explicitly instead of relying on that selection.
import type { Location } from "@reportly/shared";

import { download, http } from "@/services/http.js";

/** Overrides the active-company header for a call about one specific company. */
const inCompany = (companyId: string) => ({ headers: { "X-Company-Id": companyId } });

export function fetchLocation(companyId: string, id: string): Promise<Location> {
  return http.get<Location>(`/locations/${id}`, inCompany(companyId));
}

/** Every location of one company. Complete and access-scoped, so never paginated. */
export function fetchCompanyLocations(companyId: string): Promise<Location[]> {
  return http.get<Location[]>("/locations", inCompany(companyId));
}

/**
 * The locations of the **active** company — the header the http client already
 * attaches. For pickers, which want "the sites I can use here" and have no reason
 * to name a company explicitly. The API scopes the list to the caller's own group
 * locations, so what comes back is exactly what they may pick.
 */
export function fetchLocations(): Promise<Location[]> {
  return http.get<Location[]>("/locations");
}

export function createLocation(companyId: string, name: string): Promise<Location> {
  return http.post<Location>("/locations", { name }, inCompany(companyId));
}

export function updateLocation(companyId: string, id: string, name: string): Promise<Location> {
  return http.patch<Location>(`/locations/${id}`, { name }, inCompany(companyId));
}

/** A group whose scope names a location or holds a role. */
export interface Reference {
  id: string;
  name: string;
}

/** Deactivating keeps every group scope intact; deleting would drop them. */
export function setLocationStatus(
  companyId: string,
  id: string,
  status: "active" | "inactive",
): Promise<Location> {
  const action = status === "active" ? "reactivate" : "deactivate";
  return http.post<Location>(`/locations/${id}/${action}`, undefined, inCompany(companyId));
}

/** The groups a delete would silently remove this location from. */
export function fetchLocationReferences(companyId: string, id: string): Promise<Reference[]> {
  return http
    .get<{ groups: Reference[] }>(`/locations/${id}/references`, inCompany(companyId))
    .then((body) => body.groups);
}

/**
 * Refused with 409 while any group is scoped to this location, unless `cascade`
 * is asked for — which detaches those groups first. Never implicit.
 */
export function deleteLocation(companyId: string, id: string, cascade = false): Promise<void> {
  return http.delete<void>(`/locations/${id}`, {
    ...inCompany(companyId),
    query: cascade ? { cascade: "true" } : undefined,
  });
}

/* ------------------------------ Import / export ---------------------------- */

export interface ImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/** Download the company's sites as an .xlsx. */
export function exportLocations(companyId: string): Promise<void> {
  return download("/locations/export", "locations.xlsx", inCompany(companyId));
}

/** Download the blank location import template. */
export function downloadLocationTemplate(): Promise<void> {
  return download("/locations/import/template", "location-import-template.xlsx");
}

/** Upload a spreadsheet of sites — all-or-nothing on the server. */
export function importLocations(companyId: string, file: File): Promise<ImportOutcome> {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<ImportOutcome>("/locations/import", form, inCompany(companyId));
}
