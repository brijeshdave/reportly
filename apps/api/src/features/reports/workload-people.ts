// Author: Brijesh Dave <https://github.com/brijeshdave>
// Who the workload reports are about, and how their rows are grouped.
//
// The set of people is the reader plus their downline, which is the same rule the
// journal enforces: the reporting line decides who may read whose work. A superadmin
// gets everybody in the company, because they have nothing to be narrowed from.
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  departmentUsers,
  departments,
  designations,
  locations,
  userLocations,
  users,
} from "@/core/db/schema.js";
import { downlineUserIds } from "@/features/journal/hierarchy.js";
import type { AuthContext } from "@reportly/shared";

export interface WorkloadPerson {
  userId: string;
  name: string;
  designation: string | null;
  departmentNames: string[];
  /** Every site they are placed at. A person may work at more than one. */
  locationNames: string[];
}

/**
 * The people a reader may account for.
 *
 * Everyone holding a department membership in the company, narrowed to the reader
 * and their downline. Somebody with no membership at all is not here — they are
 * not in anybody's department, so there is no department report they belong on.
 */
export async function peopleInScope(
  ctx: AuthContext,
  companyId: string,
): Promise<WorkloadPerson[]> {
  const rows = await db
    .select({
      userId: departmentUsers.userId,
      name: users.name,
      designation: designations.name,
      departmentName: departments.name,
    })
    .from(departmentUsers)
    .innerJoin(departments, eq(departments.id, departmentUsers.departmentId))
    .innerJoin(users, eq(users.id, departmentUsers.userId))
    .leftJoin(designations, eq(designations.id, users.designationId))
    .where(eq(departments.companyId, companyId))
    .orderBy(users.name);

  const allowed = ctx.isSuperadmin
    ? null
    : new Set([ctx.userId, ...(await downlineUserIds(ctx.userId))]);

  const byUser = new Map<string, WorkloadPerson>();
  for (const row of rows) {
    if (allowed && !allowed.has(row.userId)) continue;
    const existing = byUser.get(row.userId);
    if (existing) {
      if (!existing.departmentNames.includes(row.departmentName)) {
        existing.departmentNames.push(row.departmentName);
      }
      continue;
    }
    byUser.set(row.userId, {
      userId: row.userId,
      name: row.name,
      designation: row.designation,
      departmentNames: [row.departmentName],
      locationNames: [],
    });
  }

  const ids = [...byUser.keys()];
  if (ids.length > 0) {
    const sites = await db
      .select({ userId: userLocations.userId, name: locations.name })
      .from(userLocations)
      .innerJoin(locations, eq(locations.id, userLocations.locationId))
      .where(and(inArray(userLocations.userId, ids), eq(locations.companyId, companyId)))
      .orderBy(locations.name);
    for (const site of sites) byUser.get(site.userId)?.locationNames.push(site.name);
  }

  return [...byUser.values()];
}

/**
 * The group a person's row belongs in.
 *
 * Site and department are both many-per-person, and a person cannot be counted
 * twice without the totals becoming nonsense — so somebody spread across several
 * lands in "Several sites" rather than appearing under each. That is a real answer:
 * their work is not attributable to one plant, and a report that pretended
 * otherwise would put the same entries in two columns of the same total.
 */
export function groupLabelFor(person: WorkloadPerson, grouping: string): string {
  if (grouping === "designation") return person.designation ?? "No designation";
  if (grouping === "location") {
    if (person.locationNames.length === 0) return "No site";
    return person.locationNames.length === 1 ? person.locationNames[0]! : "Several sites";
  }
  if (grouping === "department") {
    if (person.departmentNames.length === 0) return "No department";
    return person.departmentNames.length === 1 ? person.departmentNames[0]! : "Several departments";
  }
  return "";
}
