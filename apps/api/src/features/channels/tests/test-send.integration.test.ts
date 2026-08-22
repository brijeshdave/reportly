// Author: Brijesh Dave <https://github.com/brijeshdave>
// Proving a channel works, and saying so honestly when it does not.
//
// Written because `cli doctor` reported "smtp.resend.com:465 accepted the
// connection" while the provider refused every message for an unauthorised
// domain. A handshake is not a delivery.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { db } from "@/core/db/index.js";
import { outboundMessages } from "@/core/db/schema.js";
import * as mailer from "@/core/mail/mailer.js";
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
  vi.restoreAllMocks();
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

function test_(cookie: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/channels/test`,
    headers: { cookie },
    payload: body,
  });
}

async function logged() {
  return db
    .select({
      kind: outboundMessages.kind,
      status: outboundMessages.status,
      error: outboundMessages.error,
      destination: outboundMessages.destination,
    })
    .from(outboundMessages);
}

describe("sending a test message", () => {
  it("sends to the caller's own address when none is given", async () => {
    const cookie = await superadmin();
    const sent = vi.spyOn(mailer, "sendEmail").mockResolvedValue(undefined);

    const res = await test_(cookie, { channel: "email" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ delivered: true, error: null });
    expect(res.json().destination).toBe("admin@reportly.local");
    expect(sent).toHaveBeenCalledOnce();
  });

  it("hands back the provider's own words when it is refused", async () => {
    // The entire reason this exists. Not "delivery failed" — the sentence that
    // names the actual problem.
    const cookie = await superadmin();
    const refusal =
      "API key not authorized for this domain: the API key used is not authorized to send emails from rayzon.example";
    vi.spyOn(mailer, "sendEmail").mockRejectedValue(new Error(refusal));

    const res = await test_(cookie, { channel: "email" });
    // 200, not 502: the test ran and its answer is "refused". A failed request
    // would hide the very text somebody needs.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ delivered: false, error: refusal });
  });

  it("records the attempt either way, so the failure is on the Messages screen too", async () => {
    const cookie = await superadmin();
    vi.spyOn(mailer, "sendEmail").mockRejectedValue(new Error("relay said no"));
    await test_(cookie, { channel: "email", destination: "somebody@elsewhere.test" });

    const rows = await logged();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "test", status: "failed", error: "relay said no" });
    // Redacted here as everywhere: the row never held the address.
    expect(rows[0]!.destination).toBe("s•••@elsewhere.test");
  });

  it("does not go through the queue, so the answer is the provider's and not 'accepted'", async () => {
    // A queued send would return before anything reached the relay, and the test
    // would pass while every message was being refused — which is exactly the
    // week this feature exists to prevent.
    const cookie = await superadmin();
    vi.spyOn(mailer, "sendEmail").mockRejectedValue(new Error("refused at send time"));

    const res = await test_(cookie, { channel: "email" });
    expect(res.json().delivered).toBe(false);
  });

  it("is refused to somebody who does not configure the installation", async () => {
    const signUp = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-up/email`,
      payload: { email: "member@reportly.test", password: "Str0ngPassw0rd!x", name: "Member" },
    });
    const res = await test_(cookieFrom(signUp), { channel: "email" });
    expect(res.statusCode).toBe(403);
  });

  it("says so plainly when there is nowhere to send", async () => {
    const cookie = await superadmin();
    const res = await test_(cookie, { channel: "telegram" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/no telegram destination/i);
  });
});
