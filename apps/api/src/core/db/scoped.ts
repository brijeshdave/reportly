// Author: Brijesh Dave <https://github.com/brijeshdave>
// Location scoping. Repositories pass their table's location column and the
// request AuthContext; these return a Drizzle condition (or `undefined` = no
// constraint) to fold into a query's WHERE.
//
// Read this before adding a caller — the two rules below are not obvious, and
// getting either wrong is invisible in a unit test and catastrophic in use:
//
//  1. **An empty group scope means ALL locations, not none.** `buildAuthContext`
//     maps a group with no `group_locations` rows to `"all"` (a group that names
//     no sites is not restricted to nowhere). `locationIds: []` therefore only
//     happens for a caller with no company context at all, and that must match
//     nothing.
//  2. **A NULL location column is visible to everybody.** An asset that has not
//     been placed at a site yet is not secret — it is unplaced. `inArray()` drops
//     NULLs, so a nullable column MUST use `withLocationsNullable`, or every
//     untagged row silently vanishes for any scoped group.
//
// There is deliberately no `withCompany()` here. Company scoping is enforced by
// routes resolving `activeCompany(ctx.companyId)` and passing it explicitly into
// the repos, which is visible at the call site. A second, optional mechanism that
// each repo could forget to call is exactly how SF-004 happened: a helper that
// guards nothing looks identical to one that guards everything.
import type { AuthContext } from "@reportly/shared";
import { type AnyColumn, type SQL, inArray, isNull, notInArray, or, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { departmentUserLocations } from "@/core/db/schema.js";

/**
 * Constrain a **non-nullable** location column to the caller's allowed locations.
 * Use for `locations.id` itself, where every row has a location by definition.
 */
export function withLocations(ctx: AuthContext, locationColumn: AnyColumn): SQL | undefined {
  if (ctx.isSuperadmin) return undefined;
  if (ctx.locationIds === "all") return undefined;
  if (ctx.locationIds.length === 0) return sql`false`; // no company context → match nothing
  return inArray(locationColumn, ctx.locationIds);
}

/**
 * Constrain a **nullable** location column: rows at one of the caller's locations,
 * plus rows not placed at any location at all.
 *
 * This is the one to use for `assets`, `devices` and `reports`. The NULL branch is
 * load-bearing: when this shipped, no row anywhere had a location set, so an
 * `inArray`-only condition would have emptied every list for every scoped group.
 */
export function withLocationsNullable(
  ctx: AuthContext,
  locationColumn: AnyColumn,
): SQL | undefined {
  if (ctx.isSuperadmin) return undefined;
  if (ctx.locationIds === "all") return undefined;
  if (ctx.locationIds.length === 0) return sql`false`;
  return or(isNull(locationColumn), inArray(locationColumn, ctx.locationIds));
}

/**
 * Whether the caller may reach a specific location — the check a write performs
 * before accepting a `locationId`. Reading a scope you cannot see is a filtered
 * list; *writing* into one is placing a record where you cannot look, so it is
 * refused rather than filtered.
 */
export function mayUseLocation(ctx: AuthContext, locationId: string | null): boolean {
  if (locationId === null) return true; // unplaced is allowed for everyone
  if (ctx.isSuperadmin) return true;
  if (ctx.locationIds === "all") return true;
  return ctx.locationIds.includes(locationId);
}

/**
 * Constrain a **person** column to people who work at the caller's sites.
 *
 * The row has no location of its own — a points award, a routine completion, a
 * day worked — so the site comes from the person in it, via their department
 * memberships. Without this, every people-shaped report showed the whole company
 * to somebody restricted to one plant: the permission decided which report opened,
 * and nothing decided which rows it held.
 *
 * Somebody with no site recorded is visible to everybody, for the same reason an
 * unplaced asset is: not yet placed is not the same as hidden. That also keeps this
 * safe to switch on — an organisation that has not filled in memberships sees no
 * change, rather than a set of empty reports.
 */
export function withPersonLocations(ctx: AuthContext, userColumn: AnyColumn): SQL | undefined {
  if (ctx.isSuperadmin) return undefined;
  if (ctx.locationIds === "all") return undefined;
  if (ctx.locationIds.length === 0) return sql`false`;

  const atMySites = db
    .select({ userId: departmentUserLocations.userId })
    .from(departmentUserLocations)
    .where(inArray(departmentUserLocations.locationId, ctx.locationIds));

  const placedAnywhere = db
    .select({ userId: departmentUserLocations.userId })
    .from(departmentUserLocations);

  return or(inArray(userColumn, atMySites), notInArray(userColumn, placedAnywhere));
}
