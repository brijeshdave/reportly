// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for users: standard list query, activate/deactivate, the
// last-superadmin guard, and profile self-service.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const SUPERADMIN_ID = "00000000-0000-0000-0000-000000000001";

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

async function signUp(email: string): Promise<{ cookie: string; id: string }> {
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email, password: "S3curePass!23", name: "User" },
  });
  return { cookie: cookieFrom(res), id: (res.json() as { user: { id: string } }).user.id };
}

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie },
    payload: payload as object,
  });
}

describe("users", () => {
  it("lists and searches users with the standard query", async () => {
    const cookie = await superadmin();
    await signUp("alice@acme.test");

    const page = await inject("GET", "/users?pageSize=5&sortBy=email", cookie);
    expect(page.statusCode).toBe(200);
    expect(page.json().total).toBeGreaterThanOrEqual(2);

    const search = await inject(
      "GET",
      `/users?filters=${encodeURIComponent(JSON.stringify([{ field: "email", op: "contains", value: "alice" }]))}`,
      cookie,
    );
    expect(search.json().data.map((u: { email: string }) => u.email)).toEqual(["alice@acme.test"]);
  });

  it("deactivates and reactivates a user", async () => {
    const cookie = await superadmin();
    const { id } = await signUp("bob@acme.test");

    expect((await inject("POST", `/users/${id}/deactivate`, cookie)).json().status).toBe(
      "inactive",
    );
    expect((await inject("POST", `/users/${id}/reactivate`, cookie)).json().status).toBe("active");
  });

  it("refuses to deactivate the last superadmin", async () => {
    const cookie = await superadmin();
    const res = await inject("POST", `/users/${SUPERADMIN_ID}/deactivate`, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("lets a user update their own profile", async () => {
    const { cookie } = await signUp("carol@acme.test");
    const res = await inject("PATCH", "/me/profile", cookie, { name: "Carol Q" });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Carol Q");
  });

  it("invites a user and initiates the set-password flow", async () => {
    const cookie = await superadmin();
    const invited = await inject("POST", "/users/invite", cookie, {
      email: "dave@acme.test",
      name: "Dave",
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.json()).toMatchObject({ email: "dave@acme.test", status: "active" });

    // Appears in the user list (no password/account yet; access granted later).
    const list = await inject("GET", "/users?pageSize=100", cookie);
    expect(list.json().data.map((u: { email: string }) => u.email)).toContain("dave@acme.test");

    // Inviting the same email again conflicts.
    expect(
      (await inject("POST", "/users/invite", cookie, { email: "dave@acme.test", name: "D" }))
        .statusCode,
    ).toBe(409);
  });
});
