// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the audit trail and change history: one audit row per
// mutation, field-level diff correctness, permission gating, and streamed export.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { db } from "@/core/db/index.js";
import { auditEvents } from "@/core/db/schema.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

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

function inject(
  method: string,
  url: string,
  cookie: string,
  payload?: unknown,
  companyId?: string,
) {
  const headers: Record<string, string> = { cookie };
  if (companyId) headers["x-company-id"] = companyId;
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers,
    payload: payload as object,
  });
}

const countAction = async (action: string) =>
  (await db.select().from(auditEvents).where(eq(auditEvents.action, action))).length;

describe("audit trail", () => {
  it("writes exactly one audit row per mutation", async () => {
    const cookie = await superadmin();

    const company = (await inject("POST", "/companies", cookie, { name: "Audited" })).json();
    await inject("PATCH", `/companies/${company.id}`, cookie, { name: "Audited 2" });
    await inject("DELETE", `/companies/${company.id}`, cookie);
    await inject("POST", "/groups", cookie, { name: "Auditors" });
    await inject("PUT", "/settings/auth/passwordPolicy", cookie, { value: { minLength: 14 } });

    expect(await countAction("company.create")).toBe(1);
    expect(await countAction("company.update")).toBe(1);
    expect(await countAction("company.delete")).toBe(1);
    expect(await countAction("group.create")).toBe(1);
    expect(await countAction("setting.update")).toBe(1);
  });

  it("lists audit events and denies callers without audit:view", async () => {
    const cookie = await superadmin();
    await inject("POST", "/groups", cookie, { name: "Listed" });

    const list = await inject("GET", "/audit-events?pageSize=100", cookie);
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBeGreaterThan(0);
    expect(list.json().data.map((e: { action: string }) => e.action)).toContain("group.create");

    expect((await inject("GET", "/audit-events", await member())).statusCode).toBe(403);
  });

  it("streams the audit trail as csv and ndjson", async () => {
    const cookie = await superadmin();
    await inject("POST", "/groups", cookie, { name: "Exported" });

    const csv = await inject("GET", "/audit-events/export?format=csv", cookie);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\n")[0]).toBe(
      "id,createdAt,action,actorId,actorName,actorEmail,companyId,ip,requestId",
    );
    expect(csv.body).toContain("group.create");

    const ndjson = await inject("GET", "/audit-events/export?format=json", cookie);
    expect(ndjson.headers["content-type"]).toContain("application/x-ndjson");
    const first = JSON.parse(ndjson.body.trim().split("\n")[0]!);
    expect(first).toHaveProperty("action");
  });
});

describe("change history", () => {
  it("records a field-level diff for an updated entity", async () => {
    const cookie = await superadmin();
    const company = (await inject("POST", "/companies", cookie, { name: "Before Inc" })).json();
    await inject("PATCH", `/companies/${company.id}`, cookie, { name: "After Inc" });

    const res = await inject("GET", `/history/companies/${company.id}`, cookie);
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as {
      field: string;
      oldValue: unknown;
      newValue: unknown;
      actorId: string;
    }[];
    const nameChange = rows.find((r) => r.field === "name");
    expect(nameChange).toBeDefined();
    expect(nameChange!.oldValue).toBe("Before Inc");
    expect(nameChange!.newValue).toBe("After Inc");
    expect(nameChange!.actorId).toBeTruthy();
    // Timestamps must not pollute the diff.
    expect(rows.some((r) => r.field === "updatedAt")).toBe(false);
  });

  it("tracks settings changes and rejects untracked entity types", async () => {
    const cookie = await superadmin();
    await inject("PUT", "/settings/auth/passwordPolicy", cookie, { value: { minLength: 16 } });

    const res = await inject("GET", "/history/settings/auth.passwordPolicy", cookie);
    expect(res.statusCode).toBe(200);
    const fields = res.json().data.map((r: { field: string }) => r.field);
    expect(fields).toContain("minLength");

    // An entity type that is not tracked is refused (reports/users/etc. are).
    expect((await inject("GET", "/history/gremlins/abc", cookie)).statusCode).toBe(400);
  });

  it("records a user status change", async () => {
    const cookie = await superadmin();
    const signUp = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-up/email`,
      payload: { email: "tracked@acme.test", password: "S3curePass!23", name: "Tracked" },
    });
    const userId = (signUp.json() as { user: { id: string } }).user.id;

    await inject("POST", `/users/${userId}/deactivate`, cookie, undefined, DEMO_COMPANY_ID);

    const res = await inject("GET", `/history/users/${userId}`, cookie);
    const statusChange = res.json().data.find((r: { field: string }) => r.field === "status") as
      { oldValue: string; newValue: string } | undefined;
    expect(statusChange).toBeDefined();
    expect(statusChange!.oldValue).toBe("active");
    expect(statusChange!.newValue).toBe("inactive");
  });
});
