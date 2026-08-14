// Author: Brijesh Dave <https://github.com/brijeshdave>
// Company service calls. Creating a company auto-creates its Remote location.
import type { Company } from "@reportly/shared";

import { http } from "@/services/http.js";
import type { Reference } from "@/services/locations.js";

export function fetchCompany(id: string): Promise<Company> {
  return http.get<Company>(`/companies/${id}`);
}

export function createCompany(name: string): Promise<Company> {
  return http.post<Company>("/companies", { name });
}

export function updateCompany(id: string, name: string): Promise<Company> {
  return http.patch<Company>(`/companies/${id}`, { name });
}

/** Retires a company without destroying its locations or any group's scope. */
export function setCompanyStatus(id: string, status: "active" | "inactive"): Promise<Company> {
  return http.post<Company>(
    `/companies/${id}/${status === "active" ? "reactivate" : "deactivate"}`,
  );
}

export interface CompanyReferences {
  /** Deleted with the company. Always includes the auto-created Remote location. */
  locations: Reference[];
  /** Detached from it; the groups themselves survive. */
  groups: Reference[];
}

export function fetchCompanyReferences(id: string): Promise<CompanyReferences> {
  return http.get<CompanyReferences>(`/companies/${id}/references`);
}

/**
 * Refused with 409 while the company has locations beyond Remote, or groups
 * scoped to it, unless `cascade` is asked for.
 */
export function deleteCompany(id: string, cascade = false): Promise<void> {
  return http.delete<void>(`/companies/${id}`, {
    query: cascade ? { cascade: "true" } : undefined,
  });
}
