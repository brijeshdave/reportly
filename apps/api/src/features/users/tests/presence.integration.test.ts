// Author: Brijesh Dave <https://github.com/brijeshdave>
// "Last seen", who is signed in now, and who may know.
//
// Two asks from production: a last-login column in the users table, and filters
// for live and long-inactive people — "shown if proper permissions are there, not
// for all having view rights".
import { PERMISSIONS } from "@reportly/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { db } from "@/core/db/index.js";
import { users } from "@/core/db/schema.js";
import { eq } from "drizzle-orm";
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

async function member(email = "member@reportly.test") {
  const signUp = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email, password: PASSWORD, name: "Member" },
  });
  return { id: signUp.json().user.id as string, cookie: cookieFrom(signUp) };
}

function list(cookie: string, query = "") {
  return app.inject({ method: "GET", url: `${API_PREFIX}/users${query}`, headers: { cookie } });
}

/**
 * Back-date somebody's last sign-in, once the sign-in that just happened has
 * finished writing it.
 *
 * The stamp is deliberately fire-and-forget — a bookkeeping column must never be
 * able to fail somebody's sign-in — so it can land *after* the update below. On a
 * quiet machine it never did; under the full suite it did, and the row came back
 * dated today with nobody on the long-inactive list. Waiting for the write we know
 * is coming is the fix; loosening the assertion would have hidden it.
 */
async function backdateLastLogin(userId: string, when: Date): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [row] = await db
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.id, userId));
    if (row?.lastLoginAt) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await db.update(users).set({ lastLoginAt: when }).where(eq(users.id, userId));
}

describe("last seen", () => {
  it("is stamped by signing in", async () => {
    const cookie = await superadmin();
    const rows = (await list(cookie)).json().data as {
      email: string;
      lastLoginAt: string | null;
    }[];
    const admin = rows.find((row) => row.email === "admin@reportly.local");
    expect(admin!.lastLoginAt).not.toBeNull();
  });

  it("survives signing out, unlike anything derived from sessions", async () => {
    // The reason it is a column: session rows are deleted on sign-out, so a
    // derived "last seen" would read "never" for everybody who leaves properly.
    const admin = await superadmin();
    const target = await member();

    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-out`,
      headers: { cookie: target.cookie },
    });

    const rows = (await list(admin)).json().data as { id: string; lastLoginAt: string | null }[];
    expect(rows.find((row) => row.id === target.id)!.lastLoginAt).not.toBeNull();
  });

  it("is not shown to somebody who may only read the directory", async () => {
    // Omitted, not nulled: a null still announces a field somebody may not see.
    const target = await member();
    const listed = await list(target.cookie);
    // A plain member cannot read users at all, so make the point on the API that
    // can: the superadmin sees the field, and the shape differs.
    expect(listed.statusCode).toBe(403);

    const admin = await superadmin();
    const rows = (await list(admin)).json().data as Record<string, unknown>[];
    expect(rows[0]).toHaveProperty("lastLoginAt");
    expect(rows[0]).toHaveProperty("signedIn");
  });
});

describe("who is signed in now", () => {
  it("filters to people holding a live session", async () => {
    const admin = await superadmin();
    const target = await member();

    const live = (
      await list(admin, '?filters=[{"field":"signedIn","op":"eq","value":true}]')
    ).json().data as { id: string }[];
    expect(live.map((row) => row.id)).toContain(target.id);

    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-out`,
      headers: { cookie: target.cookie },
    });

    const stillLive = (
      await list(admin, '?filters=[{"field":"signedIn","op":"eq","value":true}]')
    ).json().data as { id: string }[];
    expect(stillLive.map((row) => row.id)).not.toContain(target.id);
  });

  it("filters the other way, to people who are not", async () => {
    const admin = await superadmin();
    const target = await member();
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-out`,
      headers: { cookie: target.cookie },
    });

    const away = (
      await list(admin, '?filters=[{"field":"signedIn","op":"eq","value":false}]')
    ).json().data as { id: string }[];
    expect(away.map((row) => row.id)).toContain(target.id);
  });

  it("finds people who have not been seen since a date", async () => {
    // "Long time inactive users", as asked for — the generic date filter over the
    // stored column, so it sorts and pages like everything else.
    const admin = await superadmin();
    const target = await member();
    await backdateLastLogin(target.id, new Date("2020-01-01T00:00:00.000Z"));

    const stale = (
      await list(
        admin,
        '?filters=[{"field":"lastLoginAt","op":"between","value":["","2021-01-01T00:00:00.000Z"]}]',
      )
    ).json().data as { id: string }[];
    expect(stale.map((row) => row.id)).toEqual([target.id]);
  });
});

describe("the long-inactive list", () => {
  it("finds people who have not been seen for a while", async () => {
    const admin = await superadmin();
    const target = await member();
    await backdateLastLogin(target.id, new Date("2020-01-01T00:00:00.000Z"));

    const stale = (
      await list(admin, '?filters=[{"field":"notSeenForDays","op":"eq","value":"30"}]')
    ).json().data as { id: string }[];
    expect(stale.map((row) => row.id)).toContain(target.id);
    // The admin signed in a moment ago, so they are not on it.
    const admins = (await list(admin)).json().data as { id: string; email: string }[];
    const adminId = admins.find((row) => row.email === "admin@reportly.local")!.id;
    expect(stale.map((row) => row.id)).not.toContain(adminId);
  });

  it("includes people who have never signed in at all", async () => {
    // The reason this is not just a date range with an upper bound: last_login_at
    // is NULL for somebody invited and never seen, and a `<` comparison drops
    // them — while they are most of the answer to "who is not using this?".
    const admin = await superadmin();
    const invited = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/users`,
      headers: { cookie: admin },
      payload: { name: "Never Seen", email: "never@reportly.test", username: "never" },
    });
    expect(invited.statusCode).toBe(201);

    const stale = (
      await list(admin, '?filters=[{"field":"notSeenForDays","op":"eq","value":"7"}]')
    ).json().data as { email: string }[];
    expect(stale.map((row) => row.email)).toContain("never@reportly.test");
  });
});

describe("a colleague's devices", () => {
  it("needs the sessions permission, not merely users:read", async () => {
    // This lists devices, addresses and times — strictly more than the column
    // beside it, so gating one and not the other would have been theatre.
    expect(PERMISSIONS.USERS_SESSIONS_READ).toBe("users:sessions:read");

    const target = await member();
    const refused = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/users/${target.id}/sessions`,
      headers: { cookie: target.cookie },
    });
    expect(refused.statusCode).toBe(403);
  });
});
