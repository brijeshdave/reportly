// Author: Brijesh Dave <https://github.com/brijeshdave>
// Presentation helpers shared by the Excel and HTML exports. Rows arrive with their
// values already formatted into `cells` (the service does that per source), so here
// we only look a cell up, label a column, and size columns for the printed page.
import { type ReportRow, ALL_REPORT_COLUMN_LABELS, formatDate } from "@reportly/shared";

/** DD-MM-YYYY — the one date format used across the product (shared formatter). */
export function formatReportDate(iso: string | null): string {
  return formatDate(iso);
}

export function columnLabel(column: string): string {
  return ALL_REPORT_COLUMN_LABELS[column] ?? column;
}

export function cellValue(row: ReportRow, column: string): string {
  return row.cells[column] ?? "";
}

// Relative column widths, so free-text columns (description, work done, title) get
// the room and the short ones (date, points) stay narrow — the printed report then
// fits the page and wraps rather than overflowing. Unknown columns fall back to 1.
const COLUMN_WEIGHT: Record<string, number> = {
  date: 1.1,
  kind: 0.9,
  title: 2.4,
  issueSummary: 3.2,
  workSummary: 3.2,
  category: 1.4,
  department: 1.4,
  location: 1.4,
  asset: 1.8,
  author: 1.4,
  assignee: 1.4,
  severity: 1,
  status: 1.1,
  duration: 1,
  age: 0.9,
  points: 0.8,
  // downtime / reliability
  reason: 2.2,
  start: 1.3,
  end: 1.3,
  downtime: 1.1,
  reporter: 1.4,
  failures: 0.9,
  open: 0.9,
  mttr: 1,
  mtbf: 1,
  availability: 1,
  month: 1.3,
  device: 1.8,
  rank: 0.5,
  person: 2.2,
  own: 0.9,
  team: 0.9,
  // shift changes
  change: 2.2,
  action: 1,
  actor: 1.4,
  // shift roster / coverage / attendance
  shift: 1.6,
  hours: 0.8,
  assigned: 0.9,
  working: 0.9,
  off: 0.9,
  leave: 0.9,
  holiday: 0.9,
  doubles: 0.9,
  // routines
  routine: 2.2,
  started: 1.3,
  finished: 1.3,
  due: 0.8,
  completed: 0.9,
  missed: 0.8,
  onTime: 1,
};

/** Percentage width for each column, in order — for a fixed-layout print table. */
export function columnWidthsPct(columns: string[]): number[] {
  const total = columns.reduce((sum, c) => sum + (COLUMN_WEIGHT[c] ?? 1), 0);
  return columns.map((c) => Math.round(((COLUMN_WEIGHT[c] ?? 1) / total) * 1000) / 10);
}
