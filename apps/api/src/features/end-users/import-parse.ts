// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reading an uploaded spreadsheet of end users, and writing them back out. Pure:
// bytes in, parsed rows and per-row problems out; the service does the database work.
//
// The employee number is the key. It is required, it is what an import matches on,
// and a file that repeats one is refused rather than applied — the second row would
// otherwise silently overwrite the first and nobody would know which won.
import {
  type RowProblem,
  buildWorkbook,
  gridFromCsv,
  gridFromXlsx,
  headerMapping,
  rowReader,
} from "@/core/spreadsheet/index.js";

const COLUMNS = ["employeeNumber", "fullName", "department", "description", "status"] as const;
type Column = (typeof COLUMNS)[number];

const HEADERS: Record<Column, string> = {
  employeeNumber: "Employee number",
  fullName: "Full name",
  department: "Department",
  // "Notes" on the sheet, `description` in the record: the master screen calls the
  // field Notes, and a template whose header does not match the screen is a template
  // people fill in wrongly.
  description: "Notes",
  status: "Status",
};

export interface ParsedEndUserRow {
  line: number;
  employeeNumber: string;
  fullName: string;
  department: string | null;
  description: string | null;
  status: string | null;
}

export interface EndUserParseResult {
  rows: ParsedEndUserRow[];
  problems: RowProblem[];
}

function fromGrid(grid: (string | null)[][]): EndUserParseResult {
  const problems: RowProblem[] = [];
  const rows: ParsedEndUserRow[] = [];

  const header = grid[0];
  if (!header) return { rows, problems: [{ line: 0, message: "The file is empty" }] };

  const mapping = headerMapping(header, COLUMNS, HEADERS);
  for (const required of ["employeeNumber", "fullName"] as const) {
    if (!mapping.includes(required)) {
      return {
        rows,
        problems: [
          {
            line: 1,
            message: `No "${HEADERS[required]}" column found. Download the template and keep its header row.`,
          },
        ],
      };
    }
  }

  const seen = new Map<string, number>();
  for (let r = 1; r < grid.length; r += 1) {
    const cells = grid[r] ?? [];
    const line = r + 1;
    if (cells.every((c) => c === null || c === "")) continue;

    const value = rowReader(cells, mapping);
    const employeeNumber = value("employeeNumber");
    const fullName = value("fullName");

    if (!employeeNumber) {
      problems.push({ line, message: "Employee number is required" });
      continue;
    }
    if (!fullName) {
      problems.push({ line, message: "Full name is required" });
      continue;
    }

    const key = employeeNumber.trim().toLowerCase();
    const firstSeen = seen.get(key);
    if (firstSeen !== undefined) {
      problems.push({
        line,
        message: `Employee number "${employeeNumber}" is already used on line ${firstSeen}`,
      });
      continue;
    }
    seen.set(key, line);

    const status = value("status");
    if (status && !["active", "inactive"].includes(status.toLowerCase())) {
      problems.push({ line, message: `Status must be "active" or "inactive", not "${status}"` });
      continue;
    }

    rows.push({
      line,
      employeeNumber,
      fullName,
      department: value("department") || null,
      description: value("description") || null,
      status: status ? status.toLowerCase() : null,
    });
  }

  return { rows, problems };
}

export function parseCsv(text: string): EndUserParseResult {
  return fromGrid(gridFromCsv(text));
}

export async function parseXlsx(buffer: Buffer): Promise<EndUserParseResult> {
  return fromGrid(await gridFromXlsx(buffer, COLUMNS.length));
}

export interface EndUserExportRow {
  employeeNumber: string;
  fullName: string;
  department: string | null;
  description: string | null;
  status: string;
}

const HEADER_LABELS = COLUMNS.map((c) => HEADERS[c]);

/** The downloadable template: the header row and two illustrative people. */
export async function buildTemplate(): Promise<Buffer> {
  return buildWorkbook("End users", HEADER_LABELS, [
    ["EMP-1001", "Asha Mehta", "Accounts", "Second floor, uses the shared printer", "active"],
    ["EMP-1002", "Rakesh Shah", "Stores", "", "active"],
  ]);
}

/** Export the list — one row per person, in the shape the import reads back. */
export async function buildExport(rows: EndUserExportRow[]): Promise<Buffer> {
  return buildWorkbook(
    "End users",
    HEADER_LABELS,
    rows.map((r) => [
      r.employeeNumber,
      r.fullName,
      r.department ?? "",
      r.description ?? "",
      r.status,
    ]),
  );
}
