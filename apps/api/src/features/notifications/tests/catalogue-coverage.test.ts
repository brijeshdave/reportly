// Author: Brijesh Dave <https://github.com/brijeshdave>
// Every notification type in the catalogue is actually sent by something.
//
// The standing rule on this project is that a new feature ships its
// notifications. A rule is a note somebody has to remember; this is the version
// that fails the build.
//
// It matters because a catalogue entry nothing emits is worse than no entry at
// all: it appears on the administrator's matrix and on every user's preference
// screen as a switch they can set, describing a message that will never arrive.
// That is the same shape as the three dead permissions — declared, granted,
// rendered, and consulted by nothing.
//
// Phase 9 planned this guard and shipped without it. Four types were cut that
// phase precisely because they had no emitter, and the only thing that caught
// them was reading the list by hand.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NOTIFICATION_TYPES } from "@reportly/shared";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const apiSrc = resolve(here, "../../..");

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
 * The whole API source, comments stripped.
 *
 * Stripped because a doc comment naming a type would otherwise count as an
 * emitter — the company-scoping guard passed on unfixed code for exactly that
 * reason, matching the word `companyId` inside the comment explaining that the
 * file was scoped.
 */
const source = sourceFiles(apiSrc)
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

describe("the notification catalogue is wired up", () => {
  it("emits every type it declares", () => {
    // The quoted literal anywhere in the source, not `type: "…"` specifically.
    // The reminder sweep chooses between two types with a ternary — `dueTomorrow
    // ? "routine.due-soon" : "routine.overdue"` — so a stricter pattern reported
    // both as dead when both are sent. Comments are already stripped, so a mention
    // is a real reference to the string.
    const dead = NOTIFICATION_TYPES.map((def) => def.type).filter(
      (type) => !source.includes(`"${type}"`),
    );

    expect(
      dead,
      `These notification types are in the catalogue but nothing sends them, so they ` +
        `appear on the admin matrix and on every preference screen as a switch for a ` +
        `message that never arrives:\n  ${dead.join("\n  ")}\n\n` +
        `Either emit them, or take them out of the catalogue.`,
    ).toEqual([]);
  });

  it("only emits types the catalogue knows about", () => {
    // The other direction. `dispatch()` drops an unknown type at runtime, which is
    // the safe behaviour and also a silent one — the emitter looks fine, and
    // nobody is ever told anything.
    const known = new Set<string>(NOTIFICATION_TYPES.map((def) => def.type));
    const notifyCalls = [...source.matchAll(/notify\(\s*\{[^}]*?type:\s*"([^"]+)"/gs)].map(
      (match) => match[1]!,
    );

    const unknown = [...new Set(notifyCalls)].filter((type) => !known.has(type));

    expect(
      unknown,
      `These are passed to notify() but are not in the catalogue, so dispatch drops ` +
        `them and nobody is told anything:\n  ${unknown.join("\n  ")}`,
    ).toEqual([]);
  });
});
