// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for contact-channel verification: what a channel reports, and
// the rules that make a short code safe — one live code, an attempt limit, a
// resend cooldown, and a proof that dies with the address it was sent to.
import { createHash } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { insertVerification } from "@/features/channels/repo.js";
import { resetDb } from "../../../../test/reset-db.js";

const SUPERADMIN_USER_ID = "00000000-0000-0000-0000-000000000001";
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

async function superadmin(): Promise<string> {
  const password = await resetSuperadmin();
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: SUPERADMIN_EMAIL, password },
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

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

/**
 * Put a code of our choosing on the account. The real one only ever leaves as a
 * hash, which is the point — so a test cannot read it back, and neither can
 * anyone who reaches the database.
 */
async function issueCode(destination: string, code: string, channel = "email" as const) {
  await insertVerification({
    userId: SUPERADMIN_USER_ID,
    channel,
    destination,
    codeHash: hash(code),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
}

describe("contact channels", () => {
  it("reports every channel, its address, and whether a provider can reach it", async () => {
    const cookie = await superadmin();
    const channels = (await inject("GET", "/me/channels", cookie)).json();
    const byName = Object.fromEntries(channels.map((c: { channel: string }) => [c.channel, c]));

    // The seeded superadmin's address is verified; nothing else is even set up.
    expect(byName.email).toMatchObject({ destination: SUPERADMIN_EMAIL, available: true });
    expect(byName.mobile).toMatchObject({ destination: null, verified: false });
    // No provider is configured out of the box, so these cannot be verified yet.
    expect(byName.whatsapp.available).toBe(false);
    expect(byName.telegram.available).toBe(false);
    expect(byName.discord.available).toBe(false);
  });

  it("sends a code to the email, then refuses a second one until the cooldown lapses", async () => {
    const cookie = await superadmin();
    // The seeded superadmin's email is already verified; unverify by changing it.
    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, {
      email: "changed@reportly.local",
    });

    const first = await inject("POST", "/me/channels/verify/request", cookie, {
      channel: "email",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ channel: "email" });
    expect(first.json().expiresAt).toBeTruthy();
    // The code itself must never come back in the response.
    expect(JSON.stringify(first.json())).not.toMatch(/code/i);

    const second = await inject("POST", "/me/channels/verify/request", cookie, {
      channel: "email",
    });
    expect(second.statusCode).toBe(429);
  });

  it("verifies the email when the right code is quoted back", async () => {
    const cookie = await superadmin();
    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, {
      email: "changed@reportly.local",
    });
    await issueCode("changed@reportly.local", "123456");

    const res = await inject("POST", "/me/channels/verify/confirm", cookie, {
      channel: "email",
      code: "123456",
    });
    expect(res.statusCode).toBe(200);
    const email = res.json().find((c: { channel: string }) => c.channel === "email");
    expect(email.verified).toBe(true);
  });

  it("burns the code after too many wrong guesses", async () => {
    const cookie = await superadmin();
    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, {
      email: "changed@reportly.local",
    });
    await issueCode("changed@reportly.local", "123456");

    // maxAttempts defaults to 5: four are refused with a count, the fifth burns it.
    for (let i = 0; i < 4; i += 1) {
      const wrong = await inject("POST", "/me/channels/verify/confirm", cookie, {
        channel: "email",
        code: "000000",
      });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().error.message).toMatch(/attempts left/);
    }
    const burned = await inject("POST", "/me/channels/verify/confirm", cookie, {
      channel: "email",
      code: "000000",
    });
    expect(burned.json().error.message).toMatch(/too many/i);

    // Even the right code is worthless now: it was spent.
    const right = await inject("POST", "/me/channels/verify/confirm", cookie, {
      channel: "email",
      code: "123456",
    });
    expect(right.statusCode).toBe(400);
  });

  it("will not confirm a code sent to an address that has since changed", async () => {
    const cookie = await superadmin();
    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, {
      email: "first@reportly.local",
    });
    await issueCode("first@reportly.local", "123456");

    // Move the address after the code went out.
    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, {
      email: "second@reportly.local",
    });

    const res = await inject("POST", "/me/channels/verify/confirm", cookie, {
      channel: "email",
      code: "123456",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/changed/i);
  });

  it("refuses a channel with no address, and one with no provider", async () => {
    const cookie = await superadmin();

    // No mobile on the account at all.
    const noAddress = await inject("POST", "/me/channels/verify/request", cookie, {
      channel: "mobile",
    });
    expect(noAddress.statusCode).toBe(400);
    expect(noAddress.json().error.message).toMatch(/mobile number first/i);

    // Now give it one, flagged for WhatsApp — but no provider is configured.
    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, {
      mobile: "+919876543210",
      whatsappOnMobile: true,
    });
    const noProvider = await inject("POST", "/me/channels/verify/request", cookie, {
      channel: "whatsapp",
    });
    expect(noProvider.statusCode).toBe(400);
    expect(noProvider.json().error.message).toMatch(/not configured/i);
  });

  it("drops a channel's proof when its address moves", async () => {
    const cookie = await superadmin();
    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, { mobile: "+919876543210" });
    await issueCode("+919876543210", "123456", "mobile" as never);
    // Prove the mobile directly (no SMS provider is configured in tests, so the
    // code is seeded rather than sent).
    const confirmed = await inject("POST", "/me/channels/verify/confirm", cookie, {
      channel: "mobile",
      code: "123456",
    });
    expect(confirmed.statusCode).toBe(200);
    expect(
      (await inject("GET", `/users/${SUPERADMIN_USER_ID}`, cookie)).json().mobileVerified,
    ).toBe(true);

    // A different number is a different thing to have proven.
    await inject("PATCH", `/users/${SUPERADMIN_USER_ID}`, cookie, { mobile: "+919999999999" });
    expect(
      (await inject("GET", `/users/${SUPERADMIN_USER_ID}`, cookie)).json().mobileVerified,
    ).toBe(false);
  });
});
