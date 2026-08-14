// Author: Brijesh Dave <https://github.com/brijeshdave>
// The cartridges module has to stay a module.
//
// The user's first requirement was that this be separable and switchable off.
// That claim is only true while the dependency edges point one way, and an edge
// is added by somebody in a hurry a year from now, not today — so this reads the
// source rather than the behaviour. It is the same guard the queues feature has,
// for the same reason.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const partsDir = resolve(here, "..");
const srcDir = resolve(here, "../../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The one file allowed to know the module exists.
 *
 * Registering routes is how a module is plugged in; that edge is the plug. Every
 * other inbound edge is the app growing a dependency on a feature it is supposed
 * to survive without.
 */
const ALLOWED_INBOUND = ["core/app.ts"];

describe("the cartridges module stays separable", () => {
  it("is imported by nothing but the route registration", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const relative = file.slice(srcDir.length + 1).replaceAll("\\", "/");
      if (relative.startsWith("features/parts/") || ALLOWED_INBOUND.includes(relative)) continue;
      if (/from "@\/features\/parts\//.test(readFileSync(file, "utf8"))) offenders.push(relative);
    }

    expect(
      offenders,
      `These files import features/parts, so the module can no longer be removed or ` +
        `left switched off without breaking them:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("imports no other feature", () => {
    // It may read the device register and write to the points ledger, but both of
    // those are tables in `core/db`, reached through this module's own repos. An
    // import of another feature's service would mean cartridges had opinions about
    // how journal entries or users work, and switching it off would take those
    // with it.
    const offenders: string[] = [];
    for (const file of sourceFiles(partsDir)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from "@\/features\/([\w-]+)\//g)) {
        if (match[1] !== "parts") {
          offenders.push(`${file.slice(partsDir.length + 1)} → ${match[1]}`);
        }
      }
    }

    expect(
      offenders,
      `features/parts must reach the rest of the app through core only:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("guards every route with the module check", () => {
    // A route that forgets `requireModule` is reachable at a company that has the
    // module off — and it would look fine in every test, because the tests turn it
    // on. Counting is crude and deliberate: each handler resolves the company id
    // through the check, so a handler without one is the bug.
    const missing: string[] = [];
    for (const file of sourceFiles(partsDir).filter((f) => f.endsWith("-routes.ts"))) {
      const source = readFileSync(file, "utf8");
      const handlers = [...source.matchAll(/\n {2}app\.(get|post|patch|put|delete)\(/g)].length;
      const checks = [...source.matchAll(/requireModule\(/g)].length;
      // A routes file that matches nothing would pass this happily. Counting zero
      // handlers means the pattern stopped matching, not that the file is safe.
      expect(handlers, `${file} declares no routes — has the pattern drifted?`).toBeGreaterThan(0);
      if (checks < handlers) {
        missing.push(`${file.slice(partsDir.length + 1)}: ${handlers} routes, ${checks} checks`);
      }
    }

    expect(
      missing,
      `Every parts route has to ask whether the company uses the module:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});
