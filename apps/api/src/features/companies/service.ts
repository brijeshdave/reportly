// Author: Brijesh Dave <https://github.com/brijeshdave>
// Company business logic. Serializes rows to the shared Company contract and
// enforces existence; the repository owns all DB access.
import {
  ERROR_CODES,
  type Company,
  type EntityStatus,
  type PaginatedResult,
  type ResolvedListQuery,
  toPaginatedResult,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { notify } from "@/core/queue/notifications.js";
import { forgetCompanyStatus } from "@/features/companies/active.js";
import {
  type CompanyRow,
  createCompanyWithRemote,
  deleteCompanyById,
  getCompanyById,
  groupsScopedTo,
  listCompanies as listCompanyRows,
  locationsOf,
  updateCompanyName,
  updateCompanyStatus,
  type CompanyReference,
} from "@/features/companies/repo.js";

function serialize(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCompanies(
  query: ResolvedListQuery,
  userId: string,
  isSuperadmin: boolean,
): Promise<PaginatedResult<Company>> {
  // A superadmin has no access scope; everyone else sees only their groups' companies.
  const { rows, total } = await listCompanyRows(query, isSuperadmin ? null : userId);
  return toPaginatedResult(rows.map(serialize), total, query);
}

export async function getCompany(id: string): Promise<Company> {
  const row = await getCompanyById(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Company not found");
  return serialize(row);
}

export async function createCompany(name: string): Promise<Company> {
  return serialize(await createCompanyWithRemote(name));
}

export async function updateCompany(id: string, name: string): Promise<Company> {
  const row = await updateCompanyName(id, name);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Company not found");
  return serialize(row);
}

async function requireCompany(id: string): Promise<CompanyRow> {
  const row = await getCompanyById(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Company not found");
  return row;
}

/**
 * Retires a company without destroying its locations or any group's scope.
 *
 * A retired company also stops accepting writes — see `active.ts`. That check is
 * cached, so the cached answer is dropped here: a status change nobody can see for
 * half a minute reads as a button that did nothing.
 */
export async function setStatus(
  id: string,
  status: EntityStatus,
  actorUserId: string | null = null,
): Promise<Company> {
  await requireCompany(id);
  const row = await updateCompanyStatus(id, status);
  await forgetCompanyStatus(id);
  const company = serialize(row!);

  // Only the closing. Reactivating restores the normal state of affairs, and a
  // bell that reports both halves of a toggle is a bell people stop reading.
  if (status === "inactive") {
    await notify({
      type: "company.deactivated",
      companyId: null,
      actorUserId,
      title: `${company.name} was deactivated`,
      body: "Nothing new can be filed into it and nothing in it can be changed until it is reactivated. Everything already there stays readable.",
      link: `/companies/${company.id}`,
      entityKind: "company",
      entityId: company.id,
    });
  }

  return company;
}

export interface CompanyReferences {
  /** Deleted with the company. Every company has at least its Remote location. */
  locations: CompanyReference[];
  /** Detached from the company; the groups themselves survive. */
  groups: CompanyReference[];
}

export async function companyReferences(id: string): Promise<CompanyReferences> {
  await requireCompany(id);
  const [locations, groups] = await Promise.all([locationsOf(id), groupsScopedTo(id)]);
  return { locations, groups };
}

/**
 * A company delete cascades into its locations, and through them into every group
 * scoped to one — silently narrowing what those members can see. It is refused
 * while anything but the auto-created Remote location depends on it, and the
 * refusal says what. `cascade` accepts the loss explicitly.
 *
 * Remote alone never blocks: every company has one, so requiring its removal
 * would make deletion impossible.
 */
export async function deleteCompany(
  id: string,
  cascade = false,
): Promise<{ destroyed: CompanyReferences }> {
  await requireCompany(id);
  const references = await companyReferences(id);

  const blockingLocations = references.locations.filter((l) => l.name !== "Remote");
  const blocked = blockingLocations.length > 0 || references.groups.length > 0;

  if (blocked && !cascade) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This company still has locations or groups scoped to it. Deactivate it, or remove them first.",
      { locations: blockingLocations, groups: references.groups },
    );
  }

  // The FKs do the cascading; we only decide whether it may happen.
  await deleteCompanyById(id);
  return { destroyed: references };
}
