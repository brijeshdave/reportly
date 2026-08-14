// Author: Brijesh Dave <https://github.com/brijeshdave>
// The sign-in page reads this endpoint before anyone is authenticated, so it must
// stay public — and must never leak a client id, secret, or issuer.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { setProvider } from "@/features/sso/service.js";
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

const get = () => app.inject({ method: "GET", url: `${API_PREFIX}/sso/enabled-providers` });

describe("GET /sso/enabled-providers", () => {
  it("is reachable without a session", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("lists an enabled provider with its display label", async () => {
    await setProvider("google", { enabled: true, clientId: "cid", clientSecret: "sec" });
    expect((await get()).json()).toEqual([{ id: "google", label: "Google" }]);
  });

  it("omits disabled providers", async () => {
    await setProvider("google", { enabled: true, clientId: "cid", clientSecret: "sec" });
    await setProvider("auth0", { enabled: false, clientId: "cid", clientSecret: "sec" });
    expect((await get()).json().map((p: { id: string }) => p.id)).toEqual(["google"]);
  });

  it("never exposes credentials", async () => {
    await setProvider("authentik", {
      enabled: true,
      clientId: "public-client-id",
      clientSecret: "top-secret",
      issuer: "https://idp.acme.test",
    });
    const body = (await get()).body;
    expect(body).not.toContain("top-secret");
    expect(body).not.toContain("public-client-id");
    expect(body).not.toContain("idp.acme.test");
  });
});
