// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the SSO provider management API: permission gating,
// secret redaction, and the enable-when-complete rule over HTTP.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetDb } from "../../../../test/reset-db.js";

const SUPERADMIN_EMAIL = "admin@reportly.local";

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

async function superadminCookie(): Promise<string> {
  const password = await resetSuperadmin();
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: SUPERADMIN_EMAIL, password },
  });
  return cookieFrom(res);
}

async function memberCookie(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email: "nobody@acme.test", password: "S3curePass!23", name: "Nobody" },
  });
  return cookieFrom(res);
}

function req(method: "GET" | "PUT", url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method,
    url: `${API_PREFIX}${url}`,
    headers: { cookie },
    payload: payload as object,
  });
}

describe("sso providers API", () => {
  it("lists providers with secrets redacted (superadmin)", async () => {
    const cookie = await superadminCookie();
    const res = await req("GET", "/sso/providers", cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual([
      "auth0",
      "authentik",
      "clerk",
      "google",
      "microsoft",
    ]);
    expect(body.google).not.toHaveProperty("clientSecret");
    expect(body.google.clientSecretSet).toBe(false);
    expect(body.google.enabled).toBe(false);
  });

  it("rejects enabling an incomplete provider", async () => {
    const cookie = await superadminCookie();
    const res = await req("PUT", "/sso/providers/google", cookie, { enabled: true });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("enables a complete provider and reflects it (secret redacted)", async () => {
    const cookie = await superadminCookie();
    const put = await req("PUT", "/sso/providers/google", cookie, {
      enabled: true,
      clientId: "cid",
      clientSecret: "sec",
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ enabled: true, clientId: "cid", clientSecretSet: true });
    expect(put.json()).not.toHaveProperty("clientSecret");

    const list = (await req("GET", "/sso/providers", cookie)).json();
    expect(list.google.enabled).toBe(true);
  });

  it("returns 404 for an unknown provider", async () => {
    const cookie = await superadminCookie();
    const res = await req("PUT", "/sso/providers/facebook", cookie, { enabled: false });
    expect(res.statusCode).toBe(404);
  });

  it("denies a user without settings permissions", async () => {
    const cookie = await memberCookie();
    expect((await req("GET", "/sso/providers", cookie)).statusCode).toBe(403);
    expect((await req("PUT", "/sso/providers/google", cookie, { enabled: false })).statusCode).toBe(
      403,
    );
  });
});
