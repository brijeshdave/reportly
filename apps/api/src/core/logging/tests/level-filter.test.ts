// Author: Brijesh Dave <https://github.com/brijeshdave>
// Per-feature log levels. These assert the *acting* path — that a line is
// actually dropped or kept — rather than that the setting round-trips, which is
// how the feature came to be configurable and inert in the first place.
import { describe, expect, it } from "vitest";

import { floorLevel, passesFeatureLevel } from "@/core/logging/level-filter.js";

const line = (level: string, feature?: string) =>
  JSON.stringify({ level, msg: "x", ...(feature ? { feature } : {}) });

describe("floorLevel", () => {
  it("is the default when no feature overrides it", () => {
    expect(floorLevel({ default: "info", features: {} })).toBe("info");
  });

  it("drops to the most verbose feature, so pino does not swallow it first", () => {
    // The whole point of the setting: email at debug while everything else stays
    // at info. pino discards a record below its own level before any sink runs,
    // so the floor has to be debug or the override could never take effect.
    expect(floorLevel({ default: "info", features: { email: "debug" } })).toBe("debug");
  });

  it("is unmoved by a feature that is stricter than the default", () => {
    // Stricter is applied per line, not by lowering the floor for everyone.
    expect(floorLevel({ default: "info", features: { email: "error" } })).toBe("info");
  });

  it("takes the lowest across several features", () => {
    expect(
      floorLevel({ default: "warn", features: { email: "info", queue: "trace", api: "error" } }),
    ).toBe("trace");
  });
});

describe("passesFeatureLevel", () => {
  const levels = { default: "info", features: { email: "debug", audit: "error" } };

  it("keeps a feature's line at its own, more verbose, level", () => {
    expect(passesFeatureLevel(line("debug", "email"), levels)).toBe(true);
  });

  it("drops a line the feature's stricter level excludes", () => {
    // audit is set to error, so its info lines go — even though the default keeps
    // info for everyone else.
    expect(passesFeatureLevel(line("info", "audit"), levels)).toBe(false);
    expect(passesFeatureLevel(line("error", "audit"), levels)).toBe(true);
  });

  it("drops another feature's debug line that only the floor let through", () => {
    // This is the case the floor creates: pino is at debug because of email, so a
    // debug line from `backups` reaches the gate and must be dropped here.
    expect(passesFeatureLevel(line("debug", "backups"), levels)).toBe(false);
    expect(passesFeatureLevel(line("info", "backups"), levels)).toBe(true);
  });

  it("applies the default to a line with no feature tag", () => {
    expect(passesFeatureLevel(line("debug"), levels)).toBe(false);
    expect(passesFeatureLevel(line("warn"), levels)).toBe(true);
  });

  it("emits a line it cannot parse rather than losing it", () => {
    expect(passesFeatureLevel("not json", levels)).toBe(true);
  });

  it("emits a line whose level it does not recognise", () => {
    // An unknown label must not become a silent hole in the log.
    expect(passesFeatureLevel(line("verbose", "email"), levels)).toBe(true);
  });
});
