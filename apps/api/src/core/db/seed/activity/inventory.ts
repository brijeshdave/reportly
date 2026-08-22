// Author: Brijesh Dave <https://github.com/brijeshdave>
// What the master data already in this database can support.
//
// The read half of `cli seed:activity`, and deliberately its own step: before a
// single row is written it says, per department, what it found and what it therefore
// cannot generate. A department with nobody in it cannot file anything; one with no
// devices cannot have downtime; one with no shifts cannot have a rota. Discovering
// that from an empty report afterwards is how an afternoon goes missing.
//
// Reads only. Nothing in this file writes.
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  assets,
  categories,
  companies,
  departmentUserLocations,
  departmentUsers,
  departments,
  deviceTypes,
  devices,
  journalStatuses,
  locations,
  routineAssignees,
  routines,
  severities,
  shifts,
  users,
} from "@/core/db/schema.js";

export interface DepartmentInventory {
  id: string;
  name: string;
  /** Null for the department's central rota. */
  locationId: string | null;
  locationName: string | null;
  members: { userId: string; name: string; rank: string; reportsToId: string | null }[];
  deviceIds: string[];
  assetIds: string[];
  categoryIds: string[];
  routines: { id: string; assigneeIds: string[] }[];
  /** Why a domain will be skipped for this department, in words. */
  skips: string[];
}

export interface CompanyInventory {
  id: string;
  name: string;
  severityIds: string[];
  statuses: { open: string | null; resolved: string | null; all: string[] };
  shiftIds: { id: string; code: string }[];
  departments: DepartmentInventory[];
}

/**
 * The statuses that matter to a generated history: something to start in and
 * something to finish in. Matched by group rather than by name so a company that
 * renamed "Resolved" to "Closed" still works.
 */
async function statusesFor() {
  // Severities and statuses are installation-wide, not per company: they say what the
  // words mean, and two companies disagreeing about "Critical" would make every
  // cross-company report meaningless.
  const rows = await db
    .select({ id: journalStatuses.id, name: journalStatuses.name, group: journalStatuses.group })
    .from(journalStatuses);
  return {
    open: rows.find((r) => r.group === "open")?.id ?? null,
    resolved: rows.find((r) => r.group === "resolved")?.id ?? null,
    all: rows.map((r) => r.id),
  };
}

/** Every company with its departments, people and the things they work on. */
export async function takeInventory(companyIds?: string[]): Promise<CompanyInventory[]> {
  const companyRows = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(companyIds?.length ? inArray(companies.id, companyIds) : undefined);

  const out: CompanyInventory[] = [];

  for (const company of companyRows) {
    const [severityRows, shiftRows, deptRows, statuses] = await Promise.all([
      db.select({ id: severities.id }).from(severities).where(eq(severities.status, "active")),
      db
        .select({ id: shifts.id, code: shifts.code })
        .from(shifts)
        .where(and(eq(shifts.companyId, company.id), eq(shifts.status, "active"))),
      db
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(eq(departments.companyId, company.id)),
      statusesFor(),
    ]);

    const deptInventories: DepartmentInventory[] = [];

    for (const dept of deptRows) {
      const members = await db
        .select({
          userId: departmentUsers.userId,
          name: users.name,
          rank: departmentUsers.rank,
          reportsToId: departmentUsers.reportsToId,
        })
        .from(departmentUsers)
        .innerJoin(users, eq(users.id, departmentUsers.userId))
        .where(and(eq(departmentUsers.departmentId, dept.id), eq(users.status, "active")));

      // A department's sites come from its people. No site rows means the central
      // rota, which is a real answer rather than an absence.
      const siteRows = await db
        .selectDistinct({ id: locations.id, name: locations.name })
        .from(departmentUserLocations)
        .innerJoin(locations, eq(locations.id, departmentUserLocations.locationId))
        .where(eq(departmentUserLocations.departmentId, dept.id));

      const [deviceRows, assetRows, categoryRows, routineRows] = await Promise.all([
        db
          .select({ id: devices.id })
          .from(devices)
          .innerJoin(deviceTypes, eq(deviceTypes.id, devices.typeId))
          .where(
            and(
              eq(devices.companyId, company.id),
              eq(devices.status, "active"),
              or(eq(devices.departmentId, dept.id), isNull(devices.departmentId)),
            ),
          ),
        db
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.companyId, company.id), eq(assets.status, "active"))),
        db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.departmentId, dept.id), eq(categories.status, "active"))),
        db
          .select({ id: routines.id })
          .from(routines)
          .where(and(eq(routines.departmentId, dept.id), eq(routines.status, "active"))),
      ]);

      const routineIds = routineRows.map((r) => r.id);
      const assigneeRows = routineIds.length
        ? await db
            .select({ routineId: routineAssignees.routineId, userId: routineAssignees.userId })
            .from(routineAssignees)
            .where(inArray(routineAssignees.routineId, routineIds))
        : [];

      const skips: string[] = [];
      if (members.length === 0) skips.push("nobody in the department — nothing can be filed");
      if (deviceRows.length === 0) skips.push("no devices — no downtime or reliability");
      if (categoryRows.length === 0) skips.push("no categories — entries will have none");
      if (shiftRows.length === 0) skips.push("no active shifts — no rota");
      if (routineIds.length === 0) skips.push("no routines — no completions");

      deptInventories.push({
        id: dept.id,
        name: dept.name,
        locationId: siteRows[0]?.id ?? null,
        locationName: siteRows[0]?.name ?? null,
        members,
        deviceIds: deviceRows.map((d) => d.id),
        assetIds: assetRows.map((a) => a.id),
        categoryIds: categoryRows.map((c) => c.id),
        routines: routineIds.map((id) => ({
          id,
          assigneeIds: assigneeRows.filter((a) => a.routineId === id).map((a) => a.userId),
        })),
        skips,
      });
    }

    out.push({
      id: company.id,
      name: company.name,
      severityIds: severityRows.map((s) => s.id),
      statuses,
      shiftIds: shiftRows,
      departments: deptInventories,
    });
  }

  return out;
}

/** The inventory as the lines the command prints before it writes anything. */
export function describeInventory(inventory: CompanyInventory[]): string[] {
  const lines: string[] = [];
  for (const company of inventory) {
    lines.push(
      `${company.name}  (${company.shiftIds.length} shifts, ${company.severityIds.length} severities)`,
    );
    if (company.departments.length === 0) lines.push("    no departments — nothing to generate");
    for (const dept of company.departments) {
      const where = dept.locationName ? ` @ ${dept.locationName}` : " (central)";
      lines.push(
        `    ${dept.name}${where}: ${dept.members.length} people, ` +
          `${dept.deviceIds.length} devices, ${dept.routines.length} routines`,
      );
      for (const skip of dept.skips) lines.push(`        skipped: ${skip}`);
    }
  }
  return lines;
}
