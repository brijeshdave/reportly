// Author: Brijesh Dave <https://github.com/brijeshdave>
// Password policy evaluation, shared so the sign-up form and the API enforce the
// exact same rules. The API is the enforcement point; the form uses this only to
// tell the user what is wrong before they submit.
import { z } from "zod";

import type { passwordPolicySchema } from "@/settings/registry.js";

export type PasswordPolicy = z.infer<typeof passwordPolicySchema>;

/**
 * The subset of the policy that describes the password string itself. This is
 * what the sign-up form needs, and all a public endpoint should ever reveal —
 * expiry and reuse counts are internal.
 */
export const passwordRulesSchema = z.object({
  minLength: z.number().int(),
  requireUppercase: z.boolean(),
  requireNumber: z.boolean(),
  requireSymbol: z.boolean(),
});
export type PasswordRules = z.infer<typeof passwordRulesSchema>;

/** A single unmet rule, phrased for direct display next to the field. */
export interface PasswordViolation {
  rule: "minLength" | "requireUppercase" | "requireNumber" | "requireSymbol";
  message: string;
}

// Anything that is not a letter, a digit, or whitespace counts as a symbol.
const SYMBOL = /[^\p{L}\p{N}\s]/u;
const UPPERCASE = /\p{Lu}/u;
const DIGIT = /\p{Nd}/u;

/**
 * Every rule the password fails, in the order they appear in the policy. Empty
 * array = acceptable. Expiry and reuse are history rules, not string rules, so
 * they are enforced against stored passwords rather than here.
 */
export function passwordViolations(policy: PasswordRules, password: string): PasswordViolation[] {
  const violations: PasswordViolation[] = [];

  if (password.length < policy.minLength) {
    violations.push({
      rule: "minLength",
      message: `Must be at least ${policy.minLength} characters`,
    });
  }
  if (policy.requireUppercase && !UPPERCASE.test(password)) {
    violations.push({ rule: "requireUppercase", message: "Must contain an uppercase letter" });
  }
  if (policy.requireNumber && !DIGIT.test(password)) {
    violations.push({ rule: "requireNumber", message: "Must contain a number" });
  }
  if (policy.requireSymbol && !SYMBOL.test(password)) {
    violations.push({ rule: "requireSymbol", message: "Must contain a symbol" });
  }

  return violations;
}

/** True when the password satisfies every rule in the policy. */
export function isPasswordValid(policy: PasswordRules, password: string): boolean {
  return passwordViolations(policy, password).length === 0;
}

/** The policy rendered as the requirement list shown under a password field. */
export function passwordRequirements(policy: PasswordRules): string[] {
  const requirements = [`At least ${policy.minLength} characters`];
  if (policy.requireUppercase) requirements.push("An uppercase letter");
  if (policy.requireNumber) requirements.push("A number");
  if (policy.requireSymbol) requirements.push("A symbol");
  return requirements;
}
