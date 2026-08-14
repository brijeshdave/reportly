// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reading an uploaded spreadsheet of locations (sites), and writing them back out. Pure:
// bytes in, parsed rows and per-row problems out; the service does the database work.
// Locations are flat and unique per company by name, so an import creates a new site or
// updates an existing one's status.
import {
  type RowProblem,
  buildWorkbook,
  gridFromCsv,
  gridFromXlsx,
  headerMapping,
  rowReader,
} from "@/core/spreadsheet/index.js";

const COLUMNS = ["name", "status"] as const;
type Column = (typeof COLUMNS)[number];

const HEADERS: Record<Column, string> = {
  name: "Name",
  status: "Status",
};

export interface ParsedLocationRow {
  line: number;
  name: string;
  status: string | null;
}

export interface LocationParseResult {
  rows: ParsedLocationRow[];
  problems: RowProblem[];
}

function fromGrid(grid: (string | null)[][]): LocationParseResult {
  const problems: RowProblem[] = [];
  const rows: ParsedLocationRow[] = [];

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

    const status = value("status");
    if (status && !["active", "inactive"].includes(status.toLowerCase())) {
      problems.push({ line, message: `Status must be "active" or "inactive", not "${status}"` });
      continue;
    }

    rows.push({ line, name, status: status ? status.toLowerCase() : null });
  }

  return { rows, problems };
}

export function parseCsv(text: string): LocationParseResult {
  return fromGrid(gridFromCsv(text));
}

export async function parseXlsx(buffer: Buffer): Promise<LocationParseResult> {
  return fromGrid(await gridFromXlsx(buffer, COLUMNS.length));
}

export interface LocationExportRow {
  name: string;
  status: string;
}

const HEADER_LABELS = COLUMNS.map((c) => HEADERS[c]);

/** The downloadable template: the header row plus a couple of illustrative sites. */
export async function buildTemplate(): Promise<Buffer> {
  return buildWorkbook("Locations", HEADER_LABELS, [
    ["Head office", "active"],
    ["Plant A", "active"],
  ]);
}

/** Export the sites — one row per location. */
export async function buildExport(rows: LocationExportRow[]): Promise<Buffer> {
  return buildWorkbook(
    "Locations",
    HEADER_LABELS,
    rows.map((r) => [r.name, r.status]),
  );
}
