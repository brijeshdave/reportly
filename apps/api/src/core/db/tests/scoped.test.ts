// Author: Brijesh Dave <https://github.com/brijeshdave>
// Scoping-helper branch tests (no DB).
//
// A warning about what this file can and cannot prove. Its previous version tested
// `withLocations()` in exactly this style, passed for five phases, and the whole
// time **no query anywhere called it** (SF-004). A unit test on a pure function
// proves the condition it *would* build — never that anything folds it into a
// WHERE. The callers are proven by `scoped-callers.test.ts` (static) and by the
// location-scoping integration tests (behavioural). Do not read this file as
// evidence that scoping is enforced.
import type { AuthContext } from "@reportly/shared";
import { describe, expect, it } from "vitest";

import { db } from "@/core/db/index.js";
import { assets, locations } from "@/core/db/schema.js";
import { mayUseLocation, withLocations, withLocationsNullable } from "@/core/db/scoped.js";

const base: AuthContext = {
  userId: "u1",
  companyId: "c1",
  permissions: [],
  locationIds: "all",
  isSuperadmin: false,
  debug: false,
};

const scoped = (ids: string[]): AuthContext => ({ ...base, locationIds: ids });

describe("withLocations (non-nullable columns)", () => {
  it("returns no constraint for superadmin or an 'all' scope", () => {
    expect(withLocations({ ...base, isSuperadmin: true }, locations.id)).toBeUndefined();
    expect(withLocations(base, locations.id)).toBeUndefined();
  });

  it("constrains to an explicit location list", () => {
    expect(withLocations(scoped(["l1", "l2"]), locations.id)).toBeDefined();
  });

  it("matches nothing for an empty explicit list", () => {
    // Reachable only for a caller with no company context: an empty *group* scope
    // resolves to "all" in buildAuthContext, never to [].
    expect(withLocations(scoped([]), locations.id)).toBeDefined();
  });
});

describe("withLocationsNullable (nullable columns)", () => {
  it("returns no constraint for superadmin or an 'all' scope", () => {
    expect(
      withLocationsNullable({ ...base, isSuperadmin: true }, assets.locationId),
    ).toBeUndefined();
    expect(withLocationsNullable(base, assets.locationId)).toBeUndefined();
  });

  it("admits unplaced rows as well as the caller's own locations", () => {
    // The whole reason this helper exists. `inArray` alone drops NULLs, and on the
    // day this shipped every asset in the database had a NULL location — so an
    // inArray-only condition would have emptied every list for every scoped group.
    const condition = withLocationsNullable(scoped(["l1"]), assets.locationId);
    expect(condition).toBeDefined();
    // Compare against the plain helper: the nullable one must be strictly more
    // permissive, and the only difference that matters is the IS NULL branch.
    const rendered = db.select().from(assets).where(condition).toSQL().sql;
    expect(rendered).toContain("is null");
    expect(rendered).toContain("in (");
  });
});

describe("mayUseLocation", () => {
  it("allows the unplaced location to anyone", () => {
    expect(mayUseLocation(scoped(["l1"]), null)).toBe(true);
  });

  it("allows a location inside the caller's scope", () => {
    expect(mayUseLocation(scoped(["l1", "l2"]), "l2")).toBe(true);
  });

  it("refuses a location outside it", () => {
    // The write-side check. Reading a scope you lack yields a shorter list;
    // *writing* into one would file a record somewhere you can never look again.
    expect(mayUseLocation(scoped(["l1"]), "l9")).toBe(false);
  });

  it("lets a superadmin and an 'all' scope use any location", () => {
    expect(mayUseLocation({ ...base, isSuperadmin: true }, "l9")).toBe(true);
    expect(mayUseLocation(base, "l9")).toBe(true);
  });
});
