// Author: Brijesh Dave <https://github.com/brijeshdave>
// Seeing a lockout, and undoing it.
//
// The half of the throttle that faces an administrator. `login-throttle` already
// proves the counting; this proves somebody can find out who is stuck and let them
// back in — which is the part that was missing when this was reported: correct
// passwords refused, and nothing to do but wait.
import { AUTH_RATE_LIMIT } from "@reportly/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { recordFailure } from "@/core/auth/login-throttle.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { setSystemSetting } from "@/core/settings/service.js";
import { resetDb } from "../../../../test/reset-db.js";

const PASSWORD = "Str0ngPassw0rd!x";
const MEMBER_EMAIL = "member@reportly.test";
const IP = "203.0.113.7";

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
  await setSystemSetting(AUTH_RATE_LIMIT, { signInMax: 3, signInWindowSeconds: 60 });
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

/** A plain member: in no group, so they hold no permissions at all. */
async function member(): Promise<{ id: string; cookie: string }> {
  const signUp = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email: MEMBER_EMAIL, password: PASSWORD, name: "Member" },
  });
  return { id: signUp.json().user.id as string, cookie: cookieFrom(signUp) };
}

/** Spend their allowance, the way three wrong passwords would. */
async function lockOut(identity: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await recordFailure(identity, IP, "sign-in");
  }
}

function get(url: string, cookie: string) {
  return app.inject({ method: "GET", url: `${API_PREFIX}${url}`, headers: { cookie } });
}

describe("the lockout list", () => {
  it("names the person behind the counter, not the identity they typed", async () => {
    const admin = await superadmin();
    const target = await member();
    await lockOut(MEMBER_EMAIL);

    const res = await get("/users/locked-out", admin);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { userId: target.id, attempts: 3, max: 3, retryAfterSeconds: expect.any(Number) },
    ]);
  });

  it("finds them whatever they capitalised, because sign-in does not care either", async () => {
    const admin = await superadmin();
    const target = await member();
    await lockOut(MEMBER_EMAIL.toUpperCase());

    const listed = get("/users/locked-out", admin);
    expect((await listed).json()).toMatchObject([{ userId: target.id }]);
  });

  it("ignores an identity that matches nobody", async () => {
    // Somebody guessing at an address that does not exist. There is no row to hang
    // it on, and it is not a fact about any of these people.
    const admin = await superadmin();
    await member();
    await lockOut("nobody@reportly.test");

    expect((await get("/users/locked-out", admin)).json()).toEqual([]);
  });

  it("says nothing to somebody who cannot release anybody", async () => {
    const target = await member();
    await lockOut(MEMBER_EMAIL);

    // A plain member holds no permissions: whether a colleague keeps failing their
    // password is not part of reading the directory.
    expect((await get("/users/locked-out", target.cookie)).statusCode).toBe(403);
  });

  it("empties once the lock is released", async () => {
    const admin = await superadmin();
    const target = await member();
    await lockOut(MEMBER_EMAIL);

    const released = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/users/${target.id}/unlock`,
      headers: { cookie: admin },
    });
    expect(released.statusCode).toBe(200);
    expect(released.json().cleared).toBeGreaterThan(0);

    expect((await get("/users/locked-out", admin)).json()).toEqual([]);
  });
});
