// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the file sink, the optional Redis log buffer, and the
// retention sweep.
import { readdir, rm } from "node:fs/promises";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { env } from "@/core/env.js";
import { logDb } from "@/core/logdb/index.js";
import { appLogs } from "@/core/logdb/schema.js";
import { logger } from "@/core/logger.js";
import { LOG_BUFFER_KEY, flushLogBuffer } from "@/core/logging/buffer.js";
import { closeLogFile } from "@/core/logging/file-sink.js";
import { cleanupLogDatabase } from "@/core/logging/retention.js";
import { redis } from "@/core/redis.js";
import { resetDb } from "../../../../test/reset-db.js";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  closeLogFile();
  await app.close();
  await rm(env.LOG_DIR, { recursive: true, force: true });
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

function putSetting(cookie: string, key: string, value: unknown) {
  return app.inject({
    method: "PUT",
    url: `${API_PREFIX}/settings/logging/${key}`,
    headers: { cookie },
    payload: { value },
  });
}

describe("file sink", () => {
  it("writes a dated log file only while the sink is enabled", async () => {
    const cookie = await superadmin();
    expect(
      (await putSetting(cookie, "sinks", { console: false, file: true, database: false }))
        .statusCode,
    ).toBe(200);

    logger.info({ feature: "test" }, "to-the-file");
    await new Promise((r) => setTimeout(r, 200));

    const files = await readdir(env.LOG_DIR);
    expect(files.some((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))).toBe(true);
  });
});

describe("redis log buffer", () => {
  it("queues lines in redis and flushes them into the log database", async () => {
    const cookie = await superadmin();
    expect((await putSetting(cookie, "buffer", { enabled: true, batchSize: 50 })).statusCode).toBe(
      200,
    );

    logger.info({ feature: "test" }, "buffered-line");
    await new Promise((r) => setTimeout(r, 200));

    expect(await redis.llen(LOG_BUFFER_KEY)).toBeGreaterThan(0);
    // Nothing written directly to the database while buffering.
    expect(
      (await logDb.select().from(appLogs).where(eq(appLogs.msg, "buffered-line"))).length,
    ).toBe(0);

    const flushed = await flushLogBuffer(50);
    expect(flushed).toBeGreaterThan(0);
    expect(
      (await logDb.select().from(appLogs).where(eq(appLogs.msg, "buffered-line"))).length,
    ).toBeGreaterThan(0);
  });
});

describe("log retention", () => {
  it("deletes rows older than the retention window and keeps recent ones", async () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await logDb.insert(appLogs).values([
      { ts: old, level: "info", feature: "test", msg: "ancient", requestId: null },
      { level: "info", feature: "test", msg: "recent", requestId: null },
    ]);

    const removed = await cleanupLogDatabase(30);
    expect(removed).toBeGreaterThan(0);

    expect((await logDb.select().from(appLogs).where(eq(appLogs.msg, "ancient"))).length).toBe(0);
    expect((await logDb.select().from(appLogs).where(eq(appLogs.msg, "recent"))).length).toBe(1);
  });
});
