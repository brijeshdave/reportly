// Author: Brijesh Dave <https://github.com/brijeshdave>
// A company delete cascades into its locations, and through them into every group
// scoped to one — silently narrowing what those members can see. Deleting is now
// refused while anything but the auto-created Remote location depends on it.
//
// Groups are the counterpoint: a group holds no data of its own, so deleting one
// revokes access and destroys nothing. It is deliberately not guarded.
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

const newCompany = async (cookie: string, name = "Initech") =>
  (await inject("POST", "/companies", cookie, { name })).json();

describe("company status", () => {
  it("creates a company active", async () => {
    const cookie = await superadmin();
    expect((await newCompany(cookie)).status).toBe("active");
  });

  it("deactivates and reactivates without touching its locations", async () => {
    const cookie = await superadmin();
    const company = await newCompany(cookie);

    const off = await inject("POST", `/companies/${company.id}/deactivate`, cookie);
    expect(off.statusCode).toBe(200);
    expect(off.json().status).toBe("inactive");

    // Its Remote location is untouched.
    const locations = (await inject("GET", "/locations", cookie, undefined, company.id)).json();
    expect(locations).toHaveLength(1);

    const on = await inject("POST", `/companies/${company.id}/reactivate`, cookie);
    expect(on.json().status).toBe("active");
  });
});

/** Give a fresh person this company, so it becomes a reference. */
let scopeSeq = 0;
async function giveCompanyTo(cookie: string, companyId: string, name = "Field team") {
  scopeSeq += 1;
  const username = `holder${scopeSeq}`;
  const user = (
    await inject("POST", "/users", cookie, {
      name,
      email: `${username}@reportly.test`,
      username,
      password: "Str0ngTempPass!x",
    })
  ).json();
  await inject("PUT", `/users/${user.id}/companies`, cookie, { ids: [companyId] });
  return user;
}

describe("company references", () => {
  it("always reports the auto-created Remote location", async () => {
    const cookie = await superadmin();
    const company = await newCompany(cookie);

    const res = await inject("GET", `/companies/${company.id}/references`, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().locations.map((l: { name: string }) => l.name)).toEqual(["Remote"]);
    expect(res.json().groups).toEqual([]);
  });

  it("names the people given it", async () => {
    const cookie = await superadmin();
    const company = await newCompany(cookie);
    const user = await giveCompanyTo(cookie, company.id);

    const { groups } = (await inject("GET", `/companies/${company.id}/references`, cookie)).json();
    expect(groups).toEqual([{ id: user.id, name: "Field team" }]);
  });
});

describe("company delete", () => {
  it("deletes a company that has only its Remote location", async () => {
    const cookie = await superadmin();
    const company = await newCompany(cookie);

    // Remote alone must never block: every company has one.
    expect((await inject("DELETE", `/companies/${company.id}`, cookie)).statusCode).toBe(204);
  });

  it("refuses while it has a real location, and says which", async () => {
    const cookie = await superadmin();
    const company = await newCompany(cookie);
    await inject("POST", "/locations", cookie, { name: "Depot" }, company.id);

    const res = await inject("DELETE", `/companies/${company.id}`, cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.locations.map((l: { name: string }) => l.name)).toEqual([
      "Depot",
    ]);

    // Nothing was destroyed by the refusal.
    expect((await inject("GET", `/companies/${company.id}`, cookie)).statusCode).toBe(200);
  });

  it("refuses while a person holds it", async () => {
    const cookie = await superadmin();
    const company = await newCompany(cookie);
    const user = await giveCompanyTo(cookie, company.id);

    const res = await inject("DELETE", `/companies/${company.id}`, cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.groups).toEqual([{ id: user.id, name: "Field team" }]);
  });

  it("cascades only when asked, and the person survives having lost it", async () => {
    const cookie = await superadmin();
    const company = await newCompany(cookie);
    await inject("POST", "/locations", cookie, { name: "Depot" }, company.id);
    const user = await giveCompanyTo(cookie, company.id);

    expect(
      (await inject("DELETE", `/companies/${company.id}?cascade=true`, cookie)).statusCode,
    ).toBe(204);

    const scope = (await inject("GET", `/users/${user.id}/scope`, cookie)).json();
    expect(scope.companies).toEqual([]);
    // The person themselves is untouched.
    expect((await inject("GET", `/users/${user.id}`, cookie)).statusCode).toBe(200);
  });
});

describe("group delete", () => {
  it("reports what it would revoke, before the click", async () => {
    const cookie = await superadmin();
    const group = (await inject("POST", "/groups", cookie, { name: "Field team" })).json();
    const member = (
      await inject("POST", "/users/invite", cookie, { email: "m@acme.test", name: "M" })
    ).json();
    await inject("PUT", `/groups/${group.id}/users`, cookie, { ids: [member.id] });

    const res = await inject("GET", `/groups/${group.id}/impact`, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ members: 1, roles: 0 });
  });

  it("is allowed even with members, because it destroys nothing", async () => {
    const cookie = await superadmin();
    const group = (await inject("POST", "/groups", cookie, { name: "Field team" })).json();
    const member = (
      await inject("POST", "/users/invite", cookie, { email: "m@acme.test", name: "M" })
    ).json();
    await inject("PUT", `/groups/${group.id}/users`, cookie, { ids: [member.id] });

    expect((await inject("DELETE", `/groups/${group.id}`, cookie)).statusCode).toBe(204);

    // The user survives; only their access through that group is gone.
    expect((await inject("GET", `/users/${member.id}`, cookie)).statusCode).toBe(200);
    expect((await inject("GET", `/users/${member.id}/groups`, cookie)).json()).toEqual([]);
  });
});
