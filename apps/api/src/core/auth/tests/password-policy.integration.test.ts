// Author: Brijesh Dave <https://github.com/brijeshdave>
// The password policy must be enforced by the server, not just by the sign-up
// form, and must follow the admin's settings without a restart.
import { PASSWORD_POLICY } from "@reportly/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { reloadAuth } from "@/core/auth/auth.js";
import { setSystemSetting } from "@/core/settings/service.js";
import { resetDb } from "../../../../test/reset-db.js";

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

function signUp(password: string, email = "policy@acme.test") {
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email, password, name: "Policy" },
  });
}

describe("password policy", () => {
  it("accepts a password meeting the default policy", async () => {
    const res = await signUp("Sup3rSecretPass");
    expect(res.statusCode).toBe(200);
  });

  it("rejects a password missing a number", async () => {
    const res = await signUp("NoDigitsInHereAtAll");
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("Must contain a number");
  });

  it("rejects a password missing an uppercase letter", async () => {
    const res = await signUp("n0uppercaseletters");
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("Must contain an uppercase letter");
  });

  it("reports every unmet rule in one response", async () => {
    const res = await signUp("short");
    const { message } = res.json();
    expect(message).toContain("at least 12 characters");
    expect(message).toContain("uppercase letter");
    expect(message).toContain("Must contain a number");
  });

  it("never echoes the submitted password back", async () => {
    const res = await signUp("short");
    expect(res.body).not.toContain("short");
  });

  it("follows a policy change without a restart", async () => {
    // A password that fails the default policy passes once symbols are the only
    // extra requirement and the minimum length drops.
    await setSystemSetting(PASSWORD_POLICY, {
      minLength: 8,
      requireUppercase: false,
      requireNumber: false,
      requireSymbol: true,
      expiryDays: 0,
      reuseCount: 3,
    });
    await reloadAuth();

    expect((await signUp("nouppercase")).statusCode).toBe(400);
    expect((await signUp("lowercase!")).statusCode).toBe(200);
  });

  it("enforces the policy on reset-password too", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/reset-password`,
      payload: { newPassword: "weak", token: "irrelevant" },
    });
    // Rejected on policy grounds before the token is ever consulted.
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("at least 12 characters");
  });

  it("still lets an existing password sign in after the policy tightens", async () => {
    await signUp("Sup3rSecretPass");

    await setSystemSetting(PASSWORD_POLICY, {
      minLength: 20,
      requireUppercase: true,
      requireNumber: true,
      requireSymbol: true,
      expiryDays: 0,
      reuseCount: 3,
    });
    await reloadAuth();

    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/email`,
      payload: { email: "policy@acme.test", password: "Sup3rSecretPass" },
    });
    expect(res.statusCode).toBe(200);
  });
});
