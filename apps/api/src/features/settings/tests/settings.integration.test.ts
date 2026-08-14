// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the settings API: seeded defaults, validation, cache
// invalidation on write, permission gating, and user-override rules.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
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

async function member(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email: "nobody@acme.test", password: "S3curePass!23", name: "Nobody" },
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

describe("settings API", () => {
  it("exposes seeded defaults", async () => {
    const cookie = await superadmin();
    const all = await inject("GET", "/settings", cookie);
    expect(all.statusCode).toBe(200);
    expect(all.json().map((s: { key: string }) => s.key)).toEqual(
      expect.arrayContaining(["passwordPolicy", "session", "rateLimit", "invite"]),
    );

    const one = await inject("GET", "/settings/auth/passwordPolicy", cookie);
    expect(one.json().value).toMatchObject({ minLength: 12, requireNumber: true });
  });

  it("validates writes and reflects them immediately (cache invalidated)", async () => {
    const cookie = await superadmin();

    const bad = await inject("PUT", "/settings/auth/passwordPolicy", cookie, {
      value: { minLength: 4 },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const ok = await inject("PUT", "/settings/auth/passwordPolicy", cookie, {
      value: { minLength: 20, requireSymbol: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().value).toMatchObject({ minLength: 20, requireSymbol: true });

    // A subsequent read must return the new value, not a stale cached one.
    const reread = await inject("GET", "/settings/auth/passwordPolicy", cookie);
    expect(reread.json().value).toMatchObject({ minLength: 20, requireSymbol: true });
  });

  it("lets any authenticated user read their own overridable preferences", async () => {
    // A brand-new user has no groups and therefore no settings:read permission,
    // but must still be able to load their theme and table preferences.
    const cookie = await member();
    expect((await inject("GET", "/settings", cookie)).statusCode).toBe(403);

    const mine = await inject("GET", "/settings/me", cookie);
    expect(mine.statusCode).toBe(200);
    const keys = mine.json().map((s: { key: string }) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["theme", "tableDefaults"]));
    // Only user-overridable settings are exposed here.
    expect(keys).not.toContain("passwordPolicy");

    const theme = mine.json().find((s: { key: string }) => s.key === "theme");
    expect(theme.value).toMatchObject({ palette: "aurora", mode: "system" });
  });

  it("returns 404 for an unknown setting", async () => {
    const cookie = await superadmin();
    expect((await inject("GET", "/settings/auth/nope", cookie)).statusCode).toBe(404);
  });

  it("applies a password policy change without a restart", async () => {
    const cookie = await superadmin();
    const signUp = (email: string, password: string) =>
      app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sign-up/email`,
        payload: { email, password, name: "PW" },
      });

    // Default minLength is 12, so a 13-character password is accepted.
    expect((await signUp("pw1@acme.test", "S3curePass!23")).statusCode).toBe(200);

    // Raising the minimum rebuilds the live auth instance immediately.
    const put = await inject("PUT", "/settings/auth/passwordPolicy", cookie, {
      value: { minLength: 24 },
    });
    expect(put.statusCode).toBe(200);

    // The same password is now rejected — no restart required.
    expect((await signUp("pw2@acme.test", "S3curePass!23")).statusCode).toBeGreaterThanOrEqual(400);
    expect((await signUp("pw3@acme.test", "S3curePass!23-and-then-some")).statusCode).toBe(200);
  });

  it("rejects a per-user override of a system-only setting", async () => {
    const cookie = await superadmin();
    const res = await inject("PUT", "/settings/me/auth/passwordPolicy", cookie, {
      value: { minLength: 20 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("denies reads and writes without settings permissions", async () => {
    const cookie = await member();
    expect((await inject("GET", "/settings", cookie)).statusCode).toBe(403);
    expect(
      (await inject("PUT", "/settings/auth/passwordPolicy", cookie, { value: { minLength: 20 } }))
        .statusCode,
    ).toBe(403);
  });
});
