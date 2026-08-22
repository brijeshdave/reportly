// Author: Brijesh Dave <https://github.com/brijeshdave>
// What Reportly sent, and whether it arrived.
//
// The fault this closes: every email went through the queue to nodemailer and
// nothing survived the job, so "did their password reset go out?" was answerable
// only by asking them — and a provider's refusal reached a log nobody read.
import { MESSAGE_RETENTION } from "@reportly/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { markFailed, markSent, recordQueued } from "@/core/messages/record.js";
import { cleanupOutboundMessages } from "@/core/logging/retention.js";
import { db } from "@/core/db/index.js";
import { outboundMessages } from "@/core/db/schema.js";
import { setSystemSetting } from "@/core/settings/service.js";
import { eq, sql } from "drizzle-orm";
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

describe("the outbound message log", () => {
  it("never stores the address it sent to", async () => {
    // Redacted at the point of writing, not at the point of display: a row that
    // never held the address cannot leak it later, however the screen changes.
    const id = await recordQueued({
      channel: "email",
      kind: "password-reset",
      destination: "banti.patel@rayzon.example",
      subject: "Reset your password",
    });

    const [row] = await db
      .select({ destination: outboundMessages.destination })
      .from(outboundMessages)
      .where(eq(outboundMessages.id, id!));
    expect(row!.destination).toBe("b•••@rayzon.example");
    expect(row!.destination).not.toContain("banti.patel");
  });

  it("keeps the provider's refusal word for word", async () => {
    // The whole reason to have this. "API key not authorized for this domain" is
    // the entire diagnosis; a tidied "delivery failed" would have cost days.
    const refusal =
      "API key not authorized for this domain: the API key used is not authorized to send emails from rayzon.example";
    const id = await recordQueued({
      channel: "email",
      kind: "invite",
      destination: "someone@rayzon.example",
      subject: "You have been invited",
    });
    await markFailed(id, new Error(refusal));

    const [row] = await db
      .select({ status: outboundMessages.status, error: outboundMessages.error })
      .from(outboundMessages)
      .where(eq(outboundMessages.id, id!));
    expect(row!.status).toBe("failed");
    expect(row!.error).toBe(refusal);
  });

  it("records a real password reset as one, and an invitation as an invitation", async () => {
    // Both go through better-auth's requestPasswordReset — the same mechanism —
    // so without telling them apart the log would report every invitation as a
    // password reset, and "did their invite go out?" would have no answer again.
    const admin = await superadmin();
    const invited = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/users/invite`,
      headers: { cookie: admin },
      payload: { email: "newcomer@reportly.test", name: "Newcomer" },
    });
    expect(invited.statusCode).toBe(201);

    // The endpoint the web app actually calls. better-auth answers on
    // /forget-password too, and using that spelling here would have tested a door
    // nobody walks through.
    const reset = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/request-password-reset`,
      payload: {
        email: "admin@reportly.local",
        redirectTo: "http://localhost:5100/reset-password",
      },
    });
    expect(reset.statusCode).toBe(200);

    const rows = await db
      .select({ kind: outboundMessages.kind, subject: outboundMessages.subject })
      .from(outboundMessages);
    const kinds = rows.map((row) => row.kind);
    expect(kinds).toContain("invite");
    expect(kinds).toContain("password-reset");
  });

  it("writes nothing for a channel whose retention is off", async () => {
    // "Keep this for zero days" is answered by not writing it, rather than by
    // writing it and deleting it later.
    await setSystemSetting(MESSAGE_RETENTION, {
      email: 0,
      mobile: 30,
      whatsapp: 30,
      telegram: 30,
      discord: 30,
    });

    expect(
      await recordQueued({
        channel: "email",
        kind: "notification",
        destination: "nobody@reportly.test",
        subject: "Something happened",
      }),
    ).toBeNull();

    const [counted] = await db.select({ count: sql<number>`count(*)::int` }).from(outboundMessages);
    expect(counted!.count).toBe(0);
  });

  it("prunes each channel on its own clock", async () => {
    // An email row carries a provider's refusal and is worth months; a WhatsApp
    // line mirroring a bell notification is noise after a fortnight.
    await setSystemSetting(MESSAGE_RETENTION, {
      email: 90,
      mobile: 30,
      whatsapp: 1,
      telegram: 30,
      discord: 30,
    });

    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    for (const channel of ["email", "whatsapp"] as const) {
      const id = await recordQueued({
        channel,
        kind: "notification",
        destination: channel === "email" ? "a@b.test" : "+919876543210",
      });
      await db.update(outboundMessages).set({ queuedAt: old }).where(eq(outboundMessages.id, id!));
    }

    expect(await cleanupOutboundMessages()).toBe(1);

    const left = await db.select({ channel: outboundMessages.channel }).from(outboundMessages);
    expect(left.map((row) => row.channel)).toEqual(["email"]);
  });

  it("is readable by whoever may read the logs, and nobody else", async () => {
    const admin = await superadmin();
    const id = await recordQueued({
      channel: "email",
      kind: "two-factor-reset",
      destination: "someone@reportly.test",
      subject: "Your two-factor was removed",
    });
    await markSent(id);

    const listed = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/messages`,
      headers: { cookie: admin },
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json() as { data: { kind: string; status: string; subject: string }[] };
    expect(body.data.some((row) => row.kind === "two-factor-reset" && row.status === "sent")).toBe(
      true,
    );

    // A plain member holds no permissions at all.
    const signUp = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-up/email`,
      payload: { email: "member@reportly.test", password: "Str0ngPassw0rd!x", name: "Member" },
    });
    const refused = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/messages`,
      headers: { cookie: cookieFrom(signUp) },
    });
    expect(refused.statusCode).toBe(403);
  });
});
