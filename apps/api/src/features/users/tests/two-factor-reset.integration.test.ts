// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the two-factor recovery path: an administrator removing a
// second factor from someone who has lost it, who may do that, and what it costs
// the account it is done to.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { db } from "@/core/db/index.js";
import { users } from "@/core/db/schema.js";
import { eq } from "drizzle-orm";
import { resetDb } from "../../../../test/reset-db.js";
import { secretFromUri, totp } from "../../../../test/totp.js";

const PASSWORD = "Str0ngPassw0rd!x";
const MEMBER_EMAIL = "member@reportly.test";

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

/** A plain member: signed up, in no group, so they hold no permissions at all. */
async function member(): Promise<{ id: string; cookie: string }> {
  const signUp = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email: MEMBER_EMAIL, password: PASSWORD, name: "Member" },
  });
  const id = signUp.json().user.id as string;
  return { id, cookie: cookieFrom(signUp) };
}

/**
 * Enrol them in two-factor, the way the account itself would, and return the
 * session they are left holding.
 *
 * Enabling alone does not count: better-auth only marks the factor active once a
 * first code has been verified, so losing the QR before confirming cannot lock
 * anyone out. Verifying issues a fresh session cookie, so the one from sign-up is
 * spent — hence returning the new one rather than reusing the caller's.
 */
async function enrol(cookie: string): Promise<string> {
  const enable = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/two-factor/enable`,
    headers: { cookie },
    payload: { password: PASSWORD },
  });
  expect(enable.statusCode).toBe(200);

  const secret = secretFromUri((enable.json() as { totpURI: string }).totpURI);
  const verify = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/two-factor/verify-totp`,
    headers: { cookie },
    payload: { code: totp(secret) },
  });
  expect(verify.statusCode).toBe(200);
  return cookieFrom(verify) || cookie;
}

async function twoFactorOn(id: string): Promise<boolean> {
  const [row] = await db
    .select({ enabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.id, id));
  return row?.enabled ?? false;
}

describe("resetting a user's two-factor", () => {
  it("removes it, so someone who lost their device can enrol again", async () => {
    const admin = await superadmin();
    const target = await member();
    await enrol(target.cookie);
    expect(await twoFactorOn(target.id)).toBe(true);

    const res = await inject("POST", `/users/${target.id}/two-factor/reset`, admin);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ wasEnabled: true });
    expect(res.json().user.twoFactorEnabled).toBe(false);
    expect(await twoFactorOn(target.id)).toBe(false);
  });

  it("signs the account out everywhere, so no session outlives the factor", async () => {
    const admin = await superadmin();
    const target = await member();
    const live = await enrol(target.cookie);

    // Their session works before the reset...
    expect((await inject("GET", "/me", live)).statusCode).toBe(200);
    await inject("POST", `/users/${target.id}/two-factor/reset`, admin);
    // ...and is gone after it. A "trust this device" cookie would otherwise skip
    // the challenge for a factor that no longer exists.
    expect((await inject("GET", "/me", live)).statusCode).toBe(401);
  });

  it("says plainly when there was no two-factor to remove", async () => {
    const admin = await superadmin();
    const target = await member();

    const res = await inject("POST", `/users/${target.id}/two-factor/reset`, admin);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ wasEnabled: false });
  });

  it("refuses a caller who does not hold users:manage-2fa", async () => {
    const target = await member();
    const live = await enrol(target.cookie);

    // They are in no group, so they hold nothing — including over themselves. A
    // user cannot strip their own second factor here either: that is what
    // /auth/two-factor/disable is for, and it demands the factor still works.
    const res = await inject("POST", `/users/${target.id}/two-factor/reset`, live);
    expect(res.statusCode).toBe(403);
    expect(await twoFactorOn(target.id)).toBe(true);
  });

  it("is 404 for a user who does not exist", async () => {
    const admin = await superadmin();
    const res = await inject(
      "POST",
      "/users/00000000-0000-0000-0000-0000000000ff/two-factor/reset",
      admin,
    );
    expect(res.statusCode).toBe(404);
  });
});
