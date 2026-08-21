// Author: Brijesh Dave <https://github.com/brijeshdave>
// The month roster, out of the app: a spreadsheet and a printable page.
//
// Both carry the same stamp — when it was exported and by whom — because a roster
// gets printed, pinned to a wall and argued with a fortnight later, and the first
// question is always "is this the current one?". A sheet of shift codes with no date
// on it cannot answer that.
//
// The printable page is **landscape** and nothing else: a month is 31 columns wide,
// and portrait A4 either shrinks it past reading or throws a third of it onto page
// two. `@page { size: A4 landscape }` says so, so the browser's own Save-as-PDF —
// which is what makes the PDF here, rather than a headless browser in the image —
// opens with the right orientation already chosen.
import ExcelJS from "exceljs";
import type { ScheduleGrid, ShiftColor } from "@reportly/shared";
import { ENTRY_STATE_CODES } from "@reportly/shared";

/** The palette as hex, matching what the grid draws on screen. */
const COLOR_HEX: Record<ShiftColor, string> = {
  slate: "FF475569",
  red: "FFDC2626",
  orange: "FFEA580C",
  amber: "FFFBBF24",
  green: "FF15803D",
  teal: "FF0F766E",
  blue: "FF1D4ED8",
  indigo: "FF4338CA",
  violet: "FF6D28D9",
  pink: "FFDB2777",
  "dark-red": "FF7F1D1D",
  maroon: "FF881337",
  brown: "FF713F12",
  olive: "FF3F6212",
  emerald: "FF065F46",
  cyan: "FF155E75",
  purple: "FF6B21A8",
  gray: "FF374151",
};

/** Amber is the one fill dark text must sit on; the rest take white. */
const DARK_TEXT: ReadonlySet<ShiftColor> = new Set<ShiftColor>(["amber"]);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface ExportStamp {
  /** When the export was taken, as an ISO instant. */
  at: Date;
  /** Who took it — a roster is argued with, and "by whom" is half the answer. */
  by: string;
}

function title(grid: ScheduleGrid): string {
  const where = grid.locationName ?? "Central rota";
  return `${grid.departmentName} — ${where} — ${MONTHS[grid.month - 1]} ${grid.year}`;
}

function stampLine({ at, by }: ExportStamp): string {
  const date = at.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `Exported ${date} ${time} by ${by}`;
}

/** What one person's day says: the shift's code, or W/O / L / PH, or blank. */
function codeFor(
  grid: ScheduleGrid,
  userId: string,
  date: string,
): { text: string; color: ShiftColor | null } {
  const entry = grid.entries.find((e) => e.userId === userId && e.date === date);
  if (!entry) return { text: "", color: null };
  if (entry.state !== "working") {
    return {
      text: ENTRY_STATE_CODES[entry.state],
      color: grid.stateColors[entry.state],
    };
  }
  const shift = grid.shifts.find((s) => s.id === entry.shiftId);
  return shift ? { text: shift.code, color: shift.color } : { text: "", color: null };
}

const WEEKDAY_INITIALS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

export async function scheduleToXlsx(grid: ScheduleGrid, stamp: ExportStamp): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Reportly";
  const sheet = wb.addWorksheet(`${MONTHS[grid.month - 1]} ${grid.year}`, {
    // Landscape here too: a roster printed from Excel has the same 31 columns.
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  sheet.addRow([title(grid)]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([stampLine(stamp)]);
  sheet.getRow(2).font = { italic: true, size: 10, color: { argb: "FF666666" } };
  sheet.addRow([]);

  // Two header rows, not one cell holding "1 Sa": a spreadsheet column is sorted,
  // filtered and referenced by what is in the cell, and "1 Sa" is neither a date nor
  // a weekday. The screen stacks them for the same reason.
  const weekdayRow = sheet.addRow(["", ...grid.days.map((d) => WEEKDAY_INITIALS[weekdayOf(d)])]);
  const dayRow = sheet.addRow(["Person", ...grid.days.map((d) => Number(d.slice(8, 10)))]);

  for (const row of [weekdayRow, dayRow]) {
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
      cell.alignment = { horizontal: "center" };
    });
  }
  // The weekday row is the quieter of the two — it repeats every seven columns.
  weekdayRow.font = { bold: false, size: 9, color: { argb: "FF666666" } };
  // "Person" spans both, so the name column has one heading rather than a blank
  // above it.
  sheet.mergeCells(weekdayRow.number, 1, dayRow.number, 1);
  sheet.getCell(weekdayRow.number, 1).value = "Person";
  sheet.getCell(weekdayRow.number, 1).font = { bold: true };
  sheet.getCell(weekdayRow.number, 1).alignment = { horizontal: "left", vertical: "middle" };

  for (const member of grid.members) {
    const row = sheet.addRow([
      member.name,
      ...grid.days.map((date) => codeFor(grid, member.userId, date).text),
    ]);
    // The fills are the point: the spreadsheet should look like the screen, or the
    // person reading it has to learn a second visual language for the same rota.
    grid.days.forEach((date, index) => {
      const { color } = codeFor(grid, member.userId, date);
      if (!color) return;
      const cell = row.getCell(index + 2);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEX[color] } };
      cell.font = { bold: true, color: { argb: DARK_TEXT.has(color) ? "FF1C1917" : "FFFFFFFF" } };
      cell.alignment = { horizontal: "center" };
    });
  }

  sheet.getColumn(1).width = 26;
  for (let i = 2; i <= grid.days.length + 1; i += 1) sheet.getColumn(i).width = 4.5;
  // Freeze below both header rows and right of the names, so scrolling a long month
  // keeps the dates and the people on screen.
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: dayRow.number }];

  // The legend on its own sheet: a code with no key is a puzzle to anybody who did
  // not build the rota.
  const legend = wb.addWorksheet("Legend");
  legend.addRow(["Code", "Means", "Hours"]).font = { bold: true };
  for (const shift of grid.shifts) {
    legend.addRow([
      shift.code,
      shift.name,
      `${String(Math.floor(shift.startMinute / 60)).padStart(2, "0")}:${String(shift.startMinute % 60).padStart(2, "0")}–${String(Math.floor(shift.endMinute / 60)).padStart(2, "0")}:${String(shift.endMinute % 60).padStart(2, "0")}`,
    ]);
  }
  for (const state of ["off", "leave", "holiday"] as const) {
    legend.addRow([
      ENTRY_STATE_CODES[state],
      state === "off" ? "Weekly off" : state === "leave" ? "Leave" : "Public holiday",
      "",
    ]);
  }
  legend.getColumn(1).width = 10;
  legend.getColumn(2).width = 28;
  legend.getColumn(3).width = 16;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Text that reads on a fill — the same per-hue judgement the screen makes. */
const textOn = (color: ShiftColor): string => (DARK_TEXT.has(color) ? "#1c1917" : "#ffffff");
const hex = (color: ShiftColor): string => `#${COLOR_HEX[color].slice(2)}`;

export function scheduleToHtml(grid: ScheduleGrid, stamp: ExportStamp): string {
  const head = grid.days
    .map((d) => {
      const weekend = [0, 6].includes(weekdayOf(d));
      return `<th class="${weekend ? "weekend" : ""}"><span>${Number(d.slice(8, 10))}</span><small>${WEEKDAY_INITIALS[weekdayOf(d)]}</small></th>`;
    })
    .join("");

  const body = grid.members
    .map((member) => {
      const cells = grid.days
        .map((date) => {
          const { text, color } = codeFor(grid, member.userId, date);
          if (!color) return `<td></td>`;
          return `<td style="background:${hex(color)};color:${textOn(color)}">${esc(text)}</td>`;
        })
        .join("");
      return `<tr><th class="name">${esc(member.name)}</th>${cells}</tr>`;
    })
    .join("");

  const legend = [
    ...grid.shifts.map((s) => ({ code: s.code, label: s.name, color: s.color })),
    { code: ENTRY_STATE_CODES.off, label: "Weekly off", color: grid.stateColors.off },
    { code: ENTRY_STATE_CODES.leave, label: "Leave", color: grid.stateColors.leave },
    { code: ENTRY_STATE_CODES.holiday, label: "Public holiday", color: grid.stateColors.holiday },
  ]
    .map(
      (item) =>
        `<span class="key"><b style="background:${hex(item.color)};color:${textOn(item.color)}">${esc(item.code)}</b> ${esc(item.label)}</span>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title(grid))}</title>
<style>
  /* Landscape, always: 31 columns do not fit portrait without shrinking past reading. */
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 12px; color: #111; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .stamp { font-size: 11px; color: #666; margin: 0 0 10px; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th, td { border: 1px solid #d4d4d4; font-size: 10px; text-align: center; padding: 2px 0; }
  th.name { width: 130px; text-align: left; padding-left: 6px; font-weight: 600; font-size: 10px; }
  thead th span { display: block; font-weight: 700; }
  thead th small { display: block; font-weight: 400; color: #666; font-size: 8px; }
  thead th.weekend { background: #f4f4f5; }
  td { font-weight: 700; }
  .legend { margin-top: 10px; font-size: 10px; display: flex; flex-wrap: wrap; gap: 10px; }
  .key b { display: inline-block; min-width: 20px; text-align: center; border-radius: 3px; padding: 1px 4px; margin-right: 3px; }
  .print-hint { margin-top: 12px; color: #888; font-size: 10px; }
  @media print { .print-hint { display: none; } body { padding: 0; } }
</style></head>
<body>
  <h1>${esc(title(grid))}</h1>
  <p class="stamp">${esc(stampLine(stamp))}</p>
  <table>
    <thead><tr><th class="name">Person</th>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="legend">${legend}</div>
  <p class="print-hint">Print this page (Ctrl/Cmd-P) and choose "Save as PDF" — it is already set to A4 landscape.</p>
</body></html>`;
}
