// Author: Brijesh Dave <https://github.com/brijeshdave>
// Designation business logic: unique names (surfaced as 409), and the rule that a
// title somebody holds is retired rather than deleted.
import {
  ERROR_CODES,
  type DesignationRow,
  type PaginatedResult,
  type ResolvedListQuery,
  toPaginatedResult,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { isUniqueViolation } from "@/lib/db-errors.js";
import {
  activeDesignations,
  deleteDesignationRow,
  getDesignation as getRow,
  insertDesignation,
  listDesignations as listRows,
  updateDesignationRow,
  type DesignationRowRaw,
} from "@/features/designations/repo.js";

function serialize(row: DesignationRowRaw): DesignationRow {
  return {
    id: row.id,
    name: row.name,
    status: row.status === "inactive" ? "inactive" : "active",
    userCount: row.userCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const DUPLICATE = () =>
  new AppError(409, ERROR_CODES.CONFLICT, "A designation with that name already exists");

async function requireDesignation(id: string): Promise<DesignationRowRaw> {
  const row = await getRow(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Designation not found");
  return row;
}

export async function listDesignations(
  query: ResolvedListQuery,
): Promise<PaginatedResult<DesignationRow>> {
  const { rows, total } = await listRows(query);
  return toPaginatedResult(rows.map(serialize), total, query);
}

/** The choices offered on a user's profile: active ones only. */
export async function options(): Promise<{ id: string; name: string }[]> {
  return activeDesignations();
}

export async function getDesignation(id: string): Promise<DesignationRow> {
  return serialize(await requireDesignation(id));
}

export async function createDesignation(
  name: string,
  status: "active" | "inactive",
): Promise<DesignationRow> {
  try {
    return serialize(await insertDesignation(name, status));
  } catch (err) {
    if (isUniqueViolation(err)) throw DUPLICATE();
    throw err;
  }
}

/**
 * Renaming corrects everybody holding the title at once — which is the whole reason
 * users point at a row here rather than each carrying their own copy of the words.
 */
export async function updateDesignation(
  id: string,
  fields: { name?: string; status?: "active" | "inactive" },
): Promise<DesignationRow> {
  await requireDesignation(id);
  try {
    await updateDesignationRow(id, fields);
  } catch (err) {
    if (isUniqueViolation(err)) throw DUPLICATE();
    throw err;
  }
  return serialize(await requireDesignation(id));
}

/**
 * Deleting is refused while anybody holds the title.
 *
 * The column is `on delete set null`, so a delete would go through and quietly strip
 * the job title from every one of those people. Retiring it — status `inactive` —
 * does what is actually wanted: it stops being offered to anyone new, and the people
 * who already hold it keep it.
 */
export async function deleteDesignation(id: string): Promise<void> {
  const row = await requireDesignation(id);
  if (row.userCount > 0) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      `${row.userCount} ${row.userCount === 1 ? "person holds" : "people hold"} this designation. Deactivate it instead — they keep it, and nobody new is offered it.`,
      { userCount: row.userCount },
    );
  }
  await deleteDesignationRow(id);
}
