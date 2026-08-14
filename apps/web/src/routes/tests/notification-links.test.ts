// Author: Brijesh Dave <https://github.com/brijeshdave>
// Every route a notification links to has to exist.
//
// The test two real bugs asked for. The API stores a route string with each
// notification, and the web app renders it as a `<Link to=…>`. Nothing connects
// the two: `/shift-change` and `/routines/mine` were both written from memory of
// the sidebar labels, both wrong, and both would have shipped — a typecheck
// cannot catch a string, and the failure only appears when somebody clicks the
// thing they were notified about.
//
// It is the SF-001..007 family again in a new place: a value written, displayed,
// and validated by nothing. So this reads both sides and compares them.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const apiFeatures = resolve(here, "../../../../api/src/features");
const routerFile = resolve(here, "../router.tsx");

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
 * The route paths the web app actually declares, as matchable patterns.
 *
 * `$reportId` becomes a wildcard, since a notification carries a real id where
 * the router carries a parameter.
 */
function declaredRoutes(): RegExp[] {
  const source = readFileSync(routerFile, "utf8");
  return [...source.matchAll(/path:\s*"([^"]+)"/g)]
    .map((match) => match[1]!)
    .map((path) => new RegExp(`^${path.replace(/\$[A-Za-z]+/g, "[^/]+")}$`));
}

/** Every `link:` a notification is emitted with, and where it came from. */
function emittedLinks(): { link: string; file: string }[] {
  const out: { link: string; file: string }[] = [];
  for (const file of sourceFiles(apiFeatures)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/link:\s*(?:`([^`]+)`|"([^"]+)")/g)) {
      // A template literal's `${id}` stands in for a route parameter.
      const raw = (match[1] ?? match[2])!.replace(/\$\{[^}]+\}/g, "x");
      out.push({ link: raw, file: file.slice(apiFeatures.length + 1) });
    }
  }
  return out;
}

describe("notification links", () => {
  it("finds the links it is meant to be checking", () => {
    // If a refactor breaks the scan this whole file silently passes, which is the
    // failure mode it exists to prevent.
    expect(emittedLinks().length).toBeGreaterThan(4);
  });

  it("points every notification at a route that exists", () => {
    const routes = declaredRoutes();
    const broken = emittedLinks().filter(({ link }) => !routes.some((route) => route.test(link)));

    expect(
      broken,
      `These notifications link to a route the web app does not declare, so following one ` +
        `from the bell goes nowhere:\n  ` +
        broken.map((b) => `${b.link} (${b.file})`).join("\n  "),
    ).toEqual([]);
  });
});
