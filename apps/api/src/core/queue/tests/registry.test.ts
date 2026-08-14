// Author: Brijesh Dave <https://github.com/brijeshdave>
// The registry has to list every queue, and the queue feature has to stay
// separable from the rest of the app.
//
// Both are checked by reading the source, for the same reason the scoping and
// permission guards are: they fail when somebody adds a thing next year and
// forgets, which no behavioural test can do for code that does not exist yet.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { QUEUE_REGISTRY } from "@/core/queue/registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const queueDir = resolve(here, "..");
const featureDir = resolve(here, "../../../features");

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

describe("the queue registry", () => {
  it("lists every queue the app declares", () => {
    // Every module names its queue in a `<NAME>_QUEUE = "…"` constant. That string
    // is the BullMQ name, and the registry id has to match it or the routes
    // address a queue that does not exist.
    //
    // The suffix has to be exact. A looser `\w*QUEUE\w*` also matches
    // `QUEUE_HEALTH_JOB`, and this test duly failed on it — job names are a
    // different vocabulary and end in `_JOB`.
    const declared = new Set<string>();
    for (const file of sourceFiles(queueDir)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/export const \w+_QUEUE = "([^"]+)"/g)) {
        declared.add(match[1]!);
      }
    }

    const registered = new Set(QUEUE_REGISTRY.map((entry) => entry.id));
    const missing = [...declared].filter((id) => !registered.has(id));

    expect(
      missing,
      `These queues exist but are not in the registry, so nothing can see or manage ` +
        `them:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
    // And the other direction: a registry entry for a queue nothing produces to
    // would be a permanently empty row on the screen.
    expect([...registered].filter((id) => !declared.has(id))).toEqual([]);
  });

  it("describes every queue in words", () => {
    for (const entry of QUEUE_REGISTRY) {
      expect(entry.label.length, `${entry.id} has no label`).toBeGreaterThan(0);
      expect(entry.description.endsWith("."), `${entry.id}'s description is not a sentence`).toBe(
        true,
      );
    }
  });

  it("does not construct a queue merely by being imported", () => {
    // Constructing a BullMQ Queue opens Redis connections. If the registry did it
    // at module scope, importing it — which every test and CLI command that
    // touches the app now does — would need infrastructure to be running.
    const source = readFileSync(resolve(queueDir, "registry.ts"), "utf8");
    expect(source).not.toMatch(/get:\s*get\w+Queue\(\)/);
  });
});

describe("the queues feature stays separable", () => {
  it("imports nothing from another feature", () => {
    // The whole point of QUEUE_ADMIN is that this feature can be switched off
    // because it is not load-bearing. A queues service that called into the
    // journal or the users service would make that claim false — and retrying a
    // job must mean handing it back to BullMQ, never re-running a handler here.
    const dir = resolve(featureDir, "queues");
    let files: string[];
    try {
      files = sourceFiles(dir);
    } catch {
      // The feature arrives in the next commit; until then there is nothing to
      // check and this must not fail the build.
      return;
    }

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from "@\/features\/([\w-]+)\//g)) {
        if (match[1] !== "queues") offenders.push(`${file.slice(dir.length + 1)} → ${match[1]}`);
      }
    }

    expect(
      offenders,
      `features/queues must depend on BullMQ and the registry only, or switching it ` +
        `off is not the isolated change QUEUE_ADMIN claims:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
