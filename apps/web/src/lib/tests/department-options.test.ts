// Author: Brijesh Dave <https://github.com/brijeshdave>
// The point of these options is telling identically-named departments apart, so
// that is what the tests are about — the two ways a name repeats, and the one way
// it cannot.
import { describe, expect, it } from "vitest";

import { ancestorTrail, departmentOptions } from "@/lib/department-options.js";

describe("ancestorTrail", () => {
  it("is empty for a root department", () => {
    expect(ancestorTrail("Management", "Management")).toBe("");
  });

  it("is everything above the department itself", () => {
    expect(ancestorTrail("Engineering › Platform › Backend", "Backend")).toBe(
      "Engineering › Platform",
    );
  });

  // A cycle stops the server's walk mid-way, so the path can end somewhere other
  // than the department's own name. Dropping the last segment blindly would then
  // eat a real ancestor and claim a parent that is not one.
  it("keeps the whole path when it does not end in the name", () => {
    expect(ancestorTrail("Engineering › Platform", "Backend")).toBe("");
  });
});

describe("departmentOptions", () => {
  it("labels by name and puts the ancestors underneath", () => {
    expect(
      departmentOptions([{ value: "d1", name: "Backend", path: "Engineering › Backend" }]),
    ).toEqual([{ value: "d1", label: "Backend", hint: "Engineering" }]);
  });

  it("leaves a root department without a second line", () => {
    expect(departmentOptions([{ value: "d1", name: "IT", path: "IT" }])).toEqual([
      { value: "d1", label: "IT", hint: undefined },
    ]);
  });

  // The reported bug: two companies, one name, nothing to choose with.
  it("names the company when a list spans companies", () => {
    const options = departmentOptions([
      { value: "d1", name: "Maintenance", path: "Maintenance", companyName: "Rayzon Solar" },
      {
        value: "d2",
        name: "Maintenance",
        path: "Plant B › Maintenance",
        companyName: "Acme Power",
      },
    ]);

    expect(options.map((o) => o.hint)).toEqual(["Rayzon Solar", "Plant B · Acme Power"]);
    expect(new Set(options.map((o) => `${o.label}${o.hint}`)).size).toBe(2);
  });
});
