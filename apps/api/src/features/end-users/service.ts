// Author: Brijesh Dave <https://github.com/brijeshdave>
// End-user business rules: uniqueness of the employee number, what the journal's
// picker is allowed to offer, and what an import may quietly change.
//
// Deleting is deliberately awkward. A person who has left should be made inactive,
// not removed: every entry that names them is what the reports are made of, and a
// delete would turn that history into an unlabelled id.
import {
  ERROR_CODES,
  type CreateEndUser,
  type EndUser,
  type PaginatedResult,
  type ResolvedListQuery,
  type UpdateEndUser,
  toPaginatedResult,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { isUniqueViolation } from "@/lib/db-errors.js";
import * as parse from "@/features/end-users/import-parse.js";
import * as repo from "@/features/end-users/repo.js";
import type { EndUserRow } from "@/features/end-users/repo.js";

function serialize(row: EndUserRow): EndUser {
  return {
    id: row.id,
    companyId: row.companyId,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    fullName: row.fullName,
    employeeNumber: row.employeeNumber,
    description: row.description,
    status: row.status === "inactive" ? "inactive" : "active",
    linkedUserId: row.linkedUserId,
    linkedUserName: row.linkedUserName,
    entryCount: row.entryCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The employee number is the identity; a clash is a 400 with the number in it. */
function duplicate(employeeNumber: string): AppError {
  return new AppError(
    400,
    ERROR_CODES.VALIDATION_ERROR,
    `Employee number "${employeeNumber}" is already used by somebody else in this company.`,
  );
}

export async function listEndUsers(
  query: ResolvedListQuery,
  companyId: string,
): Promise<PaginatedResult<EndUser>> {
  const { rows, total } = await repo.listEndUsers(query, companyId);
  return toPaginatedResult(rows.map(serialize), total, query);
}

/**
 * What the journal offers, narrowed to the departments chosen on the entry.
 *
 * Active only: somebody who has left must stay on their old entries and off the new
 * ones, which is the whole difference between inactive and deleted.
 */
export async function pickableEndUsers(companyId: string, departmentIds: string[]) {
  return repo.pickableEndUsers(companyId, departmentIds);
}

export async function getEndUser(id: string, companyId: string): Promise<EndUser> {
  const row = await repo.getEndUser(id, companyId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "End user not found");
  return serialize(row);
}

export async function createEndUser(companyId: string, input: CreateEndUser): Promise<EndUser> {
  try {
    const id = await repo.insertEndUser({
      companyId,
      departmentId: input.departmentId ?? null,
      fullName: input.fullName,
      employeeNumber: input.employeeNumber,
      description: input.description ?? null,
      status: input.status,
      linkedUserId: input.linkedUserId ?? null,
    });
    return getEndUser(id, companyId);
  } catch (error) {
    // The database holds the uniqueness, so the check and the constraint cannot
    // disagree under a race — the error is translated rather than pre-empted.
    if (isUniqueViolation(error)) throw duplicate(input.employeeNumber);
    throw error;
  }
}

export async function updateEndUser(
  id: string,
  companyId: string,
  input: UpdateEndUser,
): Promise<EndUser> {
  const fields: repo.EndUserPatch = {};
  if (input.fullName !== undefined) fields.fullName = input.fullName;
  if (input.employeeNumber !== undefined) fields.employeeNumber = input.employeeNumber;
  if (input.departmentId !== undefined) fields.departmentId = input.departmentId;
  if (input.description !== undefined) fields.description = input.description;
  if (input.status !== undefined) fields.status = input.status;
  if (input.linkedUserId !== undefined) fields.linkedUserId = input.linkedUserId;

  try {
    const ok = await repo.updateEndUserRow(id, companyId, fields);
    if (!ok) throw new AppError(404, ERROR_CODES.NOT_FOUND, "End user not found");
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate(input.employeeNumber ?? "");
    throw error;
  }
  return getEndUser(id, companyId);
}

/**
 * Remove somebody entirely.
 *
 * Refused once they are named on an entry: the reports are built from those names,
 * and a deletion would leave the entry pointing at nothing. Deactivate instead —
 * which is what the status is for.
 */
export async function deleteEndUser(id: string, companyId: string): Promise<void> {
  const row = await repo.getEndUser(id, companyId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "End user not found");
  if (row.entryCount > 0) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `${row.fullName} is named on ${row.entryCount} ${row.entryCount === 1 ? "entry" : "entries"}. Set them to inactive instead — deleting would leave those entries pointing at nobody.`,
    );
  }
  await repo.deleteEndUserRow(id, companyId);
}

export interface EndUserImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/**
 * Apply an uploaded sheet.
 *
 * Nothing is written unless every row is good. A half-applied import leaves somebody
 * guessing which half, and the file is cheap to correct and re-upload.
 *
 * An unknown department name is a problem rather than a new department: a typo that
 * silently invents "Acounts" is how a master list rots.
 */
export async function importEndUsers(
  companyId: string,
  parsed: parse.EndUserParseResult,
): Promise<EndUserImportOutcome> {
  const problems = [...parsed.problems];
  if (parsed.rows.length === 0) return { created: 0, updated: 0, problems };

  const departments = await repo.departmentsByName(companyId);
  const resolved: Parameters<typeof repo.upsertEndUsers>[1] = [];

  for (const row of parsed.rows) {
    let departmentId: string | null = null;
    if (row.department) {
      const found = departments.get(row.department.trim().toLowerCase());
      if (!found) {
        problems.push({
          line: row.line,
          message: `No department called "${row.department}" in this company`,
        });
        continue;
      }
      departmentId = found;
    }
    resolved.push({
      employeeNumber: row.employeeNumber,
      fullName: row.fullName,
      departmentId,
      description: row.description,
      status: row.status ?? "active",
    });
  }

  if (problems.length > 0) return { created: 0, updated: 0, problems };

  const { created, updated } = await repo.upsertEndUsers(companyId, resolved);
  return { created, updated, problems: [] };
}

export async function exportEndUsers(companyId: string): Promise<Buffer> {
  const rows = await repo.allEndUsers(companyId);
  return parse.buildExport(
    rows.map((r) => ({
      employeeNumber: r.employeeNumber,
      fullName: r.fullName,
      department: r.departmentName,
      description: r.description,
      status: r.status,
    })),
  );
}
