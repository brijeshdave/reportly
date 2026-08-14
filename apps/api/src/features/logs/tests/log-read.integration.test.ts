// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the log read APIs: combined filters, the cursor-based
// polling tail, streamed export, permission gating, and the disabled /metrics route.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { logDb } from "@/core/logdb/index.js";
import { appLogs } from "@/core/logdb/schema.js";
import { tailLogs } from "@/features/logs/repo.js";
import { decodeCursor, encodeCursor } from "@/features/logs/service.js";
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

const get = (url: string, cookie: string) =>
  app.inject({ method: "GET", url: `${API_PREFIX}${url}`, headers: { cookie } });

/** Seed deterministic rows directly so tests don't depend on incidental logging. */
async function seedLogs() {
  await logDb.insert(appLogs).values([
    { level: "error", feature: "auth", msg: "auth blew up", requestId: "req-a" },
    { level: "info", feature: "auth", msg: "auth fine", requestId: "req-a" },
    { level: "error", feature: "email", msg: "email blew up", requestId: "req-b" },
  ]);
}

const filters = (f: unknown) => `filters=${encodeURIComponent(JSON.stringify(f))}`;

describe("log read APIs", () => {
  it("combines filters across fields", async () => {
    const cookie = await superadmin();
    await seedLogs();

    const res = await get(
      `/logs?pageSize=100&${filters([
        { field: "level", op: "eq", value: "error" },
        { field: "feature", op: "eq", value: "auth" },
      ])}`,
      cookie,
    );
    expect(res.statusCode).toBe(200);
    const msgs = res.json().data.map((r: { msg: string }) => r.msg);
    expect(msgs).toContain("auth blew up");
    expect(msgs).not.toContain("email blew up");
    expect(msgs).not.toContain("auth fine");

    const byRequest = await get(
      `/logs?pageSize=100&${filters([{ field: "requestId", op: "eq", value: "req-b" }])}`,
      cookie,
    );
    expect(byRequest.json().data.map((r: { msg: string }) => r.msg)).toEqual(["email blew up"]);
  });

  it("filters by a date range with the between operator", async () => {
    const cookie = await superadmin();
    // A timestamp column takes a Date, not the ISO string that arrives on the wire;
    // sending the string used to throw inside drizzle. These bracket the boundary.
    const old = new Date("2020-01-01T00:00:00.000Z");
    const recent = new Date();
    await logDb.insert(appLogs).values([
      { level: "info", feature: "test", msg: "ancient", ts: old },
      { level: "info", feature: "test", msg: "current", ts: recent },
    ]);

    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const inRange = await get(
      `/logs?pageSize=100&${filters([{ field: "ts", op: "between", value: [from, to] }])}`,
      cookie,
    );
    expect(inRange.statusCode).toBe(200);
    const msgs = inRange.json().data.map((r: { msg: string }) => r.msg);
    expect(msgs).toContain("current");
    expect(msgs).not.toContain("ancient");

    // An open upper bound ("since an hour ago") behaves the same on the low side.
    const openEnded = await get(
      `/logs?pageSize=100&${filters([{ field: "ts", op: "between", value: [from, ""] }])}`,
      cookie,
    );
    expect(openEnded.statusCode).toBe(200);
    expect(openEnded.json().data.map((r: { msg: string }) => r.msg)).not.toContain("ancient");
  });

  it("tails only new rows for a given cursor", async () => {
    const cookie = await superadmin();
    await seedLogs();

    const first = await get("/logs/tail?limit=100", cookie);
    expect(first.statusCode).toBe(200);
    const cursor = first.json().nextCursor as string;
    expect(cursor).toBeTruthy();
    const seen = (first.json().entries as { msg: string }[]).map((e) => e.msg);
    expect(seen).toEqual(expect.arrayContaining(["auth blew up", "email blew up"]));

    await logDb.insert(appLogs).values({ level: "warn", feature: "test", msg: "brand new" });

    // Only rows after the cursor come back — never anything already delivered.
    // (Serving the requests themselves also writes log rows, which is why we assert
    // on exclusion of prior rows rather than an exact count.)
    const next = await get(`/logs/tail?cursor=${encodeURIComponent(cursor)}`, cookie);
    const msgs = (next.json().entries as { msg: string }[]).map((e) => e.msg);
    expect(msgs).toContain("brand new");
    expect(msgs).not.toContain("auth blew up");
    expect(msgs).not.toContain("email blew up");
    expect(msgs).not.toContain("auth fine");
    expect(next.json().nextCursor).not.toBe(cursor);
  });

  it("never re-delivers a row written in the same instant as the cursor", async () => {
    // Driven through the repository, not HTTP, and deliberately so: serving a
    // request writes its own log rows, which land newer than the fixtures and
    // carry the cursor past them — hiding the very thing under test. The bug only
    // shows when the cursor IS one of the same-instant rows.
    //
    // `now()` is the transaction timestamp, so these two share a `ts` to the
    // microsecond (verified: both stored at ...118158). The cursor encodes
    // `toISOString()`, which is millisecond — so it says ...118, and
    // `ts > ...118` matches both rows again. A live tail showed duplicates.
    await logDb.insert(appLogs).values([
      { level: "info", feature: "tick", msg: "same-instant one" },
      { level: "info", feature: "tick", msg: "same-instant two" },
    ]);

    const page = await tailLogs(null, 500);
    const mine = page.filter((r) => r.feature === "tick");
    expect(mine).toHaveLength(2);

    // A cursor built from the newest row. Nothing has been written since, so the
    // next poll must be empty.
    const cursor = decodeCursor(encodeCursor(page[page.length - 1]!));
    const next = await tailLogs(cursor, 500);
    expect(next.filter((r) => r.feature === "tick").map((r) => r.msg)).toEqual([]);
    expect(next).toEqual([]);
  });

  it("streams a filtered export as csv and ndjson", async () => {
    const cookie = await superadmin();
    await seedLogs();

    const csv = await get(
      `/logs/export?format=csv&${filters([{ field: "feature", op: "eq", value: "email" }])}`,
      cookie,
    );
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\n")[0]).toBe("id,ts,level,feature,requestId,userId,msg");
    expect(csv.body).toContain("email blew up");
    expect(csv.body).not.toContain("auth blew up");

    const ndjson = await get("/logs/export?format=json", cookie);
    expect(ndjson.headers["content-type"]).toContain("application/x-ndjson");
    expect(JSON.parse(ndjson.body.trim().split("\n")[0]!)).toHaveProperty("msg");
  });

  it("denies log access without logs:view", async () => {
    const cookie = await member();
    expect((await get("/logs", cookie)).statusCode).toBe(403);
    expect((await get("/logs/tail", cookie)).statusCode).toBe(403);
  });

  it("keeps /metrics disabled by default", async () => {
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/metrics` });
    expect(res.statusCode).toBe(404);
  });
});
