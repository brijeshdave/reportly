// Author: Brijesh Dave <https://github.com/brijeshdave>
// Turning an uploaded spreadsheet into device rows.
//
// Kept pure — bytes in, parsed rows and per-row problems out — because the rules
// that matter here are all about malformed input, and those are miserable to
// exercise through HTTP. The service does the database work; this file only decides
// what the file *says*.
//
// The guiding rule: a bad row must never silently become a bad device. Every row is
// reported with its own line number and its own reason, and the caller decides
// whether to write the good ones or refuse the whole file.
import ExcelJS from "exceljs";

import { buildWorkbook } from "@/core/spreadsheet/index.js";

/** The columns a template carries, in order. `name` is the only required one. */
export const DEVICE_IMPORT_COLUMNS = [
  "name",
  "identifier",
  "assetTag",
  "type",
  "site",
  "asset",
  "status",
] as const;
export type DeviceImportColumn = (typeof DEVICE_IMPORT_COLUMNS)[number];

/** Header text written into the template, and accepted (case-insensitively) back. */
export const DEVICE_IMPORT_HEADERS: Record<DeviceImportColumn, string> = {
  name: "Name",
  identifier: "Identifier",
  assetTag: "Asset tag",
  type: "Type",
  site: "Site",
  asset: "Lives at (asset)",
  status: "Status",
};

/** One row as the file states it — names, not ids. Resolution happens later. */
export interface ParsedDeviceRow {
  /** 1-based row number in the sheet, counting the header — for the error report. */
  line: number;
  name: string;
  identifier: string | null;
  assetTag: string | null;
  type: string | null;
  site: string | null;
  asset: string | null;
  status: string | null;
}

export interface RowProblem {
  line: number;
  message: string;
}

export interface ParseResult {
  rows: ParsedDeviceRow[];
  problems: RowProblem[];
}

const clean = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  // ExcelJS hands back rich text and formula results as objects.
  const raw =
    typeof value === "object"
      ? ((value as { result?: unknown; text?: unknown }).result ??
        (value as { text?: unknown }).text ??
        "")
      : value;
  const text = String(raw).trim();
  return text === "" ? null : text;
};

/** Match a header cell to a column, tolerating case and stray spaces. */
function columnFor(header: string): DeviceImportColumn | null {
  const norm = header.trim().toLowerCase();
  for (const key of DEVICE_IMPORT_COLUMNS) {
    if (DEVICE_IMPORT_HEADERS[key].toLowerCase() === norm) return key;
    if (key.toLowerCase() === norm) return key;
  }
  return null;
}

/** Split a CSV line, honouring quoted fields (which may contain commas). */
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

function fromGrid(grid: (string | null)[][]): ParseResult {
  const problems: RowProblem[] = [];
  const rows: ParsedDeviceRow[] = [];

  const headerRow = grid[0];
  if (!headerRow) return { rows, problems: [{ line: 0, message: "The file is empty" }] };

  const mapping = headerRow.map((cell) => (cell ? columnFor(cell) : null));
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

    const value = (column: DeviceImportColumn): string | null => {
      const at = mapping.indexOf(column);
      return at === -1 ? null : (cells[at] ?? null);
    };

    // A trailing blank line is not a mistake worth reporting.
    if (cells.every((c) => c === null || c === "")) continue;

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

    rows.push({
      line,
      name,
      identifier: value("identifier"),
      assetTag: value("assetTag"),
      type: value("type"),
      site: value("site"),
      asset: value("asset"),
      status: status ? status.toLowerCase() : null,
    });
  }

  return { rows, problems };
}

/** Parse a CSV upload. */
export function parseCsv(text: string): ParseResult {
  // Strip a BOM — Excel writes one, and it would otherwise corrupt the first header.
  const body = text.replace(/^\uFEFF/, "");
  const lines = body.split(/\r?\n/);
  const grid = lines.map((line) => splitCsvLine(line).map((c) => clean(c)));
  return fromGrid(grid);
}

/** Parse an .xlsx upload — the first worksheet only. */
export async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return { rows: [], problems: [{ line: 0, message: "The workbook has no sheets" }] };

  const grid: (string | null)[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: (string | null)[] = [];
    // `row.values` is 1-based with a leading hole; walk by column instead.
    const count = Math.max(row.cellCount, DEVICE_IMPORT_COLUMNS.length);
    for (let c = 1; c <= count; c += 1) cells.push(clean(row.getCell(c).value));
    grid.push(cells);
  });
  return fromGrid(grid);
}

/** The downloadable template: the header row, plus one illustrative example. */
export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Reportly";
  const sheet = wb.addWorksheet("Devices");

  sheet.addRow(DEVICE_IMPORT_COLUMNS.map((c) => DEVICE_IMPORT_HEADERS[c]));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  });

  // An example row, so the expected shape is obvious without reading a manual.
  sheet.addRow([
    "Vibration sensor 12",
    "SN-99213",
    "AT-0042",
    "Sensor",
    "Plant A",
    "Line 3",
    "active",
  ]);

  DEVICE_IMPORT_COLUMNS.forEach((c, i) => {
    sheet.getColumn(i + 1).width = Math.max(16, DEVICE_IMPORT_HEADERS[c].length + 4);
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/** One export row: a device with its type, site and asset resolved to names — the same
 *  columns the import reads, so the register round-trips. */
export interface DeviceExportRow {
  name: string;
  identifier: string | null;
  assetTag: string | null;
  type: string | null;
  site: string | null;
  asset: string | null;
  status: string;
}

/** Export the device register — one row per device, in the import's column order. */
export async function buildExport(rows: DeviceExportRow[]): Promise<Buffer> {
  return buildWorkbook(
    "Devices",
    DEVICE_IMPORT_COLUMNS.map((c) => DEVICE_IMPORT_HEADERS[c]),
    rows.map((r) => [r.name, r.identifier, r.assetTag, r.type, r.site, r.asset, r.status]),
  );
}
