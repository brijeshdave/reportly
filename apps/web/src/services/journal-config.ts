// Author: Brijesh Dave <https://github.com/brijeshdave>
// The report-config catalogues: severities, statuses, categories. Small lookup
// tables fetched whole (never paginated) — the report form and the config screen
// both read them here.
import type {
  Category,
  CategoryRow,
  CreateCategory,
  CreateReportStatus,
  CreateSeverity,
  JournalStatus,
  Severity,
  UpdateCategory,
  UpdateReportStatus,
  UpdateSeverity,
} from "@reportly/shared";

import { download, http } from "@/services/http.js";

/* ------------------------------ Import / export ---------------------------- */

export interface ImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/** Download the whole journal vocabulary as an .xlsx (severities, statuses, categories, tags). */
export function exportVocabulary(): Promise<void> {
  return download("/journal-config/export", "journal-vocabulary.xlsx");
}

/** Download the blank journal-vocabulary import template. */
export function downloadVocabularyTemplate(): Promise<void> {
  return download("/journal-config/import/template", "journal-vocabulary-import-template.xlsx");
}

/** Upload a spreadsheet of vocabulary — all-or-nothing on the server. */
export function importVocabulary(file: File): Promise<ImportOutcome> {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<ImportOutcome>("/journal-config/import", form);
}

/* Severities */
export const fetchSeverities = () => http.get<Severity[]>("/severities");
export const createSeverity = (input: CreateSeverity) => http.post<Severity>("/severities", input);
export const updateSeverity = (id: string, input: UpdateSeverity) =>
  http.patch<Severity>(`/severities/${id}`, input);
export const deleteSeverity = (id: string) => http.delete<void>(`/severities/${id}`);

/* Statuses */
export const fetchStatuses = () => http.get<JournalStatus[]>("/journal-statuses");
export const createStatus = (input: CreateReportStatus) =>
  http.post<JournalStatus>("/journal-statuses", input);
export const updateStatus = (id: string, input: UpdateReportStatus) =>
  http.patch<JournalStatus>(`/journal-statuses/${id}`, input);
export const deleteStatus = (id: string) => http.delete<void>(`/journal-statuses/${id}`);

/* Categories */
export const fetchCategories = (departmentId?: string) =>
  http.get<CategoryRow[]>("/categories", departmentId ? { query: { departmentId } } : undefined);
export const createCategory = (input: CreateCategory) => http.post<Category>("/categories", input);
export const updateCategory = (id: string, input: UpdateCategory) =>
  http.patch<Category>(`/categories/${id}`, input);
export const deleteCategory = (id: string) => http.delete<void>(`/categories/${id}`);
