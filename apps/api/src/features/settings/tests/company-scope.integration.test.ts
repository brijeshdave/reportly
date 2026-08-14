// Author: Brijesh Dave <https://github.com/brijeshdave>
// Settings a company answers for itself.
//
// The third scope, and the one with the most room to go wrong: a company setting
// that silently wrote system-wide would switch a module on for every tenant on
// the server, and the only visible symptom would be another company's sidebar
// growing an entry nobody there asked for.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

function inject(method: string, url: string, payload?: unknown, companyId = DEMO_COMPANY_ID) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": companyId },
    payload: payload as object,
  });
}

beforeEach(async () => {
  await resetDb();
  const password = await resetSuperadmin();
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: "admin@reportly.local", password },
  });
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  cookie = list.map((c) => String(c).split(";")[0]).join("; ");
});

const partsOf = (records: { namespace: string; key: string; value: unknown }[]) =>
  records.find((r) => r.namespace === "parts" && r.key === "module")?.value as
    { enabled: boolean; failureWindowDays: number } | undefined;

describe("company settings", () => {
  it("switches a module on for one company and leaves the other alone", async () => {
    const other = (await inject("POST", "/companies", { name: "Other Co" })).json();

    await inject("PUT", `/companies/${DEMO_COMPANY_ID}/settings/parts/module`, {
      value: { enabled: true, failureWindowDays: 21 },
    });

    expect(partsOf((await inject("GET", `/companies/${DEMO_COMPANY_ID}/settings`)).json())).toEqual(
      {
        enabled: true,
        failureWindowDays: 21,
      },
    );
    // The other company still answers the system default. This is the assertion
    // that matters: a company write that leaked to the system scope would switch
    // the module on for every tenant at once.
    expect(partsOf((await inject("GET", `/companies/${other.id}/settings`)).json())?.enabled).toBe(
      false,
    );

    // And the module really is reachable at one and not the other.
    expect((await inject("GET", "/parts")).statusCode).toBe(200);
    expect((await inject("GET", "/parts", undefined, other.id)).statusCode).toBe(404);
  });

  it("tells the session which modules the active company uses", async () => {
    // What the sidebar reads. Without this the nav would offer a link whose every
    // request 404s, which is the same mistake the queues entry already avoids.
    expect((await inject("GET", "/me")).json().modules).toEqual({ parts: false });

    await inject("PUT", `/companies/${DEMO_COMPANY_ID}/settings/parts/module`, {
      value: { enabled: true, failureWindowDays: 14 },
    });
    expect((await inject("GET", "/me")).json().modules).toEqual({ parts: true });
  });

  it("refuses a setting that is not a company's to answer", async () => {
    // The password policy belongs to the server. Letting one company answer it
    // would read as though it applied only to them, which it never could.
    const res = await inject("PUT", `/companies/${DEMO_COMPANY_ID}/settings/auth/passwordPolicy`, {
      value: { minLength: 4 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/not something one company can answer/i);
  });
});
