// Author: Brijesh Dave <https://github.com/brijeshdave>
// JournalEntry-config business logic: serialization and unique-name rules for the three
// catalogues. Deliberately light — these are lookup tables. Guarded delete is not
// needed yet (no report references them until Step 2); when reports arrive, delete
// gains the same "in use → retire instead" guard designations have.
import {
  type CategoryRow,
  type CreateCategory,
  type CreateReportStatus,
  type CreateSeverity,
  ERROR_CODES,
  type JournalStatus,
  type Severity,
  type StatusGroup,
  type UpdateCategory,
  type UpdateReportStatus,
  type UpdateSeverity,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { isConfigInUse } from "@/features/journal/repo.js";
import { isUniqueViolation } from "@/lib/db-errors.js";
import {
  type CategoryRowRaw,
  type SeverityRow,
  type StatusRow,
  categoryNameTaken,
  deleteCategoryRow,
  deleteSeverityRow,
  deleteStatusRow,
  departmentExists,
  getCategory as getCategoryRow,
  getSeverity as getSeverityRow,
  getStatus as getStatusRow,
  insertCategory,
  insertSeverity,
  insertStatus,
  listCategories as listCategoryRows,
  listSeverities as listSeverityRows,
  listStatuses as listStatusRows,
  updateCategoryRow,
  updateSeverityRow,
  updateStatusRow,
  companyDepartments,
  listCategoriesForCompany,
  listTagsForCompany,
  upsertVocabulary,
  type ResolvedVocabRow,
} from "@/features/journal-config/repo.js";
import type { VocabExportRow, VocabParseResult } from "@/features/journal-config/import-parse.js";

/* ------------------------------- Severities -------------------------------- */

function serializeSeverity(row: SeverityRow): Severity {
  return {
    id: row.id,
    name: row.name,
    orderIndex: row.orderIndex,
    // Postgres hands `numeric` back as a string; the cast alone would be an
    // assertion, which is the trap this codebase has fallen into twice.
    maxPoints: Number(row.maxPoints),
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const DUP_SEVERITY = () =>
  new AppError(409, ERROR_CODES.CONFLICT, "A severity with that name already exists");

export async function listSeverities(): Promise<Severity[]> {
  return (await listSeverityRows()).map(serializeSeverity);
}

async function requireSeverity(id: string): Promise<SeverityRow> {
  const row = await getSeverityRow(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Severity not found");
  return row;
}

export async function getSeverity(id: string): Promise<Severity> {
  return serializeSeverity(await requireSeverity(id));
}

export async function createSeverity(input: Required<CreateSeverity>): Promise<Severity> {
  try {
    return serializeSeverity(
      await insertSeverity({
        name: input.name,
        orderIndex: input.orderIndex,
        status: input.status,
        // `numeric` goes in as a string; handing it a number is the same trap the
        // read side already documents.
        maxPoints: String(input.maxPoints),
      }),
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw DUP_SEVERITY();
    throw err;
  }
}

export async function updateSeverity(id: string, input: UpdateSeverity): Promise<Severity> {
  await requireSeverity(id);
  try {
    const { maxPoints, ...rest } = input;
    const row = await updateSeverityRow(id, {
      ...rest,
      // `numeric` goes in as a string; handing it a number is the same trap the
      // read side already documents.
      ...(maxPoints === undefined ? {} : { maxPoints: String(maxPoints) }),
    });
    return serializeSeverity(row!);
  } catch (err) {
    if (isUniqueViolation(err)) throw DUP_SEVERITY();
    throw err;
  }
}

export async function deleteSeverity(id: string): Promise<void> {
  await requireSeverity(id);
  await assertNotInUse("severityId", id, "severity");
  await deleteSeverityRow(id);
}

/* -------------------------------- Statuses --------------------------------- */

function serializeStatus(row: StatusRow): JournalStatus {
  return {
    id: row.id,
    name: row.name,
    group: (["open", "resolved", "rejected"].includes(row.group)
      ? row.group
      : "open") as StatusGroup,
    isTerminal: row.isTerminal,
    orderIndex: row.orderIndex,
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const DUP_STATUS = () =>
  new AppError(409, ERROR_CODES.CONFLICT, "A status with that name already exists");

export async function listStatuses(): Promise<JournalStatus[]> {
  return (await listStatusRows()).map(serializeStatus);
}

async function requireStatus(id: string): Promise<StatusRow> {
  const row = await getStatusRow(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Status not found");
  return row;
}

export async function getStatus(id: string): Promise<JournalStatus> {
  return serializeStatus(await requireStatus(id));
}

export async function createStatus(input: Required<CreateReportStatus>): Promise<JournalStatus> {
  try {
    return serializeStatus(
      await insertStatus({
        name: input.name,
        group: input.group,
        isTerminal: input.isTerminal,
        orderIndex: input.orderIndex,
        status: input.status,
      }),
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw DUP_STATUS();
    throw err;
  }
}

export async function updateStatus(id: string, input: UpdateReportStatus): Promise<JournalStatus> {
  await requireStatus(id);
  try {
    const row = await updateStatusRow(id, input);
    return serializeStatus(row!);
  } catch (err) {
    if (isUniqueViolation(err)) throw DUP_STATUS();
    throw err;
  }
}

export async function deleteStatus(id: string): Promise<void> {
  await requireStatus(id);
  await assertNotInUse("statusId", id, "status");
  await deleteStatusRow(id);
}

/* ------------------------------- Categories -------------------------------- */

function serializeCategory(row: CategoryRowRaw): CategoryRow {
  return {
    id: row.id,
    departmentId: row.departmentId,
    name: row.name,
    description: row.description,
    status: row.status === "inactive" ? "inactive" : "active",
    departmentName: row.departmentName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const DUP_CATEGORY = () =>
  new AppError(
    409,
    ERROR_CODES.CONFLICT,
    "A category with that name already exists in this department",
  );

export async function listCategories(departmentId?: string): Promise<CategoryRow[]> {
  return (await listCategoryRows(departmentId)).map(serializeCategory);
}

async function requireCategory(id: string): Promise<CategoryRowRaw> {
  const row = await getCategoryRow(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Category not found");
  return row;
}

export async function getCategory(id: string): Promise<CategoryRow> {
  return serializeCategory(await requireCategory(id));
}

export async function createCategory(
  input: CreateCategory,
  companyId: string,
): Promise<CategoryRow> {
  if (!(await departmentExists(input.departmentId, companyId))) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That department does not exist");
  }
  if (await categoryNameTaken(input.departmentId, input.name)) throw DUP_CATEGORY();
  const id = await insertCategory(
    input.departmentId,
    input.name,
    input.description ?? null,
    input.status,
  );
  return getCategory(id);
}

export async function updateCategory(id: string, input: UpdateCategory): Promise<CategoryRow> {
  const existing = await requireCategory(id);
  if (input.name && input.name !== existing.name) {
    if (await categoryNameTaken(existing.departmentId, input.name, id)) throw DUP_CATEGORY();
  }
  await updateCategoryRow(id, input);
  return getCategory(id);
}

export async function deleteCategory(id: string): Promise<void> {
  await requireCategory(id);
  await assertNotInUse("categoryId", id, "category");
  await deleteCategoryRow(id);
}

/**
 * A config row referenced by a report is retired, never deleted — deleting it would
 * null the report's severity/status/category (the FK is set-null), quietly changing
 * a record someone already filed.
 */
async function assertNotInUse(
  column: "categoryId" | "severityId" | "statusId",
  id: string,
  label: string,
): Promise<void> {
  if (await isConfigInUse(column, id)) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      `A report uses this ${label}. Retire it instead — it stays on the reports that have it, and stops being offered.`,
    );
  }
}

/* ------------------------------ Import / export ---------------------------- */

/** Export the whole journal vocabulary of a company — one row per term, by kind. */
export async function exportVocabulary(companyId: string): Promise<VocabExportRow[]> {
  const [severityRows, statusRows, categoryRows, tagRows] = await Promise.all([
    listSeverityRows(),
    listStatusRows(),
    listCategoriesForCompany(companyId),
    listTagsForCompany(companyId),
  ]);
  const out: VocabExportRow[] = [];
  const norm = (s: string): "active" | "inactive" => (s === "inactive" ? "inactive" : "active");
  // Severities and statuses are company-wide; categories and tags belong to a department.
  for (const s of severityRows) {
    out.push({
      kind: "severity",
      department: null,
      name: s.name,
      group: null,
      terminal: null,
      color: null,
      description: null,
      status: norm(s.status),
    });
  }
  for (const s of statusRows) {
    out.push({
      kind: "status",
      department: null,
      name: s.name,
      group: s.group,
      terminal: s.isTerminal,
      color: null,
      description: null,
      status: norm(s.status),
    });
  }
  for (const c of categoryRows) {
    out.push({
      kind: "category",
      department: c.departmentName,
      name: c.name,
      group: null,
      terminal: null,
      color: null,
      description: c.description,
      status: norm(c.status),
    });
  }
  for (const t of tagRows) {
    out.push({
      kind: "tag",
      department: t.departmentName,
      name: t.name,
      group: null,
      terminal: null,
      color: t.color,
      description: t.description,
      status: norm(t.status),
    });
  }
  return out;
}

export interface VocabImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/**
 * Apply an uploaded vocabulary file. Category/tag department names are resolved to ids
 * within the company; all-or-nothing, so any bad row (an unknown department, or a term
 * that repeats within the file) leaves the vocabulary untouched with every problem's line.
 */
export async function importVocabulary(
  companyId: string,
  parsed: VocabParseResult,
): Promise<VocabImportOutcome> {
  const problems = [...parsed.problems];
  if (parsed.rows.length === 0) return { created: 0, updated: 0, problems };

  const depts = await companyDepartments(companyId);
  const deptIds = new Map(depts.map((d) => [d.name.trim().toLowerCase(), d.id]));

  const resolved: ResolvedVocabRow[] = [];
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    let departmentId: string | null = null;
    if (row.kind === "category" || row.kind === "tag") {
      departmentId = deptIds.get((row.department ?? "").toLowerCase()) ?? null;
      if (!departmentId) {
        problems.push({ line: row.line, message: `No department called "${row.department}"` });
        continue;
      }
    }
    const key = `${row.kind}:${departmentId ?? ""}:${row.name.trim().toLowerCase()}`;
    if (seen.has(key)) {
      problems.push({
        line: row.line,
        message: `"${row.name}" appears more than once for this kind/department`,
      });
    }
    seen.add(key);
    resolved.push({
      kind: row.kind,
      departmentId,
      name: row.name,
      group: row.group,
      terminal: row.terminal,
      color: row.color,
      description: row.description,
      status: row.status ?? "active",
    });
  }

  if (problems.length > 0) return { created: 0, updated: 0, problems };

  const { created, updated } = await upsertVocabulary(companyId, resolved);
  return { created, updated, problems: [] };
}
