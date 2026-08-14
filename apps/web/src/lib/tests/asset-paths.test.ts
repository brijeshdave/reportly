// Author: Brijesh Dave <https://github.com/brijeshdave>
// The point of these paths is telling identically-named assets apart, so that is
// what the tests are about.
import type { AssetNode } from "@reportly/shared";
import { describe, expect, it } from "vitest";

import {
  assetOptions,
  assetsAtSite,
  childrenOf,
  effectiveLocationId,
  matchesSearch,
  selectLabel,
} from "@/lib/asset-paths.js";

const asset = (over: Partial<AssetNode> & { id: string; name: string }): AssetNode => ({
  companyId: "c1",
  parentId: null,
  typeId: null,
  typeName: null,
  locationId: null,
  locationName: null,
  status: "active",
  deviceCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

/** Two plants, each with an identically-named line and station. */
const twoPlants: AssetNode[] = [
  asset({ id: "a", name: "Plant A" }),
  asset({ id: "b", name: "Plant B" }),
  asset({ id: "a-l", name: "Line 3", parentId: "a" }),
  asset({ id: "b-l", name: "Line 3", parentId: "b" }),
  asset({ id: "a-s", name: "Station A", parentId: "a-l" }),
  asset({ id: "b-s", name: "Station A", parentId: "b-l" }),
];

describe("assetOptions", () => {
  it("gives identically-named assets different paths", () => {
    // The whole reason this module exists: two "Station A"s that a picker
    // previously showed as the same string.
    const options = assetOptions(twoPlants);
    const stations = options.filter((o) => o.name === "Station A");

    expect(stations).toHaveLength(2);
    expect(stations.map((s) => s.path)).toEqual([
      "Plant A › Line 3 › Station A",
      "Plant B › Line 3 › Station A",
    ]);
  });

  it("records depth for indenting", () => {
    const byId = new Map(assetOptions(twoPlants).map((o) => [o.id, o]));
    expect(byId.get("a")!.depth).toBe(0);
    expect(byId.get("a-l")!.depth).toBe(1);
    expect(byId.get("a-s")!.depth).toBe(2);
  });

  it("orders each parent immediately before its own children", () => {
    // A flat list that still reads as a tree, and the same order the tree view
    // shows — so the picker and the tree never disagree about where a thing sits.
    expect(assetOptions(twoPlants).map((o) => o.path)).toEqual([
      "Plant A",
      "Plant A › Line 3",
      "Plant A › Line 3 › Station A",
      "Plant B",
      "Plant B › Line 3",
      "Plant B › Line 3 › Station A",
    ]);
  });

  it("survives a parent cycle instead of hanging", () => {
    // `parentId` is user-editable and set-null on delete, so a loop is reachable
    // by mistake. The page must not spin: a wrong-but-visible path beats a freeze.
    const cyclic: AssetNode[] = [
      asset({ id: "x", name: "X", parentId: "y" }),
      asset({ id: "y", name: "Y", parentId: "x" }),
    ];
    const options = assetOptions(cyclic);
    expect(options).toHaveLength(2);
    expect(options.every((o) => o.path.length > 0)).toBe(true);
  });

  it("treats an asset whose parent is missing as a root", () => {
    // Set-null on delete means a child can outlive its parent between reads.
    const orphan = [asset({ id: "o", name: "Orphan", parentId: "gone" })];
    expect(assetOptions(orphan)[0]!.path).toBe("Orphan");
  });
});

describe("selectLabel", () => {
  it("shows the whole path so no two labels can collide", () => {
    const byId = new Map(assetOptions(twoPlants).map((o) => [o.id, o]));
    expect(selectLabel(byId.get("a-s")!)).toBe("Plant A › Line 3 › Station A");
    expect(selectLabel(byId.get("a")!)).toBe("Plant A");
  });

  it("stays unambiguous when the parent name repeats too", () => {
    // The case that rules out "name + its parent" as the label. Both stations sit
    // under a "Line 1", so naming only the parent would print the same string
    // twice — the original bug, one level further up the tree.
    const repeated = assetOptions([
      asset({ id: "p1", name: "Plant A" }),
      asset({ id: "p2", name: "Plant B" }),
      asset({ id: "l1", name: "Line 1", parentId: "p1" }),
      asset({ id: "l2", name: "Line 1", parentId: "p2" }),
      asset({ id: "s1", name: "Final EL", parentId: "l1" }),
      asset({ id: "s2", name: "Final EL", parentId: "l2" }),
    ]);
    const labels = repeated.filter((o) => o.name === "Final EL").map(selectLabel);
    expect(new Set(labels).size).toBe(2);
    expect(labels).toEqual(["Plant A › Line 1 › Final EL", "Plant B › Line 1 › Final EL"]);
  });

  it("includes the type when there is one", () => {
    const typed = assetOptions([asset({ id: "t", name: "Line 3", typeName: "Line" })]);
    expect(selectLabel(typed[0]!)).toBe("Line 3 — Line");
  });
});

describe("matchesSearch", () => {
  const options = assetOptions(twoPlants);
  const find = (needle: string) =>
    options.filter((o) => matchesSearch(o, needle)).map((o) => o.path);

  it("matches on any part of the path, not just the leaf", () => {
    // Typing a plant narrows to everything inside it — which is what makes the
    // path worth showing rather than decorative.
    expect(find("plant a")).toEqual([
      "Plant A",
      "Plant A › Line 3",
      "Plant A › Line 3 › Station A",
    ]);
  });

  it("finds the same leaf across every branch", () => {
    expect(find("station")).toEqual([
      "Plant A › Line 3 › Station A",
      "Plant B › Line 3 › Station A",
    ]);
  });

  it("returns everything for an empty search", () => {
    expect(find("   ")).toHaveLength(6);
  });
});

describe("childrenOf", () => {
  it("returns the roots for a null parent", () => {
    expect(childrenOf(twoPlants, null).map((a) => a.name)).toEqual(["Plant A", "Plant B"]);
  });

  it("returns only the direct children, not descendants", () => {
    // The point of level-by-level picking: each step shows a short list, however
    // large the tree is underneath.
    expect(childrenOf(twoPlants, "a").map((a) => a.name)).toEqual(["Line 3"]);
    expect(childrenOf(twoPlants, "a-l").map((a) => a.name)).toEqual(["Station A"]);
    expect(childrenOf(twoPlants, "a-s")).toEqual([]);
  });
});

describe("assetsAtSite", () => {
  // A plant placed at site-1 with an unplaced line + station beneath it (they inherit),
  // a plant at site-2, and a plant placed nowhere.
  const assets: AssetNode[] = [
    asset({ id: "p1", name: "Plant 1", locationId: "site-1" }),
    asset({ id: "p1-l", name: "Line", parentId: "p1", locationId: null }),
    asset({ id: "p1-s", name: "Station", parentId: "p1-l", locationId: null }),
    asset({ id: "p2", name: "Plant 2", locationId: "site-2" }),
    asset({ id: "u", name: "Unplaced plant", locationId: null }),
  ];

  it("returns everything when no site is chosen", () => {
    expect(assetsAtSite(assets, null)).toHaveLength(5);
  });

  it("keeps a site's whole subtree by inheritance, dropping other sites and unplaced ones", () => {
    expect(assetsAtSite(assets, "site-1").map((a) => a.id)).toEqual(["p1", "p1-l", "p1-s"]);
    expect(assetsAtSite(assets, "site-2").map((a) => a.id)).toEqual(["p2"]);
  });

  it("resolves an asset's effective site from the nearest placed ancestor", () => {
    expect(effectiveLocationId(assets, "p1-s")).toBe("site-1");
    expect(effectiveLocationId(assets, "u")).toBeNull();
  });
});
