// Author: Brijesh Dave <https://github.com/brijeshdave>
// The second line under a person's name in a picker.
//
// It is not decoration: `SearchableSelect` and `MultiSelect` match the typed query
// against the label **and the hint**, so whatever goes here is also what the picker
// can be searched by. Asked for in as many words — "should be searchable by employee
// code and full name" — and the answer is to put the code where it is both readable
// and matchable, rather than adding a second, invisible search field nobody can see
// the effect of.
/** Between two different kinds of fact — a staff number and a department. */
const SEPARATOR = " · ";

/** "EMP-1042 · Engineering", dropping whichever part the person does not have. */
export function personHint(person: {
  employeeId?: string | null;
  departmentNames?: string[];
}): string | undefined {
  const parts = [person.employeeId ?? "", (person.departmentNames ?? []).join(", ")].filter(
    (part) => part !== "",
  );
  return parts.length > 0 ? parts.join(SEPARATOR) : undefined;
}
