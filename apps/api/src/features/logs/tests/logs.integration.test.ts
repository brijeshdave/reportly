// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the client log reporter and request-id tracing: one id
// must appear on the API log, the client log, and the background job it spawns.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { logDb } from "@/core/logdb/index.js";
import { appLogs } from "@/core/logdb/schema.js";
import { getEmailQueue } from "@/core/queue/email.js";
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

async function waitFor<T>(query: () => Promise<T[]>, timeoutMs = 3000): Promise<T[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await query();
    if (rows.length > 0) return rows;
    if (Date.now() > deadline) return [];
    await new Promise((r) => setTimeout(r, 50));
  }
}

function postClientLog(requestId: string, body: unknown) {
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/logs/client`,
    headers: { "x-request-id": requestId },
    payload: body as object,
  });
}

describe("client log reporter", () => {
  it("accepts a client log and stores it with feature=client and the request id", async () => {
    const requestId = "trace-client-1";
    const res = await postClientLog(requestId, {
      level: "error",
      msg: "widget exploded",
      context: { component: "Widget" },
    });
    expect(res.statusCode).toBe(202);

    const rows = await waitFor(() =>
      logDb
        .select()
        .from(appLogs)
        .where(and(eq(appLogs.requestId, requestId), eq(appLogs.feature, "client"))),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.msg).toBe("widget exploded");
    expect(rows[0]!.level).toBe("error");
  });

  it("validates the body", async () => {
    expect((await postClientLog("trace-client-2", { msg: "" })).statusCode).toBe(400);
    expect((await postClientLog("trace-client-3", { level: "nope", msg: "x" })).statusCode).toBe(
      400,
    );
  });

  it("rate-limits client log reporting", async () => {
    let limited = false;
    for (let i = 0; i < 35; i++) {
      const res = await postClientLog(`trace-rl-${i}`, { msg: "spam" });
      if (res.statusCode === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  it("propagates the request id into the background email job", async () => {
    const requestId = "trace-job-1";
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/request-password-reset`,
      headers: { "x-request-id": requestId, "content-type": "application/json" },
      payload: { email: "admin@reportly.local", redirectTo: "http://localhost:5173/reset" },
    });
    expect(res.statusCode).toBe(200);

    const jobs = await getEmailQueue().getJobs(["waiting", "delayed", "active"]);
    const job = jobs.find((j) => j.data.to === "admin@reportly.local");
    expect(job).toBeDefined();
    expect(job!.data.requestId).toBe(requestId);
  });
});
