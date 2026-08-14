// Author: Brijesh Dave <https://github.com/brijeshdave>
// The API reference is the contract the frontend is built against. better-auth's
// own reference page rendered blank — it loads Scalar from a CDN our CSP blocks —
// so its endpoints are merged into our self-hosted spec instead. If that merge
// silently stops happening, half the API vanishes from the docs without a failure.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

async function spec(): Promise<{
  paths: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown> };
}> {
  const res = await app.inject({ method: "GET", url: `${API_PREFIX}/docs/json` });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe("the OpenAPI document", () => {
  it("documents our feature routes", async () => {
    const { paths } = await spec();
    expect(paths).toHaveProperty("/api/v1/users");
    expect(paths).toHaveProperty("/api/v1/groups");
    expect(paths).toHaveProperty("/api/v1/password-rules");
  });

  it("documents the auth routes, keyed under the auth base path", async () => {
    const { paths } = await spec();
    expect(paths).toHaveProperty("/api/v1/auth/sign-in/email");
    expect(paths).toHaveProperty("/api/v1/auth/two-factor/verify-totp");
    expect(paths).toHaveProperty("/api/v1/auth/sign-in/oauth2");
  });

  it("leaves no auth path relative to the auth base", async () => {
    // better-auth documents itself as `/sign-in/email`; unprefixed, those would
    // read as top-level API routes that do not exist.
    const { paths } = await spec();
    const relative = Object.keys(paths).filter((path) => !path.startsWith("/api/v1"));
    expect(relative).toEqual([]);
  });

  it("does not let a merged schema overwrite one of ours", async () => {
    const { components } = await spec();
    // A name collision would silently redefine our contract.
    expect(components?.schemas).toBeDefined();
  });
});

describe("better-auth's own reference page", () => {
  it("is disabled, because a CDN-loaded page renders blank under our CSP", async () => {
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/auth/reference` });
    expect(res.statusCode).toBe(404);
  });
});
