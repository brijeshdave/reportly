// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reuse and expiry are the two password rules that cannot be judged from the
// password string alone. Both were stored-but-unenforced settings until now, so
// every path that sets a password is checked here — including the ones that write
// the row directly and bypass better-auth's hooks.
import { PASSWORD_POLICY } from "@reportly/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { reloadAuth } from "@/core/auth/auth.js";
import { isPasswordExpired, passwordSetAt } from "@/core/auth/password-history.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { db } from "@/core/db/index.js";
import { passwordHistory, users } from "@/core/db/schema.js";
import { setSystemSetting } from "@/core/settings/service.js";
import { resetDb } from "../../../../test/reset-db.js";

const EMAIL = "history@acme.test";
const FIRST = "Sup3rSecretPass";
const SECOND = "An0therGoodPass";
const THIRD = "Y3tAnotherPassOk";

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

async function signUp(password = FIRST): Promise<string> {
  const res = await post("/sign-up/email", { email: EMAIL, password, name: "History" });
  return cookieFrom(res);
}

async function userId(): Promise<string> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
  return row!.id;
}

async function historyCount(id: string): Promise<number> {
  const rows = await db
    .select({ id: passwordHistory.id })
    .from(passwordHistory)
    .where(eq(passwordHistory.userId, id));
  return rows.length;
}

/** Pins the whole policy, so a test states the rule it depends on rather than
 * inheriting the registry defaults (expiry off, reuse window of 3). */
async function setPolicy(overrides: { expiryDays?: number; reuseCount?: number }) {
  await setSystemSetting(PASSWORD_POLICY, {
    minLength: 12,
    requireUppercase: true,
    requireNumber: true,
    requireSymbol: false,
    expiryDays: 0,
    reuseCount: 0,
    ...overrides,
  });
  await reloadAuth();
}

/** Backdate the user's newest history row, so their password looks old. */
async function agePasswordByDays(id: string, days: number) {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await db.update(passwordHistory).set({ createdAt: when }).where(eq(passwordHistory.userId, id));
}

describe("recording", () => {
  it("records the password chosen at sign-up", async () => {
    await signUp();
    const id = await userId();

    expect(await historyCount(id)).toBe(1);
    expect(await passwordSetAt(id)).toBeInstanceOf(Date);
  });

  it("records each new password on change", async () => {
    const cookie = await signUp();
    const id = await userId();

    const res = await post(
      "/change-password",
      { currentPassword: FIRST, newPassword: SECOND },
      cookie,
    );
    expect(res.statusCode).toBe(200);
    expect(await historyCount(id)).toBe(2);
  });

  it("records the password the superadmin CLI generates", async () => {
    // This path writes the account row directly, so better-auth's hooks never run.
    await resetSuperadmin();
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "admin@reportly.local"));

    expect(await historyCount(admin!.id)).toBe(1);
  });

  it("does not record the same hash twice", async () => {
    const cookie = await signUp();
    const id = await userId();

    // A profile update touches the user, not the credential account.
    await app.inject({
      method: "PATCH",
      url: `${API_PREFIX}/me/profile`,
      headers: { cookie },
      payload: { name: "Renamed" },
    });

    expect(await historyCount(id)).toBe(1);
  });
});

describe("reuse", () => {
  it("is enforced out of the box: the registry default is a window of 3", async () => {
    const cookie = await signUp();
    const res = await post(
      "/change-password",
      { currentPassword: FIRST, newPassword: FIRST },
      cookie,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("PASSWORD_REUSED");
  });

  it("can be switched off with a window of 0", async () => {
    await setPolicy({ reuseCount: 0 });
    const cookie = await signUp();

    const res = await post(
      "/change-password",
      { currentPassword: FIRST, newPassword: FIRST },
      cookie,
    );
    expect(res.statusCode).toBe(200);
  });

  it("refuses the password currently in use", async () => {
    await setPolicy({ reuseCount: 2 });
    const cookie = await signUp();

    const res = await post(
      "/change-password",
      { currentPassword: FIRST, newPassword: FIRST },
      cookie,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("PASSWORD_REUSED");
  });

  it("refuses a password from within the reuse window", async () => {
    await setPolicy({ reuseCount: 2 });
    const cookie = await signUp();

    await post("/change-password", { currentPassword: FIRST, newPassword: SECOND }, cookie);
    const res = await post(
      "/change-password",
      { currentPassword: SECOND, newPassword: FIRST },
      cookie,
    );

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("PASSWORD_REUSED");
  });

  it("allows a password that has fallen out of the window", async () => {
    await setPolicy({ reuseCount: 1 });
    const cookie = await signUp();

    // Window of 1 means only the current password is barred.
    await post("/change-password", { currentPassword: FIRST, newPassword: SECOND }, cookie);
    const res = await post(
      "/change-password",
      { currentPassword: SECOND, newPassword: THIRD },
      cookie,
    );
    expect(res.statusCode).toBe(200);
  });

  it("never leaks the old password back to the caller", async () => {
    await setPolicy({ reuseCount: 2 });
    const cookie = await signUp();

    const res = await post(
      "/change-password",
      { currentPassword: FIRST, newPassword: FIRST },
      cookie,
    );
    expect(res.body).not.toContain(FIRST);
  });

  it("applies to the reset-password flow, which has no session", async () => {
    await setPolicy({ reuseCount: 2 });
    await signUp();

    // Resolve the reset token the way the emailed link carries it.
    const auth = (await import("@/core/auth/auth.js")).getAuth();
    const ctx = await auth.$context;
    const token = "reuse-token";
    await ctx.internalAdapter.createVerificationValue({
      identifier: `reset-password:${token}`,
      value: await userId(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await post("/reset-password", { token, newPassword: FIRST });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("PASSWORD_REUSED");
  });
});

describe("expiry", () => {
  it("is off by default, however old the password", async () => {
    await signUp();
    const id = await userId();
    await agePasswordByDays(id, 3650);

    expect(await isPasswordExpired(id, 0)).toBe(false);
  });

  it("treats a password with no recorded history as current", async () => {
    // A user who predates this feature must not be locked out.
    await signUp();
    const id = await userId();
    await db.delete(passwordHistory).where(eq(passwordHistory.userId, id));

    expect(await isPasswordExpired(id, 30)).toBe(false);
  });

  it("expires a password older than the limit", async () => {
    await signUp();
    const id = await userId();

    await agePasswordByDays(id, 31);
    expect(await isPasswordExpired(id, 30)).toBe(true);

    await agePasswordByDays(id, 29);
    expect(await isPasswordExpired(id, 30)).toBe(false);
  });

  it("refuses every feature route while the password is expired", async () => {
    await setPolicy({ expiryDays: 30 });
    const cookie = await signUp();
    await agePasswordByDays(await userId(), 31);

    const res = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/companies`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PASSWORD_EXPIRED");
  });

  it("still serves /me, so the app can send the user to change it", async () => {
    await setPolicy({ expiryDays: 30 });
    const cookie = await signUp();
    await agePasswordByDays(await userId(), 31);

    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/me`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().passwordExpired).toBe(true);
  });

  it("lets the user out of it by changing their password", async () => {
    await setPolicy({ expiryDays: 30 });
    const cookie = await signUp();
    await agePasswordByDays(await userId(), 31);

    const changed = await post(
      "/change-password",
      { currentPassword: FIRST, newPassword: SECOND },
      cookie,
    );
    expect(changed.statusCode).toBe(200);

    // The new password resets the clock, and the API opens back up.
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/me`, headers: { cookie } });
    expect(res.json().passwordExpired).toBe(false);
  });

  it("reports a fresh password as current", async () => {
    await setPolicy({ expiryDays: 30 });
    const cookie = await signUp();

    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/me`, headers: { cookie } });
    expect(res.json().passwordExpired).toBe(false);
  });
});
