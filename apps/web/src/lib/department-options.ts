// Author: Brijesh Dave <https://github.com/brijeshdave>
// Turning departments into something a person can pick from.
//
// The problem this exists to solve: a picker offering three identical-looking
// "Maintenance" rows gives you nothing to choose with. Two different things cause
// that, and they need different answers:
//
//   - Across companies. A name is unique *per company* (the DB says so), never
//     across them, so somebody in a "Maintenance" at two companies sees the name
//     twice. Only the company tells them apart — hence `companyName`, shown as the
//     option's second line wherever a list spans companies.
//   - Within one company. Names cannot repeat there, but a bare name still never
//     says *where* in the tree it sits. The ancestors do, and the tree already
//     knows them.
//
// Pure, so the labelling rules are testable without a browser.
import type { SelectOption } from "@/components/searchable-select.js";

/** Matches the separator the API builds paths with, and the asset picker's. */
export const DEPARTMENT_PATH_SEPARATOR = " › ";

/** Between two different kinds of fact — an ancestor trail and a company. */
const HINT_SEPARATOR = " · ";

export interface DepartmentChoice {
  value: string;
  name: string;
  /** The full path from the root, e.g. `Engineering › Backend`. */
  path: string;
  /** Set only when the list spans companies; it is noise when it cannot vary. */
  companyName?: string;
}

/** A department's ancestors — its path without its own name. Empty at the root. */
export function ancestorTrail(path: string, name: string): string {
  const segments = path.split(DEPARTMENT_PATH_SEPARATOR);
  // Defend against a path that does not end in the name (a cycle stopped the walk):
  // dropping the last segment blindly would eat a real ancestor.
  if (segments[segments.length - 1] !== name) return "";
  return segments.slice(0, -1).join(DEPARTMENT_PATH_SEPARATOR);
}

/**
 * Options for a department picker: the name to choose by, and underneath it the
 * things that tell two of the same name apart.
 */
export function departmentOptions(rows: DepartmentChoice[]): SelectOption[] {
  return rows.map((row) => {
    const hint = [ancestorTrail(row.path, row.name), row.companyName ?? ""]
      .filter((part) => part !== "")
      .join(HINT_SEPARATOR);
    return { value: row.value, label: row.name, ...(hint === "" ? {} : { hint }) };
  });
}
