// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reading an uploaded spreadsheet of groups, and writing them back out. A group is the
// holder of roles and the join point access is granted through, so what round-trips here
// is a group's name and the set of roles it carries. Its members are a per-person fact and
// belong to the user import, not here. This file decides only what the file says; the
// service resolves role names and writes the rows.
import {
  type RowProblem,
  buildWorkbook,
  gridFromCsv,
  gridFromXlsx,
  headerMapping,
  rowReader,
} from "@/core/spreadsheet/index.js";

/** Roles are listed in one cell, separated by a pipe (or a semicolon). */
export const GROUP_ROLE_SEPARATOR = " | ";

const COLUMNS = ["name", "roles", "system"] as const;
type Column = (typeof COLUMNS)[number];

const HEADERS: Record<Column, string> = {
  name: "Name",
  roles: "Roles",
  system: "System",
};

export interface ParsedGroupRow {
  line: number;
  name: string;
  /** The role names the file lists, or null when the cell is blank — meaning "leave the
   *  group's roles unchanged" rather than "remove them all", the safe default for a bulk
   *  tool. Clearing every role is done in the UI. */
  roles: string[] | null;
}

export interface GroupParseResult {
  rows: ParsedGroupRow[];
  problems: RowProblem[];
}

function splitRoles(cell: string): string[] {
  return cell
    .split(/[|;]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function fromGrid(grid: (string | null)[][]): GroupParseResult {
  const problems: RowProblem[] = [];
  const rows: ParsedGroupRow[] = [];

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

    const rolesCell = value("roles");
    const parsedRoles = rolesCell ? splitRoles(rolesCell) : [];
    rows.push({ line, name, roles: parsedRoles.length > 0 ? parsedRoles : null });
  }

  return { rows, problems };
}

export function parseCsv(text: string): GroupParseResult {
  return fromGrid(gridFromCsv(text));
}

export async function parseXlsx(buffer: Buffer): Promise<GroupParseResult> {
  return fromGrid(await gridFromXlsx(buffer, COLUMNS.length));
}

export interface GroupExportRow {
  name: string;
  roles: string[];
  isSystem: boolean;
}

const HEADER_LABELS = COLUMNS.map((c) => HEADERS[c]);

/** The downloadable template: the header row plus one illustrative group. */
export async function buildTemplate(): Promise<Buffer> {
  return buildWorkbook("Groups", HEADER_LABELS, [
    ["Maintenance team", "Journal editor | Assets & devices viewer", "no"],
  ]);
}

/** Export the groups — one row per group, roles joined, the system flag for reference. */
export async function buildExport(rows: GroupExportRow[]): Promise<Buffer> {
  return buildWorkbook(
    "Groups",
    HEADER_LABELS,
    rows.map((r) => [r.name, r.roles.join(GROUP_ROLE_SEPARATOR), r.isSystem ? "yes" : "no"]),
  );
}
