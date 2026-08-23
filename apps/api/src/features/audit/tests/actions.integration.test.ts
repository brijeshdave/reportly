// Author: Brijesh Dave <https://github.com/brijeshdave>
// The action names a filter can offer.
//
// The audit screen filtered by free text, so finding "every delete" meant knowing
// how deletes are spelled. This is the list the dropdown is built from — read from
// the rows, because audit actions are free strings written by each feature and a
// hand-kept catalogue would drift on the first one added.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
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

describe("the audit action catalogue", () => {
  it("lists what is actually in the trail, in order", async () => {
    const cookie = await superadmin();
    // Signing in wrote one; creating a company writes another.
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/companies`,
      headers: { cookie },
      payload: { name: "Initech" },
    });

    const res = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/audit-events/actions`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const actions = res.json() as string[];
    expect(actions).toContain("company.create");
    expect(actions).toContain("auth.login.success");
    expect([...actions]).toEqual([...actions].sort());
    // Distinct, not one row per event.
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("is refused to somebody who may not read the trail", async () => {
    const signUp = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-up/email`,
      payload: { email: "member@reportly.test", password: "Str0ngPassw0rd!x", name: "Member" },
    });
    const res = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/audit-events/actions`,
      headers: { cookie: cookieFrom(signUp) },
    });
    expect(res.statusCode).toBe(403);
  });

  it("filters the trail by several actions at once", async () => {
    // "Show me every create and every delete" is one query, not two — the point
    // of the multi-select.
    const cookie = await superadmin();
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/companies`,
      headers: { cookie },
      payload: { name: "Initech" },
    });

    const res = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/audit-events?filters=[{"field":"action","op":"in","value":["company.create","auth.login.success"]}]`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as { action: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((row) => row.action))).toEqual(
      new Set(["company.create", "auth.login.success"]),
    );
  });
});
