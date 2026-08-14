// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reading an uploaded spreadsheet of roles, and writing them back out. A role is a named
// bundle of permission keys (the stable `resource:action` strings), so that is what
// round-trips here: a role's name and the permissions it grants. Groups that hold the role,
// and the users in those groups, are separate facts and belong to their own imports. This
// file decides only what the file says; the service validates the keys and writes the rows.
import {
  type RowProblem,
  buildWorkbook,
  gridFromCsv,
  gridFromXlsx,
  headerMapping,
  rowReader,
} from "@/core/spreadsheet/index.js";

/** Permission keys are listed in one cell, separated by a pipe (or a semicolon/space). */
export const ROLE_PERMISSION_SEPARATOR = " | ";

const COLUMNS = ["name", "permissions", "system"] as const;
type Column = (typeof COLUMNS)[number];

const HEADERS: Record<Column, string> = {
  name: "Name",
  permissions: "Permissions",
  system: "System",
};

export interface ParsedRoleRow {
  line: number;
  name: string;
  /** The permission keys the file lists, or null when the cell is blank — meaning "leave
   *  the role's permissions unchanged" rather than "remove them all", the safe default for
   *  a bulk tool. Clearing every permission is done in the UI. */
  permissions: string[] | null;
}

export interface RoleParseResult {
  rows: ParsedRoleRow[];
  problems: RowProblem[];
}

function splitKeys(cell: string): string[] {
  // Keys never contain spaces, so any of pipe / semicolon / comma / whitespace separates.
  return cell
    .split(/[|;,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function fromGrid(grid: (string | null)[][]): RoleParseResult {
  const problems: RowProblem[] = [];
  const rows: ParsedRoleRow[] = [];

  const header = grid[0];
  if (!header) return { rows, problems: [{ line: 0, message: "The file is empty" }] };

  const mapping = headerMapping(header, COLUMNS, HEADERS);
  if (!mapping.includes("name")) {
    return {
      rows,
      problems: [
        {
          line: 1,
          message: `No "Name" column found. Download the template and keep its header row.`,
        },
      ],
    };
  }

  for (let r = 1; r < grid.length; r += 1) {
    const cells = grid[r] ?? [];
    const line = r + 1;
    if (cells.every((c) => c === null || c === "")) continue;

    const value = rowReader(cells, mapping);
    const name = value("name");
    if (!name) {
      problems.push({ line, message: "Name is required" });
      continue;
    }

    const permsCell = value("permissions");
    const parsed = permsCell ? splitKeys(permsCell) : [];
    rows.push({ line, name, permissions: parsed.length > 0 ? parsed : null });
  }

  return { rows, problems };
}

export function parseCsv(text: string): RoleParseResult {
  return fromGrid(gridFromCsv(text));
}

export async function parseXlsx(buffer: Buffer): Promise<RoleParseResult> {
  return fromGrid(await gridFromXlsx(buffer, COLUMNS.length));
}

export interface RoleExportRow {
  name: string;
  permissions: string[];
  isSystem: boolean;
}

const HEADER_LABELS = COLUMNS.map((c) => HEADERS[c]);

/** The downloadable template: the header row plus one illustrative role. */
export async function buildTemplate(): Promise<Buffer> {
  return buildWorkbook("Roles", HEADER_LABELS, [
    ["Line supervisor", "journal:read | journal:create | assets:read", "no"],
  ]);
}

/** Export the roles — one row per role, permission keys joined, the system flag for reference. */
export async function buildExport(rows: RoleExportRow[]): Promise<Buffer> {
  return buildWorkbook(
    "Roles",
    HEADER_LABELS,
    rows.map((r) => [
      r.name,
      r.permissions.join(ROLE_PERMISSION_SEPARATOR),
      r.isSystem ? "yes" : "no",
    ]),
  );
}
