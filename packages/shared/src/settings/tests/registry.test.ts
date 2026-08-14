// Author: Brijesh Dave <https://github.com/brijeshdave>
// Tests for the settings registry: defaults and validation.
import { describe, expect, it } from "vitest";

import {
  ALL_SETTING_DEFS,
  PASSWORD_POLICY,
  defaultFor,
  findSettingDef,
} from "@/settings/registry.js";

describe("settings registry", () => {
  it("derives a complete default for every setting", () => {
    for (const def of ALL_SETTING_DEFS) {
      expect(() => defaultFor(def)).not.toThrow();
    }
    expect(defaultFor(PASSWORD_POLICY)).toMatchObject({ minLength: 12, requireNumber: true });
  });

  it("looks settings up by namespace and key", () => {
    expect(findSettingDef("auth", "passwordPolicy")).toBe(PASSWORD_POLICY);
    expect(findSettingDef("auth", "nope")).toBeUndefined();
  });

  it("rejects values outside the declared bounds", () => {
    expect(PASSWORD_POLICY.schema.safeParse({ minLength: 4 }).success).toBe(false);
    expect(PASSWORD_POLICY.schema.safeParse({ minLength: 16 }).success).toBe(true);
  });
});
