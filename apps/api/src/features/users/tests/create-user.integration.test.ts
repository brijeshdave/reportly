// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for creating a user directly (the alternative to inviting):
// the login name, the two password paths, and the gate on an administrator-chosen
// password.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const PASSWORD = "Str0ngPassw0rd!x";

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

const newUser = (over: Record<string, unknown> = {}) => ({
  name: "Ada Lovelace",
  email: "ada@reportly.test",
  username: "ada",
  ...over,
});

describe("creating a user directly", () => {
  it("creates one with a password they can immediately sign in with", async () => {
    const cookie = await superadmin();
    const created = await inject("POST", "/users", cookie, newUser({ password: PASSWORD }));
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ username: "ada", email: "ada@reportly.test" });

    const signIn = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/email`,
      payload: { email: "ada@reportly.test", password: PASSWORD },
    });
    expect(signIn.statusCode).toBe(200);
  });

  it("lets that user sign in with their username instead of their email", async () => {
    const cookie = await superadmin();
    await inject("POST", "/users", cookie, newUser({ password: PASSWORD }));

    const signIn = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/username`,
      payload: { username: "ada", password: PASSWORD },
    });
    expect(signIn.statusCode).toBe(200);
  });

  it("makes them replace an administrator-chosen password before the app opens", async () => {
    const cookie = await superadmin();
    await inject("POST", "/users", cookie, newUser({ password: PASSWORD }));

    const signIn = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/username`,
      payload: { username: "ada", password: PASSWORD },
    });
    const theirs = cookieFrom(signIn);

    // /me still answers — it is how the app learns to send them to change it.
    const me = await inject("GET", "/me", theirs);
    expect(me.statusCode).toBe(200);
    expect(me.json().passwordExpired).toBe(true);

    // Everything else is closed until they choose their own.
    expect((await inject("GET", "/me/channels", theirs)).statusCode).toBe(403);

    const changed = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/change-password`,
      headers: { cookie: theirs },
      payload: { currentPassword: PASSWORD, newPassword: "An0therGoodPass!" },
    });
    expect(changed.statusCode).toBe(200);

    // With a password of their own, the gate lifts.
    const after = await inject("GET", "/me", theirs);
    expect(after.json().passwordExpired).toBe(false);
    expect((await inject("GET", "/me/channels", theirs)).statusCode).toBe(200);
  });

  it("creates one without a password (a set-password link is emailed)", async () => {
    const cookie = await superadmin();
    const created = await inject("POST", "/users", cookie, newUser());
    expect(created.statusCode).toBe(201);

    // No credential exists, so the password they do not have cannot sign them in.
    const signIn = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/username`,
      payload: { username: "ada", password: PASSWORD },
    });
    expect(signIn.statusCode).not.toBe(200);
  });

  it("refuses a duplicate email or username, and says which", async () => {
    const cookie = await superadmin();
    expect((await inject("POST", "/users", cookie, newUser())).statusCode).toBe(201);

    const sameEmail = await inject("POST", "/users", cookie, newUser({ username: "ada2" }));
    expect(sameEmail.statusCode).toBe(409);
    expect(sameEmail.json().error.message).toMatch(/email/i);

    const sameUsername = await inject(
      "POST",
      "/users",
      cookie,
      newUser({ email: "other@reportly.test" }),
    );
    expect(sameUsername.statusCode).toBe(409);
    expect(sameUsername.json().error.message).toMatch(/username/i);
  });

  it("rejects a password that breaks the policy", async () => {
    const cookie = await superadmin();
    const res = await inject("POST", "/users", cookie, newUser({ password: "short" }));
    expect(res.statusCode).toBe(400);
  });

  it("stores the contact channels, unverified", async () => {
    const cookie = await superadmin();
    const created = await inject(
      "POST",
      "/users",
      cookie,
      newUser({
        mobile: "+919876543210",
        whatsappOnMobile: true,
        telegramOnMobile: true,
        discordHandle: "ada.dev",
      }),
    );
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      mobile: "+919876543210",
      whatsappOnMobile: true,
      telegramOnMobile: true,
      discordHandle: "ada.dev",
      mobileVerified: false,
      whatsappVerified: false,
      discordVerified: false,
    });
  });

  it("rejects a mobile that is not in international format", async () => {
    const cookie = await superadmin();
    const res = await inject("POST", "/users", cookie, newUser({ mobile: "9876543210" }));
    expect(res.statusCode).toBe(400);
  });
});
