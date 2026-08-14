// Author: Brijesh Dave <https://github.com/brijeshdave>
// Turning an uploaded spreadsheet into asset rows, and the tree back into a spreadsheet.
//
// Kept pure — bytes in, parsed rows and per-row problems out — because the rules here are
// all about malformed input, miserable to exercise through HTTP. The service does the
// database work; this file only decides what the file *says*.
//
// Assets are a tree, so each row carries the full **path** from the root (e.g.
// `Kim › Line 1 › Station A`); the importer creates or finds each ancestor by name. The
// guiding rule matches the device import: a bad row never silently becomes a bad asset —
// every problem is reported with its line number, and the caller writes all or nothing.
import ExcelJS from "exceljs";

/** The separator between path segments — the same the web asset picker shows. */
export const ASSET_PATH_SEPARATOR = " › ";

export const ASSET_IMPORT_COLUMNS = ["path", "type", "site", "status"] as const;
export type AssetImportColumn = (typeof ASSET_IMPORT_COLUMNS)[number];

export const ASSET_IMPORT_HEADERS: Record<AssetImportColumn, string> = {
  path: "Path",
  type: "Type",
  site: "Site",
  status: "Status",
};

/** One row as the file states it — names, not ids. Resolution happens in the service. */
export interface ParsedAssetRow {
  /** 1-based row number in the sheet, counting the header — for the error report. */
  line: number;
  /** The path as written, and split into trimmed segments (root first). */
  path: string;
  segments: string[];
  type: string | null;
  /** The asset's own site; blank means it inherits its parent's. */
  site: string | null;
  status: string | null;
}

export interface RowProblem {
  line: number;
  message: string;
}

export interface ParseResult {
  rows: ParsedAssetRow[];
  problems: RowProblem[];
}

const clean = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const raw =
    typeof value === "object"
      ? ((value as { result?: unknown; text?: unknown }).result ??
        (value as { text?: unknown }).text ??
        "")
      : value;
  const text = String(raw).trim();
  return text === "" ? null : text;
};

function columnFor(header: string): AssetImportColumn | null {
  const norm = header.trim().toLowerCase();
  for (const key of ASSET_IMPORT_COLUMNS) {
    if (ASSET_IMPORT_HEADERS[key].toLowerCase() === norm) return key;
    if (key.toLowerCase() === norm) return key;
  }
  return null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Split a path on the separator, tolerating `>` written without the fancy chevron. */
function segmentsOf(path: string): string[] {
  return path
    .split(/›|>/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function fromGrid(grid: (string | null)[][]): ParseResult {
  const problems: RowProblem[] = [];
  const rows: ParsedAssetRow[] = [];

  const headerRow = grid[0];
  if (!headerRow) return { rows, problems: [{ line: 0, message: "The file is empty" }] };

  const mapping = headerRow.map((cell) => (cell ? columnFor(cell) : null));
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

    const value = (column: AssetImportColumn): string | null => {
      const at = mapping.indexOf(column);
      return at === -1 ? null : (cells[at] ?? null);
    };

    if (cells.every((c) => c === null || c === "")) continue;

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

    rows.push({
      line,
      path,
      segments,
      type: value("type"),
      site: value("site"),
      status: status ? status.toLowerCase() : null,
    });
  }

  return { rows, problems };
}

export function parseCsv(text: string): ParseResult {
  // Strip a BOM — Excel writes one, and it would otherwise corrupt the first header.
  const body = text.replace(/^\uFEFF/, "");
  const grid = body.split(/\r?\n/).map((line) => splitCsvLine(line).map((c) => clean(c)));
  return fromGrid(grid);
}

export async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return { rows: [], problems: [{ line: 0, message: "The workbook has no sheets" }] };

  const grid: (string | null)[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: (string | null)[] = [];
    const count = Math.max(row.cellCount, ASSET_IMPORT_COLUMNS.length);
    for (let c = 1; c <= count; c += 1) cells.push(clean(row.getCell(c).value));
    grid.push(cells);
  });
  return fromGrid(grid);
}

/** The header row Excel exports and imports read. */
function headerRow(sheet: ExcelJS.Worksheet): void {
  sheet.addRow(ASSET_IMPORT_COLUMNS.map((c) => ASSET_IMPORT_HEADERS[c]));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  });
  ASSET_IMPORT_COLUMNS.forEach((c, i) => {
    sheet.getColumn(i + 1).width = Math.max(16, ASSET_IMPORT_HEADERS[c].length + 8);
  });
}

/** The downloadable template: the header row plus a small illustrative tree. */
export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Reportly";
  const sheet = wb.addWorksheet("Assets");
  headerRow(sheet);
  // A parent placed at a site, then children that inherit it (Site left blank).
  sheet.addRow(["Plant A", "Plant", "Plant A", "active"]);
  sheet.addRow(["Plant A › Line 3", "Line", "", "active"]);
  sheet.addRow(["Plant A › Line 3 › Station 1", "Station", "", "active"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** One export row: an asset's full path, its own type, its own site, and status. */
export interface AssetExportRow {
  path: string;
  type: string | null;
  site: string | null;
  status: string;
}

/** Build the export workbook from the flattened tree (already parent-before-child). */
export async function buildExport(rows: AssetExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Reportly";
  const sheet = wb.addWorksheet("Assets");
  headerRow(sheet);
  for (const row of rows) sheet.addRow([row.path, row.type ?? "", row.site ?? "", row.status]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
