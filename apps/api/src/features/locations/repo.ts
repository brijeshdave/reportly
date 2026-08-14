// Author: Brijesh Dave <https://github.com/brijeshdave>
// Location repository — the only code touching the locations table. Every query
// is scoped to a company id so a caller can never reach another company's rows.
import { type SQL, and, eq } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { locations, userLocations, users } from "@/core/db/schema.js";

export interface LocationRow {
  id: string;
  companyId: string;
  name: string;
  isRemote: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A group whose scope names this location. */
export interface LocationReference {
  id: string;
  name: string;
}

/**
 * `scope` is the caller's location constraint from `withLocations()`, or undefined
 * when they may see every site. It is a required parameter, not an optional one,
 * so that adding a new read here is a conscious decision about scoping rather than
 * a silent omission — which is precisely how SF-004 went unnoticed for five phases.
 */
export async function listLocations(
  companyId: string,
  scope: SQL | undefined,
): Promise<LocationRow[]> {
  return db
    .select()
    .from(locations)
    .where(and(eq(locations.companyId, companyId), scope))
    .orderBy(locations.name);
}

export async function getLocation(
  id: string,
  companyId: string,
  scope: SQL | undefined,
): Promise<LocationRow | null> {
  const [row] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.id, id), eq(locations.companyId, companyId), scope));
  return row ?? null;
}

export async function insertLocation(companyId: string, name: string): Promise<LocationRow> {
  const [row] = await db.insert(locations).values({ companyId, name }).returning();
  return row!;
}

export async function updateLocationName(
  id: string,
  companyId: string,
  name: string,
): Promise<LocationRow | null> {
  const [row] = await db
    .update(locations)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(locations.id, id), eq(locations.companyId, companyId)))
    .returning();
  return row ?? null;
}

export async function updateLocationStatus(
  id: string,
  companyId: string,
  status: "active" | "inactive",
): Promise<LocationRow | null> {
  const [row] = await db
    .update(locations)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(locations.id, id), eq(locations.companyId, companyId)))
    .returning();
  return row ?? null;
}

/**
 * The people scoped to this location. `user_locations` cascades on delete, so
 * without this the rows would vanish silently and those people would quietly widen
 * to every site — the opposite of what a narrowing is for.
 */
export async function groupsReferencing(locationId: string): Promise<LocationReference[]> {
  return db
    .select({ id: users.id, name: users.name })
    .from(userLocations)
    .innerJoin(users, eq(users.id, userLocations.userId))
    .where(eq(userLocations.locationId, locationId))
    .orderBy(users.name);
}

/** Drops this location from everyone's scope. Only for an explicit cascade. */
export async function detachFromGroups(locationId: string): Promise<void> {
  await db.delete(userLocations).where(eq(userLocations.locationId, locationId));
}

export async function deleteLocationRow(id: string, companyId: string): Promise<void> {
  await db.delete(locations).where(and(eq(locations.id, id), eq(locations.companyId, companyId)));
}

/** Every location of a company (name + isRemote), for resolving an import against. */
export async function companyLocationsForImport(
  companyId: string,
): Promise<{ id: string; name: string; isRemote: boolean }[]> {
  return db
    .select({ id: locations.id, name: locations.name, isRemote: locations.isRemote })
    .from(locations)
    .where(eq(locations.companyId, companyId));
}

/** A resolved location import row: null status means "leave as is on update". */
export interface ResolvedLocationRow {
  name: string;
  status: string | null;
}

/**
 * Apply a location import in one transaction, keyed by name (unique per company). An
 * existing site has its status updated where the row gives one; a new name is inserted.
 * All-or-nothing: a failure rolls the whole import back.
 */
export async function upsertLocations(
  companyId: string,
  rows: ResolvedLocationRow[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(eq(locations.companyId, companyId));
    const byName = new Map(existing.map((l) => [l.name.trim().toLowerCase(), l.id]));
    for (const row of rows) {
      const id = byName.get(row.name.trim().toLowerCase());
      if (id) {
        if (row.status !== null) {
          await tx
            .update(locations)
            .set({ status: row.status, updatedAt: new Date() })
            .where(and(eq(locations.id, id), eq(locations.companyId, companyId)));
        }
        updated += 1;
      } else {
        const [ins] = await tx
          .insert(locations)
          .values({ companyId, name: row.name, status: row.status ?? "active" })
          .returning({ id: locations.id });
        byName.set(row.name.trim().toLowerCase(), ins!.id);
        created += 1;
      }
    }
  });
  return { created, updated };
}
