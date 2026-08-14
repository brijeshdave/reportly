// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the logging core: request-id propagation into the log
// database, runtime sink toggling via settings, and central redaction.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { logDb } from "@/core/logdb/index.js";
import { appLogs } from "@/core/logdb/schema.js";
import { logger } from "@/core/logger.js";
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

/** Log writes are fire-and-forget; poll until they land (or give up). */
async function waitForLogs(
  predicate: () => Promise<{ length: number }>,
  timeoutMs = 3000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await predicate();
    if (rows.length > 0) return rows.length;
    if (Date.now() > deadline) return 0;
    await new Promise((r) => setTimeout(r, 50));
  }
}

const logsForRequest = (requestId: string) =>
  logDb.select().from(appLogs).where(eq(appLogs.requestId, requestId));

describe("logging core", () => {
  it("writes request logs to the log database, tagged with the request id", async () => {
    const requestId = "trace-log-alpha";
    await app.inject({
      method: "GET",
      url: `${API_PREFIX}/health`,
      headers: { "x-request-id": requestId },
    });

    expect(await waitForLogs(() => logsForRequest(requestId))).toBeGreaterThan(0);
    const [row] = await logsForRequest(requestId);
    expect(row!.requestId).toBe(requestId);
    expect(row!.level).toBeTruthy();
  });

  it("stops writing to the log database when the sink is switched off", async () => {
    const cookie = await superadmin();
    const off = await app.inject({
      method: "PUT",
      url: `${API_PREFIX}/settings/logging/sinks`,
      headers: { cookie },
      payload: { value: { console: true, file: false, database: false } },
    });
    expect(off.statusCode).toBe(200);

    const requestId = "trace-log-beta";
    await app.inject({
      method: "GET",
      url: `${API_PREFIX}/health`,
      headers: { "x-request-id": requestId },
    });

    // Give any in-flight write a chance, then assert nothing was persisted.
    await new Promise((r) => setTimeout(r, 300));
    expect((await logsForRequest(requestId)).length).toBe(0);
  });

  it("redacts sensitive fields before they reach any sink", async () => {
    logger.info({ user: { password: "hunter2" }, feature: "test" }, "redact-check");

    const found = await waitForLogs(() =>
      logDb.select().from(appLogs).where(eq(appLogs.msg, "redact-check")),
    );
    expect(found).toBeGreaterThan(0);

    const [row] = await logDb.select().from(appLogs).where(eq(appLogs.msg, "redact-check"));
    const context = row!.context as { user?: { password?: string } };
    expect(context.user?.password).toBe("[redacted]");
    expect(JSON.stringify(row!.context)).not.toContain("hunter2");
  });
});
