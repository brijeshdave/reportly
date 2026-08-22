// Author: Brijesh Dave <https://github.com/brijeshdave>
// Seeing a lockout, and undoing it.
//
// The half of the throttle that faces an administrator. `login-throttle` already
// proves the counting; this proves somebody can find out who is stuck and let them
// back in — which is the part that was missing when this was reported: correct
// passwords refused, and nothing to do but wait.
import { AUTH_RATE_LIMIT } from "@reportly/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { recordFailure } from "@/core/auth/login-throttle.js";
import { announceLockout } from "@/features/users/service.js";
import * as queue from "@/core/queue/notifications.js";
import { dispatch, type NotificationRequest } from "@/features/notifications/service.js";
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

/** Run something and collect the events it emitted, instead of queueing them. */
async function capture(run: () => Promise<void>): Promise<NotificationRequest[]> {
  const events: NotificationRequest[] = [];
  const spy = vi.spyOn(queue, "notify").mockImplementation(async (event) => {
    events.push(event as NotificationRequest);
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return events;
}

async function unreadCount(cookie: string): Promise<number> {
  const res = await get("/me/notifications/unread-count", cookie);
  return (res.json() as { unread: number }).unread;
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

describe("telling somebody a person is stuck", () => {
  it("reaches the people who can release them, and not the person locked out", async () => {
    // The complaint underneath this whole feature was that nobody *knew*: a badge
    // only helps somebody who is already looking at the roster.
    //
    // `notify` enqueues, and no worker runs in a test — so the event is captured
    // as the emitter produced it and then dispatched for real. That way this
    // covers both halves: what the emitter says, and who actually receives it.
    const admin = await superadmin();
    const target = await member();
    await lockOut(MEMBER_EMAIL);

    const events = await capture(() => announceLockout(MEMBER_EMAIL, IP));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "security.account-locked",
      companyId: null,
      subjectUserId: target.id,
      title: expect.stringMatching(/locked out of sign-in/i),
    });

    await dispatch(events[0]!);

    // The superadmin holds users:manage-2fa, so they are an operator here.
    expect(await unreadCount(admin)).toBeGreaterThan(0);
    // Not the locked-out person: they know, and they cannot reach their bell.
    expect(await unreadCount(target.cookie)).toBe(0);
  });

  it("says nothing when the identity matches nobody", async () => {
    // A stranger guessing at addresses is what the limit is for; it belongs in the
    // audit trail, not in an administrator's inbox.
    await member();
    await lockOut("nobody@reportly.test");

    expect(await capture(() => announceLockout("nobody@reportly.test", IP))).toEqual([]);
  });

  it("is announced once, by the attempt that closes the door", async () => {
    // An account being hammered would otherwise empty itself into every operator's
    // bell — one message per wrong password, for as long as it went on.
    await member();
    let announced = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const state = await recordFailure(MEMBER_EMAIL, IP, "sign-in");
      if (state.locked && state.attempts === state.max) announced += 1;
    }
    expect(announced).toBe(1);
  });
});
