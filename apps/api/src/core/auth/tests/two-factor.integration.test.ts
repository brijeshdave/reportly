// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the two-factor (TOTP) flow: enrol, challenge on sign-in,
// verify with a TOTP code, and recover with a backup code.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetDb } from "../../../../test/reset-db.js";
import { secretFromUri, totp } from "../../../../test/totp.js";

const PASSWORD = "S3curePass!23";
const EMAIL = "2fa@acme.test";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
});

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => String(c).split(";")[0]).join("; ");
}

function post(url: string, payload: unknown, cookie?: string) {
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth${url}`,
    headers: cookie ? { cookie } : {},
    payload: payload as object,
  });
}

async function signUp() {
  const res = await post("/sign-up/email", { email: EMAIL, password: PASSWORD, name: "TwoFA" });
  return cookieFrom(res);
}

describe("two-factor", () => {
  it("enrols, challenges on sign-in, and verifies with TOTP + backup code", async () => {
    const sessionCookie = await signUp();

    // 1. Enrol.
    const enableRes = await post("/two-factor/enable", { password: PASSWORD }, sessionCookie);
    expect(enableRes.statusCode).toBe(200);
    const enable = enableRes.json() as { totpURI: string; backupCodes: string[] };
    expect(enable.totpURI).toContain("otpauth://");
    expect(enable.backupCodes.length).toBeGreaterThan(0);
    const secret = secretFromUri(enable.totpURI);

    // Confirm enrolment with a first TOTP verification.
    await post("/two-factor/verify-totp", { code: totp(secret) }, sessionCookie);

    // 2. Sign in fresh — 2FA is now required (no full session yet).
    const signInRes = await post("/sign-in/email", { email: EMAIL, password: PASSWORD });
    const signInBody = signInRes.json() as { twoFactorRedirect?: boolean };
    expect(signInBody.twoFactorRedirect).toBe(true);
    const challengeCookie = cookieFrom(signInRes);

    // 3. Challenge: verify TOTP -> full session.
    const verifyRes = await post(
      "/two-factor/verify-totp",
      { code: totp(secret) },
      challengeCookie,
    );
    expect(verifyRes.statusCode).toBe(200);
    const meAfterTotp = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/me`,
      headers: { cookie: cookieFrom(verifyRes) },
    });
    expect(meAfterTotp.statusCode).toBe(200);

    // 4. Recovery: sign in again and use a backup code.
    const signIn2 = await post("/sign-in/email", { email: EMAIL, password: PASSWORD });
    const recRes = await post(
      "/two-factor/verify-backup-code",
      { code: enable.backupCodes[0] },
      cookieFrom(signIn2),
    );
    expect(recRes.statusCode).toBe(200);
  });

  it("rejects an invalid TOTP code", async () => {
    const sessionCookie = await signUp();
    const enable = (
      await post("/two-factor/enable", { password: PASSWORD }, sessionCookie)
    ).json() as { totpURI: string };
    const secret = secretFromUri(enable.totpURI);
    await post("/two-factor/verify-totp", { code: totp(secret) }, sessionCookie);

    const signInRes = await post("/sign-in/email", { email: EMAIL, password: PASSWORD });
    const bad = await post("/two-factor/verify-totp", { code: "000000" }, cookieFrom(signInRes));
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
  });
});
