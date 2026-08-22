// Author: Brijesh Dave <https://github.com/brijeshdave>
// Controlling what Reportly is allowed to send, and the trap underneath it.
//
// "There is no way to control and check emails like forgot password, resets" —
// reported from production. Two things follow from that, and only one of them is
// about email: a switch per kind of message, and a way to stop people resetting
// their own password at all.
import { PASSWORD_RESET, TRANSACTIONAL_MESSAGES } from "@reportly/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { db } from "@/core/db/index.js";
import { outboundMessages } from "@/core/db/schema.js";
import { setSystemSetting } from "@/core/settings/service.js";
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

const ALL_ON = {
  passwordReset: true,
  invite: true,
  twoFactorReset: true,
  verificationCode: true,
  notification: true,
};

function requestReset(email = "admin@reportly.local") {
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/request-password-reset`,
    payload: { email, redirectTo: "http://localhost:5100/reset-password" },
  });
}

async function invite(cookie: string, email: string) {
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/users/invite`,
    headers: { cookie },
    payload: { email, name: "Newcomer" },
  });
}

async function kinds(): Promise<string[]> {
  const rows = await db.select({ kind: outboundMessages.kind }).from(outboundMessages);
  return rows.map((row) => row.kind);
}

describe("switching a kind of message off", () => {
  it("stops that kind and leaves the others alone", async () => {
    const cookie = await superadmin();
    await setSystemSetting(TRANSACTIONAL_MESSAGES, { ...ALL_ON, passwordReset: false });

    await requestReset();
    expect(await kinds()).not.toContain("password-reset");

    expect((await invite(cookie, "newcomer@reportly.test")).statusCode).toBe(201);
    expect(await kinds()).toContain("invite");
  });
});

describe("switching self-service password reset off", () => {
  it("refuses the flow, rather than quietly not sending the email", async () => {
    // The distinction that matters. Dropping only the message leaves somebody
    // pressing a button, being told to check their inbox, and waiting for
    // something that was never sent.
    await setSystemSetting(PASSWORD_RESET, { allowSelfService: false });

    const refused = await requestReset();
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.message).toMatch(/administrator/i);
  });

  it("closes the older spelling of the same door", async () => {
    // better-auth answers on /forget-password too, so a rule naming only the
    // endpoint the web app happens to call is one anybody could walk around.
    await setSystemSetting(PASSWORD_RESET, { allowSelfService: false });

    const refused = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/forget-password`,
      payload: { email: "admin@reportly.local", redirectTo: "http://localhost:5100/x" },
    });
    expect(refused.statusCode).toBe(403);
  });

  it("still lets an administrator invite somebody", async () => {
    // The trap: an invitation is issued through the very same mechanism, so a
    // careless implementation would stop anybody new joining — silently.
    const cookie = await superadmin();
    await setSystemSetting(PASSWORD_RESET, { allowSelfService: false });

    expect((await invite(cookie, "newcomer@reportly.test")).statusCode).toBe(201);
    expect(await kinds()).toContain("invite");
  });

  it("tells the login screen not to offer the link", async () => {
    await setSystemSetting(PASSWORD_RESET, { allowSelfService: false });
    const config = await app.inject({ method: "GET", url: `${API_PREFIX}/auth-config` });
    expect(config.json().passwordResetEnabled).toBe(false);
  });

  it("is on by default, so nothing changes until somebody chooses", async () => {
    const config = await app.inject({ method: "GET", url: `${API_PREFIX}/auth-config` });
    expect(config.json().passwordResetEnabled).toBe(true);
    expect((await requestReset()).statusCode).toBe(200);
  });
});
