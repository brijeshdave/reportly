// Author: Brijesh Dave <https://github.com/brijeshdave>
// The test the three dead permissions needed and did not have.
//
// `shifts:approve`, `journal:delete` and `users:delete` were each declared in the
// catalogue, granted by a seeded role, and rendered in the roles matrix — while no
// code read them. An administrator ticking one reasonably believed they had
// delegated an authority. They had not. It is the SF-001/002/003/004 shape again:
// a value written and displayed, and acted on nowhere.
//
// Every existing test asked "does this permission work?" — which is unanswerable
// for a permission nothing consults. So this file asks the two questions that
// catch it, statically, by reading the source:
//
//   1. Is every permission in the catalogue ENFORCED by something?
//   2. Is every permission in the catalogue REACHABLE — granted by some role, so
//      an administrator can actually hand it out?
//
// A permission that fails (1) grants nothing. One that fails (2) can be granted by
// nobody. Both are bugs, and both look exactly like working code.
//
// If this fails, do not delete the assertion. Either wire the permission up, or
// retire it, or add it to an exemption list below **with a reason** — an exemption
// anyone can read and disagree with is the point.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_PERMISSIONS, PERMISSIONS, type Permission } from "@reportly/shared";
import { describe, expect, it } from "vitest";

import { AREA_ROLES, permissionsFor } from "@/core/db/seed/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = resolve(here, "../../../..");

/** Every .ts file under a directory, recursively, excluding tests. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "tests" || entry === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The whole API source except the seed — the seed *grants* permissions, so counting
 * it as enforcement is what let all three dead permissions look used.
 */
const enforcementSource = sourceFiles(resolve(apiSrc, "features"))
  .concat(sourceFiles(resolve(apiSrc, "core")).filter((f) => !f.includes("/db/seed/")))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/**
 * Permissions deliberately granted but not enforced by the API.
 *
 * Keep this empty if you can. A permission belongs here only when something
 * outside the API acts on it, and the reason has to say what.
 */
const ENFORCEMENT_EXEMPT: Partial<Record<Permission, string>> = {
  // The web app gates the navigation entry and the page on this; the data behind
  // the page is a normal journal read, already guarded by journal:read.
  "leaderboard:view": "enforced in the web app's route guard, over journal:read data",
};

/**
 * Permission value -> the constant name guards actually write
 * (`users:read` -> `PERMISSIONS.USERS_READ`). Guards reference the constant, not
 * the string, so looking only for the string finds nothing at all — which is a
 * failure mode worth naming, because it makes the whole check silently vacuous in
 * the other direction.
 */
const CONSTANT_FOR = new Map<string, string>(
  Object.entries(PERMISSIONS).map(([name, value]) => [value, `PERMISSIONS.${name}`]),
);

describe("permission catalogue coverage", () => {
  it("every permission is enforced somewhere in the API", () => {
    const orphaned = ALL_PERMISSIONS.filter((permission) => {
      if (ENFORCEMENT_EXEMPT[permission]) return false;
      const constant = CONSTANT_FOR.get(permission);
      // Either form counts: the constant is how a guard is written, the string is
      // what the wire carries and what a data-driven check might compare against.
      // A third form, for keys a guard cannot name one at a time: the report
      // permissions are held in a source→key map and looked up once the report
      // being run is known, because which report it is arrives in the request
      // body. `assertMayRead` is the enforcement; the map is how it finds the key.
      if (permission.startsWith("reports:view:")) {
        return !enforcementSource.includes("REPORT_VIEW_PERMISSION[");
      }
      return (
        !enforcementSource.includes(`"${permission}"`) &&
        !(constant && enforcementSource.includes(constant))
      );
    });

    expect(
      orphaned,
      `These permissions are granted by roles but read by no route, service or guard, ` +
        `so holding one confers nothing. Enforce them, retire them, or exempt them ` +
        `with a reason:\n  ${orphaned.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every permission is reachable — some role grants it", () => {
    const granted = new Set<string>([
      ...permissionsFor("Superadmin"),
      ...permissionsFor("Admin"),
      ...permissionsFor("Manager"),
      ...permissionsFor("Member"),
      ...AREA_ROLES.flatMap((role) => role.permissions),
    ]);

    const unreachable = ALL_PERMISSIONS.filter((p) => !granted.has(p));

    expect(
      unreachable,
      `These permissions exist and are enforced, but no seeded role grants them — ` +
        `an administrator cannot hand them out without building a role by hand:\n  ` +
        unreachable.join("\n  "),
    ).toEqual([]);
  });

  it("every permission an area role grants is a real permission", () => {
    // A typo'd constant would silently grant nothing: the seed looks the key up in
    // a map and skips what it cannot find.
    const catalogue = new Set<string>(ALL_PERMISSIONS);
    const unknown = AREA_ROLES.flatMap((role) =>
      role.permissions.filter((p) => !catalogue.has(p)).map((p) => `${role.name}: ${p}`),
    );
    expect(unknown).toEqual([]);
  });

  it("area role names are unique", () => {
    // They are the seed's conflict target, so a duplicate would silently merge two
    // roles' grants into one row.
    const names = AREA_ROLES.map((r) => r.name);
    expect(names).toEqual([...new Set(names)]);
  });
});
