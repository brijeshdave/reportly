// Author: Brijesh Dave <https://github.com/brijeshdave>
// A setting that is not in `ALL_SETTING_DEFS` cannot be changed by anybody.
//
// The settings screen builds its tabs and its forms from that array and nothing
// else, so a definition left out of it has no tab, no field, and no way in. The
// code still reads it — `getSystemSetting` falls back to the schema default — so
// everything appears to work, and the setting is simply frozen at its default
// forever.
//
// This is not hypothetical: `messages.retention` shipped that way and was reported
// from use as "where can I change and manage this? I did not found it anywhere".
// The namespace even had a display label waiting for it; the definition was never
// added to the list. It is the same shape as every other bug in this codebase —
// a stored value that nothing can act on.
import { describe, expect, it } from "vitest";

import * as registry from "@/settings/registry.js";
import { ALL_SETTING_DEFS } from "@/settings/registry.js";

/** Every exported SettingDef, found by shape rather than by name. */
function exportedDefs(): { name: string; namespace: string; key: string }[] {
  return Object.entries(registry)
    .filter(
      (entry): entry is [string, { namespace: string; key: string; schema: unknown }] =>
        typeof entry[1] === "object" &&
        entry[1] !== null &&
        "namespace" in entry[1] &&
        "key" in entry[1] &&
        "schema" in entry[1],
    )
    .map(([name, def]) => ({ name, namespace: def.namespace, key: def.key }));
}

describe("the settings registry", () => {
  it("lists every setting it defines, or the screen cannot show it", () => {
    const listed = new Set(ALL_SETTING_DEFS.map((def) => `${def.namespace}.${def.key}`));
    const missing = exportedDefs()
      .filter((def) => !listed.has(`${def.namespace}.${def.key}`))
      .map((def) => `${def.name} (${def.namespace}.${def.key})`);

    expect(
      missing,
      "These settings are defined but not in ALL_SETTING_DEFS, so no screen can " +
        `reach them and they are frozen at their defaults: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("has no two settings claiming the same namespace and key", () => {
    // The other way to be unreachable: shadowed by a namesake, so the form edits
    // one and the code reads the other.
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const def of exportedDefs()) {
      const id = `${def.namespace}.${def.key}`;
      const first = seen.get(id);
      if (first) clashes.push(`${id}: ${first} and ${def.name}`);
      else seen.set(id, def.name);
    }
    expect(clashes).toEqual([]);
  });
});
