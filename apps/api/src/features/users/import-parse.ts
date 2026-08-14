// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reading an uploaded spreadsheet of people, and writing the roster back out.
//
// A user import is the one that touches real accounts, so it is deliberately conservative:
// it never carries a password. A new person is created as an invite (a set-password link is
// sent; they choose their own credential), and access is granted through the Groups they are
// placed in. This file decides only what the file says — email, profile, and the names of
// the groups and companies to place them in; the service resolves those names and applies it.
import {
  type RowProblem,
  buildWorkbook,
  gridFromCsv,
  gridFromXlsx,
  headerMapping,
  rowReader,
} from "@/core/spreadsheet/index.js";

/** Groups and companies are listed in one cell, separated by a pipe (or a semicolon). */
export const USER_LIST_SEPARATOR = " | ";

const COLUMNS = [
  "email",
  "name",
  "username",
  "employeeId",
  "designation",
  "mobile",
  "groups",
  "companies",
  "status",
] as const;
type Column = (typeof COLUMNS)[number];

const HEADERS: Record<Column, string> = {
  email: "Email",
  name: "Name",
  username: "Username",
  employeeId: "Employee ID",
  designation: "Designation",
  mobile: "Mobile",
  groups: "Groups",
  companies: "Companies",
  status: "Status",
};

export interface ParsedUserRow {
  line: number;
  email: string;
  name: string;
  username: string | null;
  employeeId: string | null;
  designation: string | null;
  mobile: string | null;
  /** Group names, or null when the cell is blank (leave a person's groups unchanged). */
  groups: string[] | null;
  /** Company names, or null when the cell is blank (leave a person's companies unchanged). */
  companies: string[] | null;
  status: string | null;
}

export interface UserParseResult {
  rows: ParsedUserRow[];
  problems: RowProblem[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitList(cell: string): string[] {
  return cell
    .split(/[|;]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function fromGrid(grid: (string | null)[][]): UserParseResult {
  const problems: RowProblem[] = [];
  const rows: ParsedUserRow[] = [];

  const header = grid[0];
  if (!header) return { rows, problems: [{ line: 0, message: "The file is empty" }] };

  const mapping = headerMapping(header, COLUMNS, HEADERS);
  if (!mapping.includes("email")) {
    return {
      rows,
      problems: [
        {
          line: 1,
          message: `No "Email" column found. Download the template and keep its header row.`,
        },
      ],
    };
  }

  for (let r = 1; r < grid.length; r += 1) {
    const cells = grid[r] ?? [];
    const line = r + 1;
    if (cells.every((c) => c === null || c === "")) continue;

    const value = rowReader(cells, mapping);
    const email = value("email");
    if (!email) {
      problems.push({ line, message: "Email is required" });
      continue;
    }
    if (!EMAIL.test(email)) {
      problems.push({ line, message: `"${email}" is not a valid email` });
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

    const groupsCell = value("groups");
    const companiesCell = value("companies");
    const groupList = groupsCell ? splitList(groupsCell) : [];
    const companyList = companiesCell ? splitList(companiesCell) : [];

    rows.push({
      line,
      email: email.toLowerCase(),
      name,
      username: value("username"),
      employeeId: value("employeeId"),
      designation: value("designation"),
      mobile: value("mobile"),
      groups: groupList.length > 0 ? groupList : null,
      companies: companyList.length > 0 ? companyList : null,
      status: statusRaw ? statusRaw.toLowerCase() : null,
    });
  }

  return { rows, problems };
}

export function parseCsv(text: string): UserParseResult {
  return fromGrid(gridFromCsv(text));
}

export async function parseXlsx(buffer: Buffer): Promise<UserParseResult> {
  return fromGrid(await gridFromXlsx(buffer, COLUMNS.length));
}

export interface UserExportRow {
  email: string;
  name: string;
  username: string;
  employeeId: string | null;
  designation: string | null;
  mobile: string | null;
  groups: string[];
  companies: string[];
  status: string;
}

const HEADER_LABELS = COLUMNS.map((c) => HEADERS[c]);

function toCells(r: UserExportRow): (string | null)[] {
  return [
    r.email,
    r.name,
    r.username,
    r.employeeId,
    r.designation,
    r.mobile,
    r.groups.join(USER_LIST_SEPARATOR),
    r.companies.join(USER_LIST_SEPARATOR),
    r.status,
  ];
}

/** The downloadable template: the header row plus one illustrative person. */
export async function buildTemplate(): Promise<Buffer> {
  const example: UserExportRow = {
    email: "sam@acme.test",
    name: "Sam Rivera",
    username: "sam",
    employeeId: "E-1042",
    designation: "Technician",
    mobile: "",
    groups: ["Maintenance team"],
    companies: ["Acme"],
    status: "active",
  };
  return buildWorkbook("Users", HEADER_LABELS, [toCells(example)]);
}

/** Export the roster — one row per person, groups and companies joined. */
export async function buildExport(rows: UserExportRow[]): Promise<Buffer> {
  return buildWorkbook("Users", HEADER_LABELS, rows.map(toCells));
}
