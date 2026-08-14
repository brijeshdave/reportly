// Author: Brijesh Dave <https://github.com/brijeshdave>
// The Excel export of a report result. One worksheet: a title block, then the table
// with a header row, group sub-headers and subtotal rows where the report is grouped
// — the same shape as the on-screen and printed report, so the three agree.
import ExcelJS from "exceljs";

import { type ReportResult, type ReportTotals, formatDurationMinutes } from "@reportly/shared";

import { cellValue, columnLabel, formatReportDate } from "./columns.js";

export async function reportToXlsx(result: ReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Reportly";
  wb.created = new Date();
  const ws = wb.addWorksheet("Report");

  const columns = result.meta.columns;
  const width = columns.length;

  // Title block.
  titleRow(ws, result.meta.viewName ?? "Journal report", width, 16, true);
  titleRow(
    ws,
    `${formatReportDate(result.meta.from)} — ${formatReportDate(result.meta.toInclusive)}` +
      (result.meta.companyName ? ` · ${result.meta.companyName}` : ""),
    width,
    11,
    false,
  );
  ws.addRow([]);

  // Header row.
  const header = ws.addRow(columns.map((c) => columnLabel(c)));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBBBBBB" } } };
  });

  const grouped = result.meta.grouping !== "none";
  for (const group of result.groups) {
    if (grouped) {
      const gr = ws.addRow([group.label]);
      ws.mergeCells(gr.number, 1, gr.number, width);
      gr.font = { bold: true, italic: true };
      gr.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F6F6" } };
    }
    for (const row of group.rows) {
      ws.addRow(columns.map((c) => cellValue(row, c)));
    }
    if (grouped) subtotalRow(ws, columns, group.totals, `${group.label} subtotal`);
  }

  // Grand total.
  subtotalRow(ws, columns, result.totals, "Total", true);

  autoWidth(ws, columns);
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function titleRow(
  ws: ExcelJS.Worksheet,
  text: string,
  width: number,
  size: number,
  bold: boolean,
): void {
  const row = ws.addRow([text]);
  ws.mergeCells(row.number, 1, row.number, Math.max(1, width));
  row.getCell(1).font = { bold, size };
}

function subtotalRow(
  ws: ExcelJS.Worksheet,
  columns: string[],
  totals: ReportTotals,
  label: string,
  grand = false,
): void {
  // The metric sits under whichever column it belongs to: work time under
  // "duration", outage time under "downtime".
  const cells = columns.map((c) => {
    if (c === "duration" && totals.durationMinutes > 0)
      return formatDurationMinutes(totals.durationMinutes);
    if (c === "downtime" && totals.downtimeMinutes > 0)
      return formatDurationMinutes(totals.downtimeMinutes);
    return "";
  });
  cells[0] = `${label} (${totals.count})`;
  const row = ws.addRow(cells);
  row.font = { bold: true };
  if (grand) {
    row.eachCell((cell) => {
      cell.border = { top: { style: "double", color: { argb: "FF999999" } } };
    });
  }
}

function autoWidth(ws: ExcelJS.Worksheet, columns: string[]): void {
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    let max = columnLabel(c).length;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > max) max = len;
    });
    col.width = Math.min(60, Math.max(10, max + 2));
  });
}
