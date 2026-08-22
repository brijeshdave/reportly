// Author: Brijesh Dave <https://github.com/brijeshdave>
// Calls into better-auth's endpoints, which it mounts under /api/v1/auth. Going
// through `http` rather than better-auth's own client keeps every request on one
// code path, so the x-request-id that traces browser -> API -> jobs is attached
// to auth calls too.
import type { PublicSsoProvider } from "@reportly/shared";

import { http } from "@/services/http.js";

const AUTH = "/auth";

/**
 * A sign-in that succeeded but is not yet a session: the account has 2FA on and
 * the server issued a challenge cookie instead.
 */
export interface SignInResult {
  twoFactorRequired: boolean;
}

interface SignInResponse {
  twoFactorRedirect?: boolean;
}

/**
 * Sign in with either an email address or a login name. They are different
 * endpoints on the server, and an "@" is the only thing that tells them apart — a
 * username cannot contain one (see usernameSchema), so the test is exact rather
 * than a guess.
 */
export async function signInWithPassword(
  identifier: string,
  password: string,
): Promise<SignInResult> {
  const value = identifier.trim();
  const body = value.includes("@")
    ? await http.post<SignInResponse>(`${AUTH}/sign-in/email`, { email: value, password })
    : await http.post<SignInResponse>(`${AUTH}/sign-in/username`, {
        username: value.toLowerCase(),
        password,
      });
  return { twoFactorRequired: body.twoFactorRedirect === true };
}

export async function signUpWithPassword(
  name: string,
  email: string,
  username: string,
  password: string,
): Promise<void> {
  await http.post(`${AUTH}/sign-up/email`, {
    name,
    email,
    username: username.trim().toLowerCase(),
    password,
  });
}

/** Completes a 2FA challenge with a time-based code from the authenticator app. */
export async function verifyTotp(code: string, trustDevice = false): Promise<void> {
  await http.post(`${AUTH}/two-factor/verify-totp`, { code, trustDevice });
}

/** Completes a 2FA challenge with one of the single-use recovery codes. */
export async function verifyBackupCode(code: string): Promise<void> {
  await http.post(`${AUTH}/two-factor/verify-backup-code`, { code });
}

/**
 * Always resolves, even for an unknown address: telling the caller whether an
 * account exists would let them enumerate users.
 */
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  await http.post(`${AUTH}/request-password-reset`, { email, redirectTo });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await http.post(`${AUTH}/reset-password`, { token, newPassword });
}

/* ----------------------------- account security ---------------------------- */

/**
 * Changing a password may revoke the other sessions. Default to doing so: if the
 * password is being changed because it leaked, leaving the thief signed in
 * defeats the point.
 */
export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
}): Promise<void> {
  await http.post(`${AUTH}/change-password`, {
    revokeOtherSessions: true,
    ...input,
  });
}

/** One of the caller's own sessions, from our endpoint (not better-auth's). */
export interface MySession {
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  /** True for the session on this device. */
  current: boolean;
}

/**
 * The caller's own sessions. Served from our own endpoint rather than
 * better-auth's list-sessions: it needs no elevated permission, has no session
 * freshness requirement (which was surfacing as an error), and flags the current
 * session so "this device" is obvious.
 */
export function fetchMySessions(): Promise<MySession[]> {
  return http.get<MySession[]>("/me/sessions");
}

export async function revokeMySession(token: string): Promise<void> {
  await http.post("/me/sessions/revoke", { token });
}

/** Signs out everywhere except here. */
export async function revokeOtherSessions(): Promise<void> {
  await http.post(`${AUTH}/revoke-other-sessions`);
}

export interface TwoFactorEnrolment {
  /** `otpauth://` URI for the authenticator app; also encoded as the QR image. */
  totpURI: string;
  /** Single-use codes, shown exactly once. */
  backupCodes: string[];
}

/**
 * Starts enrolment. Two-factor is not active until a first code is verified, so
 * a user who loses the QR before confirming is not locked out.
 */
export function startTwoFactorEnrolment(password: string): Promise<TwoFactorEnrolment> {
  return http.post<TwoFactorEnrolment>(`${AUTH}/two-factor/enable`, { password });
}

export async function disableTwoFactor(password: string): Promise<void> {
  await http.post(`${AUTH}/two-factor/disable`, { password });
}

/** Enabled providers only, for the sign-in buttons. Public; no session needed. */
export function fetchEnabledSsoProviders(): Promise<PublicSsoProvider[]> {
  return http.get<PublicSsoProvider[]>("/sso/enabled-providers");
}

/** Whether public self-service sign-up is offered. Public; no session needed. */
export interface AuthConfig {
  registrationEnabled: boolean;
  /** False when an administrator handles password resets themselves. */
  passwordResetEnabled: boolean;
}

export function fetchAuthConfig(): Promise<AuthConfig> {
  return http.get<AuthConfig>("/auth-config");
}

/**
 * Starts the OIDC dance. The server replies with the provider's authorize URL;
 * the browser leaves Reportly and returns to `callbackURL` once the IdP is done.
 */
export async function signInWithSso(providerId: string, callbackURL: string): Promise<void> {
  const { url } = await http.post<{ url: string }>(`${AUTH}/sign-in/oauth2`, {
    providerId,
    callbackURL,
  });
  window.location.assign(url);
}
