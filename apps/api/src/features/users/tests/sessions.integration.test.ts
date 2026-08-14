// Author: Brijesh Dave <https://github.com/brijeshdave>
// better-auth's admin plugin published ~15 routes that authorised on a `users.role`
// column instead of our groups: they bypassed the password policy, wrote no audit
// events, and kept a second `banned` status beside ours. It is unmounted. Session
// listing — the one capability we wanted — lives here, gated and audited.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const EMAIL = "member@acme.test";
const PASSWORD = "Sup3rSecretPass";

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

const signIn = (email: string, password: string) =>
  app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email, password },
  });

async function superadmin(): Promise<string> {
  const password = await resetSuperadmin();
  return cookieFrom(await signIn("admin@reportly.local", password));
}

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

/** /me without a company header: a member belongs to no company here. */
const me = (cookie: string) =>
  app.inject({ method: "GET", url: `${API_PREFIX}/me`, headers: { cookie } });

async function member(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email: EMAIL, password: PASSWORD, name: "Member" },
  });
  return (res.json() as { user: { id: string } }).user.id;
}

describe("the admin plugin", () => {
  it.each([
    "/auth/admin/list-users",
    "/auth/admin/list-user-sessions",
    "/auth/admin/set-user-password",
    "/auth/admin/impersonate-user",
    "/auth/admin/ban-user",
    "/auth/admin/remove-user",
    "/auth/admin/set-role",
  ])("no longer serves %s", async (path) => {
    const cookie = await superadmin();
    // A parallel admin surface that answered to a different column than can().
    for (const method of ["GET", "POST"] as const) {
      const res = await inject(method, path, cookie, {});
      expect(res.statusCode).toBe(404);
    }
  });
});

describe("listing sessions", () => {
  it("shows a user's live sessions", async () => {
    const admin = await superadmin();
    const id = await member(); // signing up already opens one session
    await signIn(EMAIL, PASSWORD); // a second device

    const res = await inject("GET", `/users/${id}/sessions`, admin);
    expect(res.statusCode).toBe(200);

    const sessions = res.json();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toHaveProperty("createdAt");
    expect(sessions[0]).toHaveProperty("expiresAt");
  });

  it("needs users:read", async () => {
    const id = await member();
    const cookie = cookieFrom(await signIn(EMAIL, PASSWORD));

    // The member is in no group, so holds no permissions at all.
    expect((await inject("GET", `/users/${id}/sessions`, cookie)).statusCode).toBe(403);
  });

  it("404s for an unknown user", async () => {
    const admin = await superadmin();
    const res = await inject("GET", "/users/11111111-2222-3333-4444-555555555555/sessions", admin);
    expect(res.statusCode).toBe(404);
  });
});

describe("revoking a session", () => {
  it("signs that device out and leaves the others alone", async () => {
    const admin = await superadmin();
    const id = await member();
    // Sign-up opened the first session; this is the second device.
    const second = cookieFrom(await signIn(EMAIL, PASSWORD));

    const sessions = (await inject("GET", `/users/${id}/sessions`, admin)).json();
    expect(sessions).toHaveLength(2);
    expect((await me(second)).statusCode).toBe(200);

    // Sessions come back newest first, so [0] is the second device.
    await inject("POST", `/users/${id}/sessions/revoke`, admin, { token: sessions[0].token });

    // Exactly one session was revoked, not all of them.
    expect((await inject("GET", `/users/${id}/sessions`, admin)).json()).toHaveLength(1);
  });

  it("signs out the device whose token was revoked", async () => {
    const admin = await superadmin();
    const id = await member();
    const device = cookieFrom(await signIn(EMAIL, PASSWORD));
    expect((await me(device)).statusCode).toBe(200);

    // The newest session belongs to `device`; sessions are returned newest first.
    const newest = (await inject("GET", `/users/${id}/sessions`, admin)).json()[0];
    await inject("POST", `/users/${id}/sessions/revoke`, admin, { token: newest.token });

    expect((await me(device)).statusCode).toBe(401);
  });

  it("refuses a token belonging to another user", async () => {
    const admin = await superadmin();
    const id = await member(); // one session, from the sign-up

    const before = (await inject("GET", `/users/${id}/sessions`, admin)).json();
    expect(before).toHaveLength(1);
    const adminId = (await me(admin)).json().user.id;

    // The token must belong to the user in the path, or anyone able to revoke
    // their own session could revoke someone else's by presenting their id.
    const res = await inject("POST", `/users/${adminId}/sessions/revoke`, admin, {
      token: before[0].token,
    });
    expect(res.statusCode).toBe(404);

    expect((await inject("GET", `/users/${id}/sessions`, admin)).json()).toHaveLength(1);
  });

  it("writes an audit event, without the token", async () => {
    const admin = await superadmin();
    const id = await member();
    const token = (await inject("GET", `/users/${id}/sessions`, admin)).json()[0].token;

    await inject("POST", `/users/${id}/sessions/revoke`, admin, { token });

    const events = (await inject("GET", "/audit-events", admin)).json();
    const revoke = events.data.find(
      (event: { action: string }) => event.action === "user.session.revoke",
    );
    expect(revoke).toBeDefined();
    // A session token is a bearer credential until it expires.
    expect(JSON.stringify(revoke)).not.toContain(token);
  });
});
