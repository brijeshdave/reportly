// Author: Brijesh Dave <https://github.com/brijeshdave>
// The organisation chart: the reporting line, drawn.
//
// It is assembled from exactly the same `reportsToId` edges the downline walk uses
// on the server. That is the point of drawing it — the picture and the permission
// must never be able to tell different stories, so if this chart looks wrong, the
// access it implies is wrong too, and you can see that before anyone is let in.
//
// A person who belongs to two departments appears twice, because they genuinely
// occupy two places in the organisation and collapsing that would hide one of them.
import { type OrgChartNode } from "@reportly/shared";

/** A node with its children resolved — what the chart actually draws. */
export interface ChartNode extends OrgChartNode {
  children: ChartNode[];
  /** Everyone beneath, at any depth. Shown on a collapsed node. */
  descendants: number;
}

/**
 * Which node a person hangs under.
 *
 * `reportsToId` names a *person*, but a person may hold several memberships, so it
 * does not by itself name a *node*. Prefer the manager's membership in the same
 * department — a team lead sits under their own HOD — and otherwise take any of
 * them, which is what puts a Head of Department under the boss over in Management.
 */
function parentOf(node: OrgChartNode, byUser: Map<string, OrgChartNode[]>): string | null {
  if (!node.reportsToId) return null;

  const memberships = byUser.get(node.reportsToId);
  if (!memberships || memberships.length === 0) return null;

  const sameDepartment = memberships.find((m) => m.departmentId === node.departmentId);
  return (sameDepartment ?? memberships[0]!).id;
}

/**
 * Assemble the forest. Roots are the people nobody manages — and, once a filter has
 * narrowed the set, the people whose manager fell outside it: a subtree with its top
 * cut off must still be drawn, not silently dropped.
 */
export function buildForest(nodes: OrgChartNode[]): ChartNode[] {
  const byUser = new Map<string, OrgChartNode[]>();
  for (const node of nodes) {
    byUser.set(node.userId, [...(byUser.get(node.userId) ?? []), node]);
  }

  const chart = new Map<string, ChartNode>(
    nodes.map((node) => [node.id, { ...node, children: [], descendants: 0 }]),
  );

  const roots: ChartNode[] = [];
  for (const node of chart.values()) {
    const parentId = parentOf(node, byUser);
    const parent = parentId ? chart.get(parentId) : undefined;
    // A cycle cannot reach here — the API refuses one — but a node must never be
    // made its own parent by a filtered-set edge case either.
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  const count = (node: ChartNode): number => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.descendants = node.children.reduce((sum, child) => sum + 1 + count(child), 0);
    return node.descendants;
  };
  for (const root of roots) count(root);

  roots.sort((a, b) => b.descendants - a.descendants || a.name.localeCompare(b.name));
  return roots;
}

/** Every node id beneath `userId`, inclusive — used to focus on one person. */
export function subtreeOf(nodes: OrgChartNode[], userId: string): OrgChartNode[] {
  const byManager = new Map<string, OrgChartNode[]>();
  for (const node of nodes) {
    if (!node.reportsToId) continue;
    byManager.set(node.reportsToId, [...(byManager.get(node.reportsToId) ?? []), node]);
  }

  const kept = new Map<string, OrgChartNode>();
  const queue = nodes.filter((node) => node.userId === userId);
  for (const node of queue) kept.set(node.id, node);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of byManager.get(current.userId) ?? []) {
      if (kept.has(child.id)) continue;
      kept.set(child.id, child);
      queue.push(child);
    }
  }
  return [...kept.values()];
}
