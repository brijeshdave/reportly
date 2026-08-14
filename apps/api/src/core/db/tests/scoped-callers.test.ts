// Author: Brijesh Dave <https://github.com/brijeshdave>
// The test SF-004 needed and did not have.
//
// SF-004 was not a wrong condition — it was a *correct helper nobody called*.
// `withLocations()` was written, exported, unit-tested and green for five phases
// while no query in the codebase folded it into a WHERE. Every test that existed
// asked "does the helper work?"; none asked "does anything use it?".
//
// So this file tests the call sites, statically, by reading the source. It is a
// blunt instrument — it greps — and that is deliberate: it fails loudly when
// somebody adds a location-scopable repo and forgets to scope it, which no
// behavioural test can do for code that has not been written yet.
//
// If this test fails, do not delete the assertion. Either scope the new read, or
// add the file to the exemption list below **with a reason** — an exemption anyone
// can read and disagree with is the point.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const featureDir = resolve(here, "../../../features");

const read = (relative: string): string => readFileSync(resolve(featureDir, relative), "utf8");

/**
 * Repos whose rows carry a location, directly or through the record they hang off.
 * A read in one of these that does not consult the caller's scope is an SF-004.
 */
const LOCATION_SCOPED_REPOS = [
  "locations/repo.ts",
  "assets/repo.ts",
  "devices/repo.ts",
  "journal/repo.ts",
  "downtime/repo.ts",
];

/**
 * Services that must resolve a scope and hand it down. The repo takes the
 * condition as a required argument, so the service is where the decision is made.
 */
const LOCATION_SCOPED_SERVICES = [
  "locations/service.ts",
  "assets/service.ts",
  "devices/service.ts",
  "journal/service.ts",
  "downtime/service.ts",
];

describe("location scoping is actually wired up", () => {
  it.each(LOCATION_SCOPED_SERVICES)("%s resolves a location scope", (file) => {
    const source = read(file);
    const usesHelper =
      source.includes("withLocationsNullable(") || source.includes("withLocations(");
    expect(
      usesHelper,
      `${file} handles location-bearing rows but never calls a scoping helper. ` +
        `This is the exact shape of SF-004: a scope that is computed, shipped to ` +
        `the client, and consulted by nothing.`,
    ).toBe(true);
  });

  it.each(LOCATION_SCOPED_REPOS)("%s accepts a scope argument on its reads", (file) => {
    const source = read(file);
    // The repos take the condition as a parameter rather than building it, so the
    // signature is the evidence. `SQL | undefined` is how it arrives.
    expect(
      source.includes("SQL | undefined"),
      `${file} has no read that accepts a scope condition. A location-scopable ` +
        `repo whose reads take no scope cannot be filtered by its caller.`,
    ).toBe(true);
  });

  it("nullable location columns use the NULL-aware helper, not the plain one", () => {
    // `assets`, `devices` and `reports` all have nullable location columns, where
    // NULL means "not placed" and must stay visible. Using the plain helper on one
    // of those hides every unplaced row from every scoped user — a failure that
    // looks like missing data, not like a permission bug, so it gets misdiagnosed.
    for (const file of ["assets/service.ts", "devices/service.ts", "journal/service.ts"]) {
      const source = read(file);
      expect(
        source.includes("withLocationsNullable("),
        `${file} scopes a nullable location column and must use withLocationsNullable`,
      ).toBe(true);
    }
  });

  it("no dead scoping helper is exported", () => {
    // The other half of the SF-004 lesson: `withCompany()` sat beside the broken
    // helper with a matching signature and no callers, which is what made an
    // uncalled `withLocations()` look normal. Every helper here must be used
    // somewhere, or it is decoration that lends false confidence.
    const helpers = readFileSync(resolve(here, "../scoped.ts"), "utf8");
    const exported = [...helpers.matchAll(/export function (\w+)/g)].map((m) => m[1]!);
    const callers = LOCATION_SCOPED_SERVICES.map(read).join("\n");

    for (const name of exported) {
      expect(
        callers.includes(`${name}(`),
        `scoped.ts exports ${name}() but no service calls it. Delete it or use it — ` +
          `an unused guard is indistinguishable from a working one.`,
      ).toBe(true);
    }
  });
});

/**
 * Company scoping, checked the same way — by reading the call sites.
 *
 * SF-006 was `features/vocabulary`, whose repo contained the string `companyId`
 * zero times. Its rows hang off `departments`, which belongs to a company, so a
 * caller could read and write another tenant's vocabulary; the unfiltered list
 * returned every company's rows on the install, over a route Member can reach.
 *
 * The location tests above did not cover it and could not: vocabulary carries a
 * department, not a location. Company scoping is enforced by a *convention* —
 * routes pass `activeCompany(ctx.companyId)` into repos, which is deliberate
 * because it is visible at the call site — and nothing checked the convention was
 * followed.
 *
 * So this derives the company-owned tables from the schema rather than listing
 * them, and asserts that any repo touching one mentions `companyId`. Deriving is
 * the point: a table added next year is covered without anyone remembering to
 * add it here.
 */
describe("company scoping is actually wired up", () => {
  const schema = readFileSync(resolve(here, "../schema.ts"), "utf8");

  /** Tables with their own `company_id` column. */
  const companyOwned = [...schema.matchAll(/export const (\w+) = pgTable\(/g)]
    .map((match, index, all) => {
      const start = match.index! + match[0].length;
      const next = all[index + 1]?.index ?? schema.length;
      return { name: match[1]!, body: schema.slice(start, next) };
    })
    .filter((t) => t.body.includes('companyId: uuid("company_id")'))
    .map((t) => t.name);

  /**
   * Repos that legitimately touch a company-owned table without scoping by it.
   * Each needs a reason somebody else can disagree with.
   */
  const EXEMPT: Record<string, string> = {
    "attachments/repo.ts":
      "keyed by the owning record; the owner's own read is what scopes it, and an " +
      "attachment id is server-generated and unguessable",
    "me/repo.ts": "reads the caller's own row, which is the scope",
  };

  it("finds the company-owned tables it is meant to be checking", () => {
    // If a schema refactor breaks the derivation this whole block silently passes,
    // which is the failure mode it exists to prevent.
    expect(companyOwned.length).toBeGreaterThan(10);
    expect(companyOwned).toContain("departments");
    expect(companyOwned).toContain("journalEntries");
  });

  it("every repo touching a company-owned table scopes by company", () => {
    const repos = readdirSync(featureDir)
      .flatMap((feature) => {
        const dir = resolve(featureDir, feature);
        if (!statSync(dir).isDirectory()) return [];
        return readdirSync(dir)
          .filter((f) => /repo.*\.ts$/.test(f))
          .map((f) => `${feature}/${f}`);
      })
      .filter((relative) => !EXEMPT[relative]);

    const unscoped = repos.filter((relative) => {
      const source = read(relative);
      // Comments stripped first. Grepping the raw file would let a file that only
      // *mentions* companyId in a doc comment pass — including, as it happens, the
      // comment explaining that it is scoped. The evidence has to be code.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const touches = companyOwned.some((table) => new RegExp(`\\b${table}\\b`).test(code));
      return touches && !code.includes("companyId");
    });

    expect(
      unscoped,
      `These repos read or write a table that belongs to a company, and never ` +
        `mention companyId — so nothing stops one tenant reaching another's rows. ` +
        `This is SF-006. Scope them, or exempt them with a reason:\n  ` +
        unscoped.join("\n  "),
    ).toEqual([]);
  });
});
