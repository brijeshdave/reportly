// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the SSO login flow against a mock OIDC provider: DB-driven
// provider wiring (enable via API reloads the auth instance), new-user
// provisioning (no groups -> no access), and account linking by verified email.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { db } from "@/core/db/index.js";
import { accounts, users } from "@/core/db/schema.js";
import { eq } from "drizzle-orm";
import { startMockOidc, type MockOidc } from "../../../../test/mock-oidc.js";
import { resetDb } from "../../../../test/reset-db.js";

const PROVIDER = "authentik";

let app: Awaited<ReturnType<typeof buildApp>>;
let idp: MockOidc;

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

async function enableProvider(issuer: string): Promise<void> {
  const password = await resetSuperadmin();
  const signIn = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: "admin@reportly.local", password },
  });
  const res = await app.inject({
    method: "PUT",
    url: `${API_PREFIX}/sso/providers/${PROVIDER}`,
    headers: { cookie: cookieFrom(signIn) },
    payload: { enabled: true, clientId: "cid", clientSecret: "sec", issuer },
  });
  expect(res.statusCode).toBe(200);
}

/** Drive the OIDC code flow to a session cookie (authorization step is mocked). */
async function ssoLogin(startCookie = ""): Promise<string> {
  const init = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/oauth2`,
    headers: startCookie ? { cookie: startCookie } : {},
    payload: { providerId: PROVIDER, callbackURL: "http://localhost:5173/" },
  });
  const authUrl = new URL((init.json() as { url: string }).url);
  const state = authUrl.searchParams.get("state") ?? "";
  const flowCookie = [startCookie, cookieFrom(init)].filter(Boolean).join("; ");

  const cb = await app.inject({
    method: "GET",
    url: `${API_PREFIX}/auth/oauth2/callback/${PROVIDER}?code=FAKE_CODE&state=${state}`,
    headers: { cookie: flowCookie },
  });
  expect([200, 302]).toContain(cb.statusCode);
  return cookieFrom(cb);
}

function getMe(cookie: string) {
  return app.inject({ method: "GET", url: `${API_PREFIX}/me`, headers: { cookie } });
}

describe("sso login", () => {
  it("provisions a new user with no access until assigned", async () => {
    idp = await startMockOidc({ email: "newsso@acme.test", name: "New SSO" });
    try {
      await enableProvider(idp.url);
      const sessionCookie = await ssoLogin();
      const me = await getMe(sessionCookie);
      expect(me.statusCode).toBe(200);
      const body = me.json();
      expect(body.user.email).toBe("newsso@acme.test");
      expect(body.isSuperadmin).toBe(false);
      expect(body.permissions).toEqual([]);
      expect(body.companies).toEqual([]);
    } finally {
      await idp.close();
    }
  });

  it("links the SSO login to an existing account with the same email", async () => {
    idp = await startMockOidc({ email: "linkme@acme.test", name: "Link Me" });
    try {
      // Pre-existing password account.
      const signUp = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sign-up/email`,
        payload: { email: "linkme@acme.test", password: "S3curePass!23", name: "Link Me" },
      });
      const existingId = (signUp.json() as { user: { id: string } }).user.id;
      // Linking is by *verified* email — verify the pre-existing account.
      await db.update(users).set({ emailVerified: true }).where(eq(users.id, existingId));

      await enableProvider(idp.url);
      const sessionCookie = await ssoLogin();
      const me = await getMe(sessionCookie);
      expect(me.json().user.id).toBe(existingId);

      // The SSO account is linked to the same user.
      const linked = await db.select().from(accounts).where(eq(accounts.userId, existingId));
      expect(linked.some((a) => a.providerId === PROVIDER)).toBe(true);
    } finally {
      await idp.close();
    }
  });
});
