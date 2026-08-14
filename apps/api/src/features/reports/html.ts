// Author: Brijesh Dave <https://github.com/brijeshdave>
// A self-contained, print-optimised HTML document for a report result. It is served
// as a downloadable file and is also what the browser prints to A4 — one template,
// so the downloaded page and the printed page are the same page. No external assets:
// the CSS is inline and the `@page` rule sets A4 with sensible margins.
import { type ReportResult } from "@reportly/shared";

import { cellValue, columnLabel, columnWidthsPct, formatReportDate } from "./columns.js";

/** Minimal HTML escape for text taken from the data. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function reportToHtml(result: ReportResult): string {
  const { meta } = result;
  const columns = meta.columns;
  const title = meta.viewName ?? "Journal report";
  const grouped = meta.grouping !== "none";
  const span = columns.length;

  const headerCells = columns.map((c) => `<th>${esc(columnLabel(c))}</th>`).join("");
  const widths = columnWidthsPct(columns);
  const colGroup = `<colgroup>${widths.map((w) => `<col style="width:${w}%" />`).join("")}</colgroup>`;

  const bodyBlocks = result.groups
    .map((group) => {
      const rows = group.rows
        .map(
          (row) => `<tr>${columns.map((c) => `<td>${esc(cellValue(row, c))}</td>`).join("")}</tr>`,
        )
        .join("");
      if (!grouped) return rows;
      const subtotal = `<tr class="subtotal"><td colspan="${span}">${esc(group.label)} — ${group.totals.count} entr${
        group.totals.count === 1 ? "y" : "ies"
      }</td></tr>`;
      const heading = `<tr class="group"><td colspan="${span}">${esc(group.label)}</td></tr>`;
      return heading + rows + subtotal;
    })
    .join("");

  const totalRow = `<tr class="total"><td colspan="${span}">Total — ${result.totals.count} entr${
    result.totals.count === 1 ? "y" : "ies"
  }</td></tr>`;

  const rangeLine = `${formatReportDate(meta.from)} – ${formatReportDate(meta.toInclusive)}`;
  const subtitle = [meta.companyName, rangeLine]
    .filter((v): v is string => Boolean(v))
    .map(esc)
    .join(" · ");
  const generated = `Generated ${formatReportDate(meta.generatedAt)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  /* Landscape so a report with many columns fits the page instead of being clipped. */
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 20px; font-size: 11px; }
  header { border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .subtitle { color: #555; font-size: 12px; }
  .generated { color: #888; font-size: 11px; margin-top: 2px; }
  /* Fixed layout + wrapping cells: long free-text columns wrap on the page, never
     push the table wider than the paper. */
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { text-align: left; padding: 4px 6px; vertical-align: top; border-bottom: 1px solid #e5e5e5; word-break: break-word; overflow-wrap: anywhere; }
  th { background: #efefef; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
  tr.group td { background: #f6f6f6; font-weight: 700; padding-top: 9px; }
  tr.subtotal td { font-style: italic; color: #555; border-bottom: 1px solid #ccc; }
  tr.total td { font-weight: 700; border-top: 2px solid #333; background: #fafafa; }
  tbody tr { page-break-inside: avoid; }
  .print-hint { margin-top: 16px; color: #888; font-size: 11px; }
  @media print { .print-hint { display: none; } body { padding: 0; } }
</style>
</head>
<body>
  <header>
    <h1>${esc(title)}</h1>
    <div class="subtitle">${subtitle}</div>
    <div class="generated">${esc(generated)}</div>
  </header>
  <table>
    ${colGroup}
    <thead><tr>${headerCells}</tr></thead>
    <tbody>
      ${bodyBlocks}
      ${totalRow}
    </tbody>
  </table>
  <p class="print-hint">Use your browser's Print (Ctrl/Cmd&nbsp;+&nbsp;P) and choose “Save as PDF” for an A4 copy.</p>
</body>
</html>`;
}
