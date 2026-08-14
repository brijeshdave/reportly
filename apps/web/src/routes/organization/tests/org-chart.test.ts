// Author: Brijesh Dave <https://github.com/brijeshdave>
// The chart is assembled from the same reporting edges that decide who may see
// whose reports, so what it draws has to be exactly what those edges say.
import type { OrgChartNode } from "@reportly/shared";
import { describe, expect, it } from "vitest";

import { orgToCsv } from "@/routes/organization/export-org.js";
import { buildForest, subtreeOf } from "@/routes/organization/org-chart.js";

function node(over: Partial<OrgChartNode> & { userId: string }): OrgChartNode {
  const departmentId = over.departmentId ?? "11111111-1111-1111-1111-111111111111";
  return {
    id: `${departmentId}:${over.userId}`,
    name: over.name ?? over.userId,
    email: `${over.userId}@x.test`,
    designation: null,
    avatarVersion: null,
    status: "active",
    rank: "member",
    departmentId,
    departmentName: "Engineering",
    reportsToId: null,
    locationIds: [],
    ...over,
  } as OrgChartNode;
}

const ENG = "11111111-1111-1111-1111-111111111111";
const MGMT = "22222222-2222-2222-2222-222222222222";

describe("buildForest", () => {
  it("hangs each person under the manager they report to", () => {
    const forest = buildForest([
      node({ userId: "boss", rank: "hod" }),
      node({ userId: "lead", rank: "lead", reportsToId: "boss" }),
      node({ userId: "junior", reportsToId: "lead" }),
    ]);

    expect(forest).toHaveLength(1);
    expect(forest[0]!.userId).toBe("boss");
    expect(forest[0]!.children[0]!.userId).toBe("lead");
    expect(forest[0]!.children[0]!.children[0]!.userId).toBe("junior");
  });

  it("counts everyone below, not just the direct reports", () => {
    const forest = buildForest([
      node({ userId: "boss" }),
      node({ userId: "lead", reportsToId: "boss" }),
      node({ userId: "a", reportsToId: "lead" }),
      node({ userId: "b", reportsToId: "lead" }),
    ]);
    expect(forest[0]!.descendants).toBe(3);
    expect(forest[0]!.children[0]!.descendants).toBe(2);
  });

  it("attaches a manager across departments to their own department's node", () => {
    // The Head of Engineering reports to the boss, who sits in Management. The HOD
    // must hang under the boss's *Management* node — that is where the boss is.
    const forest = buildForest([
      node({ userId: "boss", departmentId: MGMT, departmentName: "Management", rank: "hod" }),
      node({ userId: "hod", departmentId: ENG, rank: "hod", reportsToId: "boss" }),
    ]);

    expect(forest).toHaveLength(1);
    expect(forest[0]!.departmentId).toBe(MGMT);
    expect(forest[0]!.children[0]!.userId).toBe("hod");
    expect(forest[0]!.children[0]!.departmentId).toBe(ENG);
  });

  it("prefers the manager's membership in the same department", () => {
    // The boss is in both departments. A lead in Engineering must sit under the
    // boss's Engineering node, not their Management one — otherwise the picture
    // would show a team reporting into a department it is not in.
    const forest = buildForest([
      node({ userId: "boss", departmentId: MGMT, departmentName: "Management" }),
      node({ userId: "boss", departmentId: ENG }),
      node({ userId: "lead", departmentId: ENG, reportsToId: "boss" }),
    ]);

    const engBoss = forest
      .flatMap((root) => [root, ...root.children])
      .find((n) => n.userId === "boss" && n.departmentId === ENG);
    expect(engBoss?.children.map((c) => c.userId)).toEqual(["lead"]);
  });

  it("draws a subtree whose manager was filtered away, rather than dropping it", () => {
    // Filtering to one department cuts the edge up to a manager outside it. Those
    // people must still appear — as roots — or a filter would quietly hide staff.
    const forest = buildForest([node({ userId: "hod", departmentId: ENG, reportsToId: "boss" })]);

    expect(forest).toHaveLength(1);
    expect(forest[0]!.userId).toBe("hod");
  });
});

describe("subtreeOf", () => {
  it("keeps a person and everyone beneath them, and nobody else", () => {
    const nodes = [
      node({ userId: "boss" }),
      node({ userId: "hod", reportsToId: "boss" }),
      node({ userId: "lead", reportsToId: "hod" }),
      node({ userId: "junior", reportsToId: "lead" }),
      node({ userId: "elsewhere", reportsToId: "boss" }),
    ];

    const kept = subtreeOf(nodes, "hod")
      .map((n) => n.userId)
      .sort();
    expect(kept).toEqual(["hod", "junior", "lead"]);
  });
});

describe("orgToCsv", () => {
  it("writes one row per person, with their depth and their manager", () => {
    const forest = buildForest([
      node({ userId: "boss", name: "Meera Shah", rank: "hod" }),
      node({ userId: "lead", name: "Ravi Kumar", rank: "lead", reportsToId: "boss" }),
    ]);

    const lines = orgToCsv(forest).split("\n");
    expect(lines[0]).toContain('"Reports to"');
    expect(lines[1]).toContain('"Meera Shah"');
    expect(lines[2]).toContain('"Ravi Kumar"');
    // Ravi is one level down, and reports to Meera.
    expect(lines[2]).toContain('"Meera Shah","2"');
  });

  it("escapes a name that contains a quote, rather than breaking the row", () => {
    const forest = buildForest([node({ userId: "x", name: 'Ann "AJ" Jones' })]);
    expect(orgToCsv(forest)).toContain('"Ann ""AJ"" Jones"');
  });
});
