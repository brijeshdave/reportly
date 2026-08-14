// Author: Brijesh Dave <https://github.com/brijeshdave>
// The app must not promise a feature it already has.
//
// The journal editor told people that recording downtime was "coming soon" for
// months after downtime shipped — table, panel, reports and all. So the one
// screen whose whole job was to separate work time from downtime was also the
// screen saying the separation did not exist yet, and people read the sentence
// and believed it.
//
// A placeholder is only ever true for a while. This fails the build when one
// outlives the thing it was standing in for, which is the only moment anybody
// would think to look.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, "../..");

/** Phrases that promise something later. Deliberately few and unambiguous. */
const PROMISES = [/coming soon/i, /not yet (?:built|implemented|available)/i, /\bTBD\b/];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "tests") continue;
      out.push(...sourceFiles(full));
    } else if (
      /\.tsx?$/.test(entry) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("the interface", () => {
  it("promises nothing as 'coming soon'", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      // Comments are stripped first: a note explaining why a placeholder was
      // removed is not itself a promise, and this very test's fix tripped on the
      // comment it added.
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const promise of PROMISES) {
        const match = promise.exec(source);
        if (match) offenders.push(`${file.slice(srcDir.length + 1)}: "${match[0]}"`);
      }
    }

    expect(
      offenders,
      `A placeholder is only true for a while, and these outlive the thing they stand ` +
        `in for. Say what is there, or say nothing:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
