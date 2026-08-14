// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reading an uploaded spreadsheet of departments, and writing the tree back out.
//
// Departments nest into a tree, so each row carries the full **path** from the root (e.g.
// `Operations › Maintenance › Electrical`); the importer creates or finds each ancestor by
// name. Membership — who is in a department, their rank, who they report to, and which
// sites they cover — is a separate, per-person fact and belongs to the user import, not
// here. This file decides only what the file says; the service does the database work.
import {
  type RowProblem,
  buildWorkbook,
  gridFromCsv,
  gridFromXlsx,
  headerMapping,
  rowReader,
} from "@/core/spreadsheet/index.js";

/** The separator between path segments — the same the web tree shows. */
export const DEPARTMENT_PATH_SEPARATOR = " › ";

const COLUMNS = ["path", "status"] as const;
type Column = (typeof COLUMNS)[number];

const HEADERS: Record<Column, string> = {
  path: "Path",
  status: "Status",
};

export interface ParsedDepartmentRow {
  line: number;
  path: string;
  segments: string[];
  status: string | null;
}

export interface DepartmentParseResult {
  rows: ParsedDepartmentRow[];
  problems: RowProblem[];
}

/** Split a path on the separator, tolerating `>` written without the fancy chevron. */
function segmentsOf(path: string): string[] {
  return path
    .split(/›|>/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function fromGrid(grid: (string | null)[][]): DepartmentParseResult {
  const problems: RowProblem[] = [];
  const rows: ParsedDepartmentRow[] = [];

  const header = grid[0];
  if (!header) return { rows, problems: [{ line: 0, message: "The file is empty" }] };

  const mapping = headerMapping(header, COLUMNS, HEADERS);
  if (!mapping.includes("path")) {
    return {
      rows,
      problems: [
        {
          line: 1,
          message: `No "Path" column found. Download the template and keep its header row.`,
        },
      ],
    };
  }

  for (let r = 1; r < grid.length; r += 1) {
    const cells = grid[r] ?? [];
    const line = r + 1;
    if (cells.every((c) => c === null || c === "")) continue;

    const value = rowReader(cells, mapping);
    const path = value("path");
    if (!path) {
      problems.push({ line, message: "Path is required" });
      continue;
    }
    const segments = segmentsOf(path);
    if (segments.length === 0) {
      problems.push({ line, message: `"${path}" is not a valid path` });
      continue;
    }

    const status = value("status");
    if (status && !["active", "inactive"].includes(status.toLowerCase())) {
      problems.push({ line, message: `Status must be "active" or "inactive", not "${status}"` });
      continue;
    }

    rows.push({ line, path, segments, status: status ? status.toLowerCase() : null });
  }

  return { rows, problems };
}

export function parseCsv(text: string): DepartmentParseResult {
  return fromGrid(gridFromCsv(text));
}

export async function parseXlsx(buffer: Buffer): Promise<DepartmentParseResult> {
  return fromGrid(await gridFromXlsx(buffer, COLUMNS.length));
}

export interface DepartmentExportRow {
  path: string;
  status: string;
}

const HEADER_LABELS = COLUMNS.map((c) => HEADERS[c]);

/** The downloadable template: the header row plus a small illustrative tree. */
export async function buildTemplate(): Promise<Buffer> {
  return buildWorkbook("Departments", HEADER_LABELS, [
    ["Operations", "active"],
    ["Operations › Maintenance", "active"],
    ["Operations › Maintenance › Electrical", "active"],
  ]);
}

/** Export the tree — one row per department, parent before child. */
export async function buildExport(rows: DepartmentExportRow[]): Promise<Buffer> {
  return buildWorkbook(
    "Departments",
    HEADER_LABELS,
    rows.map((r) => [r.path, r.status]),
  );
}
