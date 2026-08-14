// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reading an uploaded spreadsheet of the journal vocabulary, and writing it back out.
//
// The vocabulary is four kinds of thing that a journal entry is filed with: company-wide
// **severities** and **statuses** (each in a workflow group),
// and per-department **categories** and **tags**. They differ enough in their fields that
// one sheet with a `Kind` column — and the columns each kind uses — round-trips all four
// without four separate files. This file decides only what the file says; the service
// resolves departments and writes the rows.
import { STATUS_GROUPS } from "@reportly/shared";

import {
  type RowProblem,
  buildWorkbook,
  gridFromCsv,
  gridFromXlsx,
  headerMapping,
  rowReader,
} from "@/core/spreadsheet/index.js";

export const VOCAB_KINDS = ["category", "tag", "severity", "status"] as const;
export type VocabKind = (typeof VOCAB_KINDS)[number];

const COLUMNS = [
  "kind",
  "department",
  "name",
  "group",
  "terminal",
  "color",
  "description",
  "status",
] as const;
type Column = (typeof COLUMNS)[number];

const HEADERS: Record<Column, string> = {
  kind: "Kind",
  department: "Department",
  name: "Name",
  group: "Group",
  terminal: "Terminal",
  color: "Color",
  description: "Description",
  status: "Status",
};

export interface ParsedVocabRow {
  line: number;
  kind: VocabKind;
  /** For category/tag: the department name. Ignored for severity/status. */
  department: string | null;
  name: string;
  /** status only. */
  group: string | null;
  /** status only. */
  terminal: boolean | null;
  /** tag only. */
  color: string | null;
  /** category/tag only. */
  description: string | null;
  status: string | null;
}

export interface VocabParseResult {
  rows: ParsedVocabRow[];
  problems: RowProblem[];
}

const TRUE = new Set(["true", "yes", "y", "1"]);
const FALSE = new Set(["false", "no", "n", "0"]);
const HEX = /^#[0-9a-fA-F]{6}$/;

function fromGrid(grid: (string | null)[][]): VocabParseResult {
  const problems: RowProblem[] = [];
  const rows: ParsedVocabRow[] = [];

  const header = grid[0];
  if (!header) return { rows, problems: [{ line: 0, message: "The file is empty" }] };

  const mapping = headerMapping(header, COLUMNS, HEADERS);
  if (!mapping.includes("kind") || !mapping.includes("name")) {
    return {
      rows,
      problems: [
        {
          line: 1,
          message: `Need a "Kind" and a "Name" column. Download the template and keep its header row.`,
        },
      ],
    };
  }

  for (let r = 1; r < grid.length; r += 1) {
    const cells = grid[r] ?? [];
    const line = r + 1;
    if (cells.every((c) => c === null || c === "")) continue;

    const value = rowReader(cells, mapping);

    const kindRaw = value("kind");
    const kind = kindRaw?.toLowerCase() as VocabKind | undefined;
    if (!kind || !VOCAB_KINDS.includes(kind)) {
      problems.push({
        line,
        message: `Kind must be one of ${VOCAB_KINDS.join(", ")}, not "${kindRaw ?? ""}"`,
      });
      continue;
    }

    const name = value("name");
    if (!name) {
      problems.push({ line, message: "Name is required" });
      continue;
    }

    const statusRaw = value("status");
    if (statusRaw && !["active", "inactive"].includes(statusRaw.toLowerCase())) {
      problems.push({ line, message: `Status must be "active" or "inactive", not "${statusRaw}"` });
      continue;
    }
    const status = statusRaw ? statusRaw.toLowerCase() : null;

    // Per-kind fields, validated only where they apply.
    let group: string | null = null;
    let terminal: boolean | null = null;
    let color: string | null = null;

    if (kind === "status") {
      const g = value("group");
      if (g) {
        if (!STATUS_GROUPS.includes(g.toLowerCase() as (typeof STATUS_GROUPS)[number])) {
          problems.push({
            line,
            message: `Group must be one of ${STATUS_GROUPS.join(", ")}, not "${g}"`,
          });
          continue;
        }
        group = g.toLowerCase();
      }
      const t = value("terminal");
      if (t) {
        const norm = t.toLowerCase();
        if (TRUE.has(norm)) terminal = true;
        else if (FALSE.has(norm)) terminal = false;
        else {
          problems.push({ line, message: `Terminal must be yes or no, not "${t}"` });
          continue;
        }
      }
    }

    if (kind === "tag") {
      const c = value("color");
      if (c) {
        if (!HEX.test(c)) {
          problems.push({ line, message: `Color must be a hex colour like #3b82f6, not "${c}"` });
          continue;
        }
        color = c;
      }
    }

    const needsDept = kind === "category" || kind === "tag";
    const department = value("department");
    if (needsDept && !department) {
      problems.push({ line, message: `A ${kind} needs a Department` });
      continue;
    }

    rows.push({
      line,
      kind,
      department: needsDept ? department : null,
      name,
      group,
      terminal,
      color,
      description: value("description"),
      status,
    });
  }

  return { rows, problems };
}

export function parseCsv(text: string): VocabParseResult {
  return fromGrid(gridFromCsv(text));
}

export async function parseXlsx(buffer: Buffer): Promise<VocabParseResult> {
  return fromGrid(await gridFromXlsx(buffer, COLUMNS.length));
}

export interface VocabExportRow {
  kind: VocabKind;
  department: string | null;
  name: string;
  group: string | null;
  terminal: boolean | null;
  color: string | null;
  description: string | null;
  status: string;
}

const HEADER_LABELS = COLUMNS.map((c) => HEADERS[c]);

function toCells(r: VocabExportRow): (string | number | null)[] {
  return [
    r.kind,
    r.department,
    r.name,
    r.group,
    r.terminal === null ? null : r.terminal ? "yes" : "no",
    r.color,
    r.description,
    r.status,
  ];
}

/** The downloadable template: the header row plus one illustrative row of each kind. */
export async function buildTemplate(): Promise<Buffer> {
  const rows: VocabExportRow[] = [
    {
      kind: "severity",
      department: null,
      name: "Critical",
      group: null,
      terminal: null,
      color: null,
      description: null,
      status: "active",
    },
    {
      kind: "status",
      department: null,
      name: "Open",
      group: "open",
      terminal: false,
      color: null,
      description: null,
      status: "active",
    },
    {
      kind: "category",
      department: "Maintenance",
      name: "Breakdown",
      group: null,
      terminal: null,
      color: null,
      description: "Unplanned stoppage",
      status: "active",
    },
    {
      kind: "tag",
      department: "Maintenance",
      name: "electrical",
      group: null,
      terminal: null,
      color: "#3b82f6",
      description: null,
      status: "active",
    },
  ];
  return buildWorkbook("Journal vocabulary", HEADER_LABELS, rows.map(toCells));
}

/** Export the vocabulary — one row per term, grouped by kind. */
export async function buildExport(rows: VocabExportRow[]): Promise<Buffer> {
  return buildWorkbook("Journal vocabulary", HEADER_LABELS, rows.map(toCells));
}
