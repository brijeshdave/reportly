// Author: Brijesh Dave <https://github.com/brijeshdave>
// `user_locations` cascades on delete, so deleting a location used to silently
// strip it from everyone narrowed to it. Deleting is now refused while anything
// references it, and deactivating is the reversible alternative.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
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

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

const createLocation = (cookie: string, name: string) =>
  inject("POST", "/locations", cookie, { name });

/**
 * Narrow a fresh person to `locationId`, so the site becomes a reference. Scope is
 * the user's now, so it is a person — not a group — that a location holds on to.
 */
let scopeSeq = 0;
async function scopeUserTo(cookie: string, locationId: string, groupName = "Field team") {
  scopeSeq += 1;
  const username = `scoped${scopeSeq}`;
  const user = (
    await inject("POST", "/users", cookie, {
      name: groupName,
      email: `${username}@reportly.test`,
      username,
      password: "Str0ngTempPass!x",
    })
  ).json();
  await inject("PUT", `/users/${user.id}/companies`, cookie, { ids: [DEMO_COMPANY_ID] });
  await inject("PUT", `/users/${user.id}/locations`, cookie, { ids: [locationId] });
  return user;
}

describe("status", () => {
  it("creates a location active", async () => {
    const cookie = await superadmin();
    expect((await createLocation(cookie, "Depot")).json().status).toBe("active");
  });

  it("deactivates and reactivates, keeping the row", async () => {
    const cookie = await superadmin();
    const location = (await createLocation(cookie, "Depot")).json();

    const off = await inject("POST", `/locations/${location.id}/deactivate`, cookie);
    expect(off.statusCode).toBe(200);
    expect(off.json().status).toBe("inactive");

    const on = await inject("POST", `/locations/${location.id}/reactivate`, cookie);
    expect(on.json().status).toBe("active");
  });

  it("keeps a person's scope when the location is deactivated", async () => {
    const cookie = await superadmin();
    const location = (await createLocation(cookie, "Depot")).json();
    const user = await scopeUserTo(cookie, location.id);

    await inject("POST", `/locations/${location.id}/deactivate`, cookie);

    const scope = (await inject("GET", `/users/${user.id}/scope`, cookie)).json();
    expect(scope.locations).toEqual([location.id]);
  });

  it("refuses to deactivate the Remote location", async () => {
    const cookie = await superadmin();
    const remote = (await inject("GET", "/locations", cookie))
      .json()
      .find((l: { isRemote: boolean }) => l.isRemote);

    const res = await inject("POST", `/locations/${remote.id}/deactivate`, cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("cannot be deactivated");
  });
});

describe("references", () => {
  it("reports nothing for an unused location", async () => {
    const cookie = await superadmin();
    const location = (await createLocation(cookie, "Depot")).json();

    const res = await inject("GET", `/locations/${location.id}/references`, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().groups).toEqual([]);
  });

  it("names the people narrowed to it", async () => {
    const cookie = await superadmin();
    const location = (await createLocation(cookie, "Depot")).json();
    const user = await scopeUserTo(cookie, location.id);

    const { groups } = (await inject("GET", `/locations/${location.id}/references`, cookie)).json();
    expect(groups).toEqual([{ id: user.id, name: "Field team" }]);
  });
});

describe("delete", () => {
  it("deletes an unreferenced location", async () => {
    const cookie = await superadmin();
    const location = (await createLocation(cookie, "Depot")).json();

    expect((await inject("DELETE", `/locations/${location.id}`, cookie)).statusCode).toBe(204);
  });

  it("refuses while a person is narrowed to it, and says who", async () => {
    const cookie = await superadmin();
    const location = (await createLocation(cookie, "Depot")).json();
    const user = await scopeUserTo(cookie, location.id);

    const res = await inject("DELETE", `/locations/${location.id}`, cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.groups).toEqual([{ id: user.id, name: "Field team" }]);

    // Nothing was destroyed by the refusal.
    const scope = (await inject("GET", `/users/${user.id}/scope`, cookie)).json();
    expect(scope.locations).toEqual([location.id]);
  });

  it("detaches and deletes only when cascade is asked for explicitly", async () => {
    const cookie = await superadmin();
    const location = (await createLocation(cookie, "Depot")).json();
    const user = await scopeUserTo(cookie, location.id);

    const res = await inject("DELETE", `/locations/${location.id}?cascade=true`, cookie);
    expect(res.statusCode).toBe(204);

    // The person survives; only their narrowing to that location is gone, which
    // widens them back to every site of the company they still hold.
    const scope = (await inject("GET", `/users/${user.id}/scope`, cookie)).json();
    expect(scope.locations).toEqual([]);
    expect(scope.companies).toEqual([DEMO_COMPANY_ID]);
  });

  it("still refuses to delete the Remote location", async () => {
    const cookie = await superadmin();
    const remote = (await inject("GET", "/locations", cookie))
      .json()
      .find((l: { isRemote: boolean }) => l.isRemote);

    const res = await inject("DELETE", `/locations/${remote.id}?cascade=true`, cookie);
    expect(res.statusCode).toBe(400);
  });
});
