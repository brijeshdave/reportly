// Author: Brijesh Dave <https://github.com/brijeshdave>
// How the permission catalogue is organised for people rather than for the machine.
//
// The raw list is ~two dozen `resource:action` strings. Shown flat it is a wall of
// checkboxes nobody reads. Grouped the way the **sidebar** is grouped, it answers the
// question an admin actually has — "what may this role do in Work / in Reports / in
// System" — because that is the map of the product they already have in their head.
//
// Anything not mapped falls into "Other" rather than disappearing: a permission added
// later must show up somewhere, even before someone files it under a heading.
import { ALL_PERMISSIONS, type Permission } from "@reportly/shared";

export const resourceOf = (permission: Permission): string =>
  permission.split(":")[0] ?? permission;
export const actionOf = (permission: Permission): string => permission.split(":")[1] ?? permission;

/** Groups in sidebar order; each lists the permission resources it owns. */
const GROUP_DEFS: { id: string; label: string; resources: string[] }[] = [
  {
    id: "work",
    label: "Work",
    resources: ["journal", "tasks", "downtime", "comments", "attachments", "analytics"],
  },
  { id: "reports", label: "Reports", resources: ["reports", "leaderboard"] },
  { id: "scheduling", label: "Scheduling", resources: ["shifts"] },
  { id: "routines", label: "Routines", resources: ["routines"] },
  { id: "assets", label: "Assets", resources: ["assets", "devices"] },
  {
    id: "organisation",
    label: "Organisation",
    resources: ["companies", "locations", "departments"],
  },
  {
    id: "people",
    label: "People & access",
    resources: ["users", "designations", "groups", "roles"],
  },
  {
    id: "system",
    label: "System",
    resources: [
      "journal-config",
      "categories",
      "tags",
      "device-types",
      "settings",
      "debug",
      "audit",
      "logs",
    ],
  },
];

/** Prettier headings than the raw resource slug where the slug reads badly. */
const RESOURCE_LABELS: Record<string, string> = {
  "journal-config": "Journal setup",
  "device-types": "Device types",
  sso: "Single sign-on",
};

export function resourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource] ?? resource.replace(/-/g, " ");
}

export interface PermissionGroup {
  id: string;
  label: string;
  /** Resource blocks, in the order the group declares them. */
  resources: { resource: string; permissions: Permission[] }[];
  /** Every permission in the group, for counting and select-all. */
  permissions: Permission[];
}

/**
 * The catalogue arranged into groups. Built once from ALL_PERMISSIONS, so a new
 * permission appears without touching this file — under its group if the resource is
 * mapped, under "Other" if not. Empty groups are dropped.
 */
export const PERMISSION_GROUPS: PermissionGroup[] = (() => {
  const byResource = new Map<string, Permission[]>();
  for (const permission of ALL_PERMISSIONS) {
    const list = byResource.get(resourceOf(permission)) ?? [];
    list.push(permission);
    byResource.set(resourceOf(permission), list);
  }

  const claimed = new Set<string>();
  const groups: PermissionGroup[] = [];

  for (const def of GROUP_DEFS) {
    const resources: PermissionGroup["resources"] = [];
    for (const resource of def.resources) {
      const permissions = byResource.get(resource);
      if (!permissions || permissions.length === 0) continue;
      claimed.add(resource);
      resources.push({ resource, permissions });
    }
    if (resources.length > 0) {
      groups.push({
        id: def.id,
        label: def.label,
        resources,
        permissions: resources.flatMap((r) => r.permissions),
      });
    }
  }

  // Whatever nobody claimed — so nothing is ever silently missing from the editor.
  const leftovers = [...byResource.entries()]
    .filter(([resource]) => !claimed.has(resource))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resource, permissions]) => ({ resource, permissions }));
  if (leftovers.length > 0) {
    groups.push({
      id: "other",
      label: "Other",
      resources: leftovers,
      permissions: leftovers.flatMap((r) => r.permissions),
    });
  }

  return groups;
})();
