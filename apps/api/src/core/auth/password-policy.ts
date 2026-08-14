// Author: Brijesh Dave <https://github.com/brijeshdave>
// Enforces the configured password policy on every endpoint that accepts a new
// password. better-auth natively checks only minimum length, so the complexity
// rules would otherwise be advisory: the sign-up form would show them and the
// server would accept anything. Reuse is checked here too, because it needs the
// plaintext password and the user's history at the same moment.
import { ERROR_CODES, passwordViolations, type PasswordPolicy } from "@reportly/shared";
import { APIError, createAuthMiddleware } from "better-auth/api";

import { getAuth } from "@/core/auth/auth.js";
import { isPasswordReused } from "@/core/auth/password-history.js";

/**
 * Endpoints that carry a new password, and the body field it arrives in. Paths
 * are relative to the auth base path. Sign-in is absent on purpose — an existing
 * password must still work after the policy is tightened.
 */
const PASSWORD_FIELD_BY_PATH: Record<string, string> = {
  "/sign-up/email": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
  "/set-password": "newPassword",
};

/** The new password in this request, or null when the request carries none. */
function newPasswordIn(path: string, body: unknown): string | null {
  const field = PASSWORD_FIELD_BY_PATH[path];
  if (!field || typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Which user this password is being set for. A sign-up has no history, so it has
 * no user to resolve.
 */
async function resolveUserId(ctx: any): Promise<string | null> {
  if (ctx.path === "/sign-up/email") return null;

  if (ctx.path === "/reset-password") {
    // The handler consumes this token; reading it here must not.
    const token = ctx.body?.token ?? ctx.query?.token;
    if (typeof token !== "string") return null;
    const verification = await ctx.context.internalAdapter.findVerificationValue(
      `reset-password:${token}`,
    );
    return typeof verification?.value === "string" ? verification.value : null;
  }

  // change-password and set-password act on the caller. Their own session
  // middleware has not run yet at this point, so resolve it ourselves.
  const session = await getAuth().api.getSession({ headers: ctx.headers });
  return session?.user.id ?? null;
}

/**
 * A `hooks.before` middleware rejecting passwords that violate `policy`. The
 * policy is captured at build time; `reloadAuth()` rebuilds the instance when an
 * admin changes it, so the live rules are never stale.
 */
export function passwordPolicyHook(policy: PasswordPolicy) {
  return createAuthMiddleware(async (ctx: any) => {
    const password = newPasswordIn(ctx.path, ctx.body);
    if (password === null) return;

    const violations = passwordViolations(policy, password);
    if (violations.length > 0) {
      // The messages describe the policy, never the password itself.
      throw new APIError("BAD_REQUEST", {
        code: "PASSWORD_POLICY_VIOLATION",
        message: violations.map((violation) => violation.message).join(". "),
        violations: violations.map((violation) => violation.rule),
      });
    }

    if (policy.reuseCount <= 0) return;

    const userId = await resolveUserId(ctx);
    if (!userId) return;

    const reused = await isPasswordReused(
      userId,
      password,
      policy.reuseCount,
      ctx.context.password.verify,
    );
    if (reused) {
      throw new APIError("BAD_REQUEST", {
        code: ERROR_CODES.PASSWORD_REUSED,
        message: `Choose a password you have not used in your last ${policy.reuseCount}.`,
      });
    }
  });
}
