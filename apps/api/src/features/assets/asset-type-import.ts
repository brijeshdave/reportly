// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reading an uploaded spreadsheet of asset *types* (the global vocabulary — Plant, Line,
// Station…), and writing the vocabulary back out. Pure: bytes in, parsed rows and per-row
// problems out; the service does the database work. Types are keyed by name (which is
// unique), so an import creates a new type or updates an existing one's order and status.
import {
  type RowProblem,
  buildWorkbook,
  gridFromCsv,
  gridFromXlsx,
  headerMapping,
  rowReader,
} from "@/core/spreadsheet/index.js";

const COLUMNS = ["name", "order", "status"] as const;
type Column = (typeof COLUMNS)[number];

const HEADERS: Record<Column, string> = {
  name: "Name",
  order: "Order",
  status: "Status",
};

export interface ParsedAssetTypeRow {
  line: number;
  name: string;
  orderIndex: number | null;
  status: string | null;
}

export interface AssetTypeParseResult {
  rows: ParsedAssetTypeRow[];
  problems: RowProblem[];
}

function fromGrid(grid: (string | null)[][]): AssetTypeParseResult {
  const problems: RowProblem[] = [];
  const rows: ParsedAssetTypeRow[] = [];

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

    const orderRaw = value("order");
    let orderIndex: number | null = null;
    if (orderRaw !== null) {
      const n = Number(orderRaw);
      if (!Number.isInteger(n)) {
        problems.push({ line, message: `Order must be a whole number, not "${orderRaw}"` });
        continue;
      }
      orderIndex = n;
    }

    rows.push({ line, name, orderIndex, status: status ? status.toLowerCase() : null });
  }

  return { rows, problems };
}

export function parseCsv(text: string): AssetTypeParseResult {
  return fromGrid(gridFromCsv(text));
}

export async function parseXlsx(buffer: Buffer): Promise<AssetTypeParseResult> {
  return fromGrid(await gridFromXlsx(buffer, COLUMNS.length));
}

export interface AssetTypeExportRow {
  name: string;
  orderIndex: number;
  status: string;
}

const HEADER_LABELS = COLUMNS.map((c) => HEADERS[c]);

/** The downloadable template: the header row plus a couple of illustrative types. */
export async function buildTemplate(): Promise<Buffer> {
  return buildWorkbook("Asset types", HEADER_LABELS, [
    ["Plant", 0, "active"],
    ["Line", 1, "active"],
    ["Station", 2, "active"],
  ]);
}

/** Export the vocabulary — one row per type, in its display order. */
export async function buildExport(rows: AssetTypeExportRow[]): Promise<Buffer> {
  return buildWorkbook(
    "Asset types",
    HEADER_LABELS,
    rows.map((r) => [r.name, r.orderIndex, r.status]),
  );
}
