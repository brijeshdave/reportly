// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for an administrator setting a new password on another account —
// the way back in where the emailed link is not an option. The new password works, the
// old one stops working, and a password that fails the policy is refused.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const OLD_PW = "Str0ngPassw0rd!x";
const NEW_PW = "Fr3shPassw0rd!y";

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

async function superadmin(): Promise<string> {
  const password = await resetSuperadmin();
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: "admin@reportly.local", password },
  });
  return cookieFrom(res);
}

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie },
    payload: payload as object,
  });
}

const signIn = (email: string, password: string) =>
  app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email, password },
  });

describe("admin reset password", () => {
  it("sets a new password the user can sign in with, and retires the old one", async () => {
    const cookie = await superadmin();
    const id = (
      await inject("POST", "/users", cookie, {
        name: "Ada Lovelace",
        email: "ada@reportly.test",
        username: "ada",
        password: OLD_PW,
      })
    ).json().id;

    const reset = await inject("POST", `/users/${id}/reset-password`, cookie, { password: NEW_PW });
    expect(reset.statusCode).toBe(200);

    expect((await signIn("ada@reportly.test", NEW_PW)).statusCode).toBe(200);
    // The old password no longer works.
    expect((await signIn("ada@reportly.test", OLD_PW)).statusCode).not.toBe(200);
  });

  it("refuses a password that fails the policy", async () => {
    const cookie = await superadmin();
    const id = (
      await inject("POST", "/users", cookie, {
        name: "Grace Hopper",
        email: "grace@reportly.test",
        username: "grace",
        password: OLD_PW,
      })
    ).json().id;

    expect(
      (await inject("POST", `/users/${id}/reset-password`, cookie, { password: "weak" }))
        .statusCode,
    ).toBe(400);
  });
});
