// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the report-config catalogues: the seeded ladders, unique
// names, per-department categories, and the permission split (anyone who reports
// may read them; only report-config:manage may change them).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const ENGINEERING_DEPT = "22222222-2222-2222-2222-222222222221"; // seeded demo dept

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

/** A member: signed up, in no group, so they hold only the default Member grants. */
async function member(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email: "member@reportly.test", password: "Str0ngPassw0rd!x", name: "Member" },
  });
  return cookieFrom(res);
}

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

describe("report config", () => {
  it("ships a seeded severity ladder, ordered low to high", async () => {
    const cookie = await superadmin();
    const severities = (await inject("GET", "/severities", cookie)).json();
    const names = severities.map((s: { name: string }) => s.name);
    expect(names).toContain("Critical");
    expect(names).toContain("Informational");
    // The ladder's meaning is its order, and nothing else: severity carries no
    // weight, because scoring is a fixed pot per entry that never multiplies by it.
    const minor = severities.find((s: { name: string }) => s.name === "Minor");
    const critical = severities.find((s: { name: string }) => s.name === "Critical");
    expect(critical.orderIndex).toBeGreaterThan(minor.orderIndex);
    expect(critical).not.toHaveProperty("weight");
  });

  it("ships the status workflow grouped open/resolved/rejected", async () => {
    const cookie = await superadmin();
    const statuses = (await inject("GET", "/journal-statuses", cookie)).json();
    const byName = Object.fromEntries(statuses.map((s: { name: string }) => [s.name, s]));
    expect(byName["Open"]).toMatchObject({ group: "open", isTerminal: false });
    expect(byName["Resolved"]).toMatchObject({ group: "resolved", isTerminal: true });
    expect(byName["Not an issue"]).toMatchObject({ group: "rejected", isTerminal: true });

    // Nine, not eleven. The ladder carried three different terminal "done" states
    // with no rule for choosing between them, and a "Partially completed" that
    // meant the same as "In progress" — every extra status is a decision somebody
    // has to get right, which is why this number is asserted at all.
    //
    // The ninth is "Rejected", and it earns its place: refusing an entry used to
    // move it to whichever rejected status sorted first, which was "Duplicate" —
    // so a manager refusing sloppy work declared it a duplicate of nothing.
    expect(statuses).toHaveLength(9);
    expect(byName["Rejected"]).toMatchObject({ group: "rejected", isTerminal: true });
    expect(byName["Completed"]).toBeUndefined();
    expect(byName["Closed"]).toBeUndefined();
    expect(byName["Partially completed"]).toBeUndefined();
  });

  it("creates and renames a severity; rejects a duplicate name", async () => {
    const cookie = await superadmin();
    const created = await inject("POST", "/severities", cookie, { name: "Blocker" });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const dup = await inject("POST", "/severities", cookie, { name: "Blocker" });
    expect(dup.statusCode).toBe(409);

    const updated = await inject("PATCH", `/severities/${id}`, cookie, { name: "Show-stopper" });
    expect(updated.json().name).toBe("Show-stopper");
  });

  it("keeps categories unique per department, not across the company", async () => {
    const cookie = await superadmin();

    const first = await inject("POST", "/categories", cookie, {
      departmentId: ENGINEERING_DEPT,
      name: "Safety",
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ name: "Safety", departmentName: "Engineering" });

    // Same name, same department → conflict.
    const same = await inject("POST", "/categories", cookie, {
      departmentId: ENGINEERING_DEPT,
      name: "Safety",
    });
    expect(same.statusCode).toBe(409);

    // Filter to a department.
    const list = (
      await inject("GET", `/categories?departmentId=${ENGINEERING_DEPT}`, cookie)
    ).json();
    expect(list.every((c: { departmentId: string }) => c.departmentId === ENGINEERING_DEPT)).toBe(
      true,
    );
  });

  it("gates reading on reports:read and managing on report-config:manage", async () => {
    // A freshly-signed-up user is in no group, so holds no permissions at all — the
    // catalogues are not public, and managing them is certainly not.
    const nobody = await member();
    expect((await inject("GET", "/severities", nobody)).statusCode).toBe(403);
    expect((await inject("POST", "/severities", nobody, { name: "Nope" })).statusCode).toBe(403);

    // The superadmin (who has every permission) reads and manages freely. The
    // per-role grants themselves — Member reads, Manager appraises — are covered by
    // the permissionsFor unit test.
    const admin = await superadmin();
    expect((await inject("GET", "/severities", admin)).statusCode).toBe(200);
    expect((await inject("POST", "/severities", admin, { name: "Special" })).statusCode).toBe(201);
  });
});
