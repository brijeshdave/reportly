// Author: Brijesh Dave <https://github.com/brijeshdave>
// The permission catalogue is shown grouped by product area. The grouping is a
// presentation choice, so the one thing that must never break is completeness: a
// permission that falls out of the grouping is a permission nobody can grant.
import { ALL_PERMISSIONS } from "@reportly/shared";
import { describe, expect, it } from "vitest";

import { PERMISSION_GROUPS, actionOf, resourceOf } from "@/routes/roles/permission-groups.js";

describe("PERMISSION_GROUPS", () => {
  it("shows every permission exactly once", () => {
    const shown = PERMISSION_GROUPS.flatMap((group) => group.permissions);
    expect([...shown].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(new Set(shown).size).toBe(shown.length);
  });

  it("puts an unmapped resource in Other rather than dropping it", () => {
    // Every resource in the catalogue is reachable from some group.
    const grouped = new Set(PERMISSION_GROUPS.flatMap((g) => g.resources.map((r) => r.resource)));
    for (const permission of ALL_PERMISSIONS) {
      expect(grouped.has(resourceOf(permission))).toBe(true);
    }
  });

  it("leads with the areas the sidebar leads with", () => {
    expect(PERMISSION_GROUPS.map((g) => g.label).slice(0, 5)).toEqual([
      "Work",
      "Reports",
      "Scheduling",
      "Routines",
      "Assets",
    ]);
  });

  it("splits a permission into its resource and action", () => {
    expect(resourceOf("journal:read")).toBe("journal");
    expect(actionOf("journal:read")).toBe("read");
  });
});
