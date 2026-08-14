// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for debug mode: permission guard, expiry, the verbosity delta
// (extra "debug summary" log + x-debug header), and the rule that auth-route
// bodies are never logged.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { logDb } from "@/core/logdb/index.js";
import { appLogs } from "@/core/logdb/schema.js";
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

async function member(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email: "nobody@acme.test", password: "S3curePass!23", name: "Nobody" },
  });
  return cookieFrom(res);
}

const summaryFor = (requestId: string) =>
  logDb
    .select()
    .from(appLogs)
    .where(and(eq(appLogs.requestId, requestId), eq(appLogs.msg, "debug summary")));

async function waitForSummary(requestId: string, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await summaryFor(requestId);
    if (rows.length > 0) return rows;
    if (Date.now() > deadline) return [];
    await new Promise((r) => setTimeout(r, 50));
  }
}

function get(url: string, cookie: string, requestId?: string) {
  const headers: Record<string, string> = { cookie };
  if (requestId) headers["x-request-id"] = requestId;
  return app.inject({ method: "GET", url: `${API_PREFIX}${url}`, headers });
}

describe("debug mode", () => {
  it("denies enabling debug without the permission", async () => {
    const cookie = await member();
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/debug/enable`,
      headers: { cookie },
      payload: { scope: "user", minutes: 30 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("is off by default, and enabling adds the x-debug header plus a verbose summary", async () => {
    const cookie = await superadmin();
    expect((await get("/debug", cookie)).json().active).toBe(false);

    const quiet = await get("/me", cookie, "dbg-off");
    expect(quiet.headers["x-debug"]).toBeUndefined();
    await new Promise((r) => setTimeout(r, 250));
    expect((await summaryFor("dbg-off")).length).toBe(0);

    const enabled = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/debug/enable`,
      headers: { cookie },
      payload: { scope: "user", minutes: 30 },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().active).toBe(true);

    const loud = await get("/me", cookie, "dbg-on");
    expect(loud.headers["x-debug"]).toBe("on");
    const rows = await waitForSummary("dbg-on");
    expect(rows.length).toBe(1);
    const context = rows[0]!.context as { queries?: number; statusCode?: number };
    expect(context.statusCode).toBe(200);
    expect(context.queries).toBeGreaterThan(0);
  });

  it("respects the expiry: an expired switch is inactive", async () => {
    const cookie = await superadmin();
    const expired = new Date(Date.now() - 60_000).toISOString();
    const put = await app.inject({
      method: "PUT",
      url: `${API_PREFIX}/settings/me/debug/mode`,
      headers: { cookie },
      payload: { value: { enabled: true, expiresAt: expired } },
    });
    expect(put.statusCode).toBe(200);

    expect((await get("/debug", cookie)).json().active).toBe(false);
    const res = await get("/me", cookie, "dbg-expired");
    expect(res.headers["x-debug"]).toBeUndefined();
    await new Promise((r) => setTimeout(r, 250));
    expect((await summaryFor("dbg-expired")).length).toBe(0);
  });

  it("never logs auth-route bodies, but does log other request bodies", async () => {
    const cookie = await superadmin();
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/debug/enable`,
      headers: { cookie },
      payload: { scope: "system", minutes: 30 },
    });

    // Auth route: credentials must never reach a sink.
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/email`,
      headers: { "x-request-id": "dbg-auth", "content-type": "application/json" },
      payload: { email: "admin@reportly.local", password: "totally-wrong-password" },
    });
    const authRows = await waitForSummary("dbg-auth");
    expect(authRows.length).toBe(1);
    const authContext = authRows[0]!.context as Record<string, unknown>;
    expect(authContext).not.toHaveProperty("body");
    expect(JSON.stringify(authContext)).not.toContain("totally-wrong-password");

    // Non-auth route: the body is captured for debugging.
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/logs/client`,
      headers: { "x-request-id": "dbg-client", "content-type": "application/json" },
      payload: { msg: "hello from the browser" },
    });
    const clientRows = await waitForSummary("dbg-client");
    expect(clientRows.length).toBe(1);
    expect(JSON.stringify(clientRows[0]!.context)).toContain("hello from the browser");
  });
});
