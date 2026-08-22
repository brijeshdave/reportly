// Author: Brijesh Dave <https://github.com/brijeshdave>
// A company-scoped feature must be covered by the deactivation guard.
//
// A deactivated company refuses writes to the paths listed in `scoped-routes.ts`.
// That list is hand-written, which makes it exactly the kind of thing that rots:
// the next feature to read `ctx.companyId` inherits none of the rule and nobody
// notices, because the failure is silent — work carries on being filed into a
// company somebody believed was closed. That is the original bug, and this test
// exists so it cannot happen the same way twice.
//
// Writing this caught `/locations` missing from the list on the first attempt.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COMPANY_OWNED_PREFIXES, isCompanyOwnedPath } from "@/features/companies/scoped-routes.js";

const featuresDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Features that read the active company but are deliberately *not* closed with it.
 *
 * Each needs a reason, because "it was easier" is how a guard becomes decoration.
 */
const EXEMPT = new Map<string, string>([
  ["me", "Your own bell, profile and sites — reading, not filing work."],
  ["analytics", "Reporting on what already exists. Read-only by nature."],
  ["audit", "The record of what happened, which a deactivation must not edit or hide."],
  ["notifications", "Marking your own notifications read is not the company's work."],
  [
    "messages",
    "The record of what was sent. Read-only, and a deactivation must not edit or hide it.",
  ],
]);

/** Every route path a feature registers, as written in its routes file. */
function prefixesOf(feature: string): string[] {
  const dir = resolve(featuresDir, feature);
  const files = readdirSync(dir).filter((name) => name.includes("routes") && name.endsWith(".ts"));
  const found = new Set<string>();
  for (const file of files) {
    const source = readFileSync(resolve(dir, file), "utf8");
    for (const match of source.matchAll(/"(\/[a-z0-9-]+)/g)) found.add(match[1]!);
  }
  return [...found];
}

/** Features whose routes resolve the active company. */
function companyScopedFeatures(): string[] {
  return readdirSync(featuresDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((feature) => {
      const dir = resolve(featuresDir, feature);
      return readdirSync(dir)
        .filter((name) => name.includes("routes") && name.endsWith(".ts"))
        .some((name) =>
          /ctx!?\.companyId|activeCompany\(/.test(readFileSync(resolve(dir, name), "utf8")),
        );
    });
}

describe("the deactivation guard's reach", () => {
  it("covers every feature that files work into a company", () => {
    const uncovered = companyScopedFeatures().filter((feature) => {
      if (EXEMPT.has(feature)) return false;
      return !prefixesOf(feature).some((prefix) => isCompanyOwnedPath(prefix));
    });

    expect(
      uncovered,
      "These read ctx.companyId but none of their paths are closed when the company is " +
        `deactivated. Add them to COMPANY_OWNED_PREFIXES, or to EXEMPT with a reason: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });

  it("lists each prefix once, and as a path", () => {
    expect(new Set(COMPANY_OWNED_PREFIXES).size).toBe(COMPANY_OWNED_PREFIXES.length);
    for (const prefix of COMPANY_OWNED_PREFIXES) expect(prefix.startsWith("/")).toBe(true);
  });

  it("leaves the way back on, and the app's own furniture, open", () => {
    // The trap this list exists to avoid: the web app sends the company header on
    // every request, so closing these would leave a deactivated company with no way
    // to reactivate it, and an administrator unable to edit a user meanwhile.
    for (const path of [
      "/companies",
      "/companies/8f0f0e2c-0000-4000-8000-000000000000/reactivate",
      "/users",
      "/users/8f0f0e2c-0000-4000-8000-000000000000",
      "/settings/auth/rateLimit",
      "/groups",
      "/roles",
      "/me",
    ]) {
      expect(isCompanyOwnedPath(path), `${path} must stay open`).toBe(false);
    }
  });

  it("closes the company's own work", () => {
    for (const path of [
      "/journal",
      "/journal/8f0f0e2c-0000-4000-8000-000000000000",
      "/locations",
      "/assets",
      "/tasks",
      "/shifts",
    ]) {
      expect(isCompanyOwnedPath(path), `${path} must close with the company`).toBe(true);
    }
  });
});
