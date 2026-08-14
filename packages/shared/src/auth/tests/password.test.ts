// Author: Brijesh Dave <https://github.com/brijeshdave>
// The policy checker gates every password the system accepts, so each rule is
// pinned independently.
import { describe, expect, it } from "vitest";

import {
  isPasswordValid,
  passwordRequirements,
  passwordViolations,
  type PasswordPolicy,
} from "@/auth/password.js";
import { PASSWORD_POLICY, defaultFor } from "@/settings/registry.js";

const policy = (overrides: Partial<PasswordPolicy> = {}): PasswordPolicy => ({
  ...defaultFor(PASSWORD_POLICY),
  ...overrides,
});

describe("passwordViolations", () => {
  it("accepts a password that satisfies the default policy", () => {
    expect(passwordViolations(policy(), "Sup3rSecretPass")).toEqual([]);
    expect(isPasswordValid(policy(), "Sup3rSecretPass")).toBe(true);
  });

  it("reports a password shorter than minLength", () => {
    const violations = passwordViolations(policy({ minLength: 12 }), "Sh0rt");
    expect(violations.map((v) => v.rule)).toContain("minLength");
    expect(violations[0]!.message).toBe("Must be at least 12 characters");
  });

  it("reports every unmet rule at once", () => {
    const violations = passwordViolations(policy({ requireSymbol: true }), "short");
    expect(violations.map((v) => v.rule)).toEqual([
      "minLength",
      "requireUppercase",
      "requireNumber",
      "requireSymbol",
    ]);
  });

  it("ignores a rule the policy disables", () => {
    const relaxed = policy({ requireUppercase: false, requireNumber: false, minLength: 8 });
    expect(passwordViolations(relaxed, "lowercaseonly")).toEqual([]);
  });

  it("counts non-ascii letters and digits", () => {
    // Ā is uppercase, ٣ is an arabic-indic digit.
    expect(isPasswordValid(policy(), "Āaaaaaaaaaa٣")).toBe(true);
  });

  it("does not treat a letter, digit or space as a symbol", () => {
    const strict = policy({ requireSymbol: true });
    expect(passwordViolations(strict, "Passw0rd with spaces").map((v) => v.rule)).toEqual([
      "requireSymbol",
    ]);
    expect(isPasswordValid(strict, "Passw0rd with spaces!")).toBe(true);
  });
});

describe("passwordRequirements", () => {
  it("lists only the rules the policy enforces", () => {
    expect(passwordRequirements(policy({ minLength: 10, requireSymbol: false }))).toEqual([
      "At least 10 characters",
      "An uppercase letter",
      "A number",
    ]);
  });

  it("includes the symbol rule when enabled", () => {
    expect(passwordRequirements(policy({ requireSymbol: true }))).toContain("A symbol");
  });
});
