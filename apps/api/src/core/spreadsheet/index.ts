// Author: Brijesh Dave <https://github.com/brijeshdave>
// Shared spreadsheet plumbing for the bulk import/export features.
//
// Every importable resource reads the same kind of file — a header row naming columns,
// then one data row each — and writes the same kind back. The boilerplate that turns
// bytes into a grid of trimmed cells (CSV parsing that honours quotes, ExcelJS's
// rich-text/formula cell shapes, a BOM Excel prepends) and a grid back into a styled
// workbook is identical everywhere, so it lives here once. Each feature keeps only the
// part that is actually its own: which columns it has, and what a valid row means.
//
// The devices and assets importers predate this module and still hand-roll the same
// logic; new importers use these primitives instead.
import ExcelJS from "exceljs";

/** One row that could not be accepted, and why — reported per line, never dropped. */
export interface RowProblem {
  line: number;
  message: string;
}

/**
 * Coerce any cell to a trimmed string, or null when empty. ExcelJS hands back rich
 * text and formula results as objects, so those are unwrapped to their text first.
 */
export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw =
    typeof value === "object"
      ? ((value as { result?: unknown; text?: unknown }).result ??
        (value as { text?: unknown }).text ??
        "")
      : value;
  const text = String(raw).trim();
  return text === "" ? null : text;
}

/** Split one CSV line, honouring quoted fields (which may contain commas). */
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

/** Parse a CSV upload into a grid of trimmed cells (null = empty). */
export function gridFromCsv(text: string): (string | null)[][] {
  // Strip a BOM — Excel writes one, and it would otherwise corrupt the first header.
  const body = text.replace(/^\uFEFF/, "");
  return body.split(/\r?\n/).map((line) => splitCsvLine(line).map((c) => cellText(c)));
}

/** Parse the first worksheet of an .xlsx upload into a grid of trimmed cells. */
export async function gridFromXlsx(buffer: Buffer, minCols: number): Promise<(string | null)[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const grid: (string | null)[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: (string | null)[] = [];
    // `row.values` is 1-based with a leading hole; walk by column instead.
    const count = Math.max(row.cellCount, minCols);
    for (let c = 1; c <= count; c += 1) cells.push(cellText(row.getCell(c).value));
    grid.push(cells);
  });
  return grid;
}

/**
 * Map a header row to a column key set, tolerating case and stray spaces and accepting
 * either the human header label or the key itself. The result is positional: index `i`
 * holds the key that column `i` carries, or null for an unrecognised column.
 */
export function headerMapping<K extends string>(
  headerRow: (string | null)[],
  columns: readonly K[],
  headers: Record<K, string>,
): (K | null)[] {
  return headerRow.map((cell) => {
    if (!cell) return null;
    const norm = cell.trim().toLowerCase();
    for (const key of columns) {
      if (headers[key].toLowerCase() === norm) return key;
      if (key.toLowerCase() === norm) return key;
    }
    return null;
  });
}

/** A reader over one grid row: fetch a column's cell by key, or null if absent. */
export function rowReader<K extends string>(
  cells: (string | null)[],
  mapping: (K | null)[],
): (column: K) => string | null {
  return (column) => {
    const at = mapping.indexOf(column);
    return at === -1 ? null : (cells[at] ?? null);
  };
}

/** Build a styled workbook: a bold, shaded header row then the data rows. */
export async function buildWorkbook(
  sheetName: string,
  headerLabels: string[],
  rows: (string | number | null)[][],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Reportly";
  const sheet = wb.addWorksheet(sheetName);

  sheet.addRow(headerLabels);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  });
  headerLabels.forEach((label, i) => {
    sheet.getColumn(i + 1).width = Math.max(16, label.length + 6);
  });

  for (const row of rows) sheet.addRow(row.map((c) => c ?? ""));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
