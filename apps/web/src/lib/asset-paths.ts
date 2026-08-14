// Author: Brijesh Dave <https://github.com/brijeshdave>
// Turning the flat asset list into something a person can pick from.
//
// The problem this exists to solve: asset names repeat. Every plant has a
// "Station A", and a picker showing three of them offers no way to tell which is
// which — you choose one and hope. The tree already knows the answer; it just was
// not being shown.
//
// Pure, so the ordering and path rules are testable without a browser.
import type { AssetNode } from "@reportly/shared";

/** The separator between path segments. `›` reads as a path and is not a
 *  character anybody types into an asset name, so it never looks like part of one. */
export const PATH_SEPARATOR = " › ";

export interface AssetOption {
  id: string;
  /** Just this asset's own name — what to show when space is tight. */
  name: string;
  /** The full path from the root, e.g. `Plant A › Line 3 › Station A`. */
  path: string;
  /** How deep it sits, for indenting a flat `<select>`. */
  depth: number;
  typeName: string | null;
  status: string;
}

/**
 * Resolve every asset's ancestor path and return them in tree order — a parent
 * immediately followed by its children — so a flat list still reads as a tree.
 *
 * Cycles are survivable rather than fatal: `parentId` is user-editable and
 * set-null on delete, so a loop is reachable by mistake. A cycle stops the walk
 * and the asset keeps whatever path was resolved, which is wrong but visible,
 * rather than hanging the page.
 */
export function assetOptions(assets: AssetNode[]): AssetOption[] {
  const byId = new Map(assets.map((a) => [a.id, a]));

  const pathOf = (asset: AssetNode): { path: string; depth: number } => {
    const segments = [asset.name];
    const seen = new Set([asset.id]);
    let current = asset.parentId ? byId.get(asset.parentId) : undefined;

    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      segments.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }

    return { path: segments.join(PATH_SEPARATOR), depth: segments.length - 1 };
  };

  const options = assets.map((asset) => {
    const { path, depth } = pathOf(asset);
    return {
      id: asset.id,
      name: asset.name,
      path,
      depth,
      typeName: asset.typeName,
      status: asset.status,
    };
  });

  // Sorting by the full path puts each parent immediately before its children and
  // groups siblings alphabetically — the same order the tree view shows, so the
  // picker and the tree do not disagree about where something sits.
  return options.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * A label for a `<select>`, where markup cannot indent.
 *
 * It shows the **whole path**, not the name with its parent appended. Naming only
 * the immediate parent is tempting — it is shorter and usually enough — but it is
 * only *usually* enough, and that is the same bug one level up: a plant with
 * "Line 1 › Final EL" and a second plant with "Line 1 › Final EL" would produce
 * two identical labels again, distinguishable only by hovering. A label that is
 * unambiguous by construction cannot regress the moment somebody reuses a name.
 *
 * Real data made the case: this deployment has twelve assets called "Final EL".
 *
 * The path already conveys depth, so there is no indent to collapse — which also
 * sidesteps browsers eating leading whitespace in an <option>.
 */
export function selectLabel(option: AssetOption): string {
  return option.typeName ? `${option.path} — ${option.typeName}` : option.path;
}

/**
 * The direct children of an asset — `null` for the roots.
 *
 * The building block of level-by-level picking: each step offers only what sits
 * inside the previous choice, so the list stays short however big the tree gets.
 */
export function childrenOf(assets: AssetNode[], parentId: string | null): AssetNode[] {
  return assets
    .filter((a) => (a.parentId ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * An asset's site: its own if set, otherwise inherited from the nearest ancestor that
 * has one — so placing a line or plant covers everything beneath it without setting the
 * site on every station. Null when nothing up the chain is placed. Cycle-guarded, since
 * `parentId` is user-editable.
 */
export function effectiveLocationId(assets: AssetNode[], id: string): string | null {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    if (current.locationId) return current.locationId;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

/**
 * The assets a report at `locationId` may be tagged to: those whose effective site is that
 * one. Strict — an asset placed at another site, or not placed anywhere, is left out, so
 * the picker only ever offers what actually stands at the chosen site. A null `locationId`
 * (no site chosen) returns the whole list unchanged.
 */
export function assetsAtSite(assets: AssetNode[], locationId: string | null): AssetNode[] {
  if (!locationId) return assets;
  return assets.filter((a) => effectiveLocationId(assets, a.id) === locationId);
}

/**
 * Does this asset match what somebody typed?
 *
 * Matched against the **whole path**, so typing "plant a" narrows to everything in
 * Plant A, and typing "station" finds every station across every plant. Matching
 * only the leaf name would make the path decorative.
 */
export function matchesSearch(option: AssetOption, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  return option.path.toLowerCase().includes(needle);
}
