// Author: Brijesh Dave <https://github.com/brijeshdave>
// The sign-up form reads this before the user has a session, so it must stay
// public — and must not become a peephole into the rest of the settings store.
import { PASSWORD_POLICY } from "@reportly/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { setSystemSetting } from "@/core/settings/service.js";
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

const get = () => app.inject({ method: "GET", url: `${API_PREFIX}/password-rules` });

describe("GET /password-rules", () => {
  it("serves the seeded defaults without a session", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      minLength: 12,
      requireUppercase: true,
      requireNumber: true,
      requireSymbol: false,
    });
  });

  it("reflects a policy change", async () => {
    await setSystemSetting(PASSWORD_POLICY, {
      minLength: 16,
      requireUppercase: false,
      requireNumber: true,
      requireSymbol: true,
      expiryDays: 30,
      reuseCount: 5,
    });
    expect((await get()).json()).toMatchObject({ minLength: 16, requireSymbol: true });
  });

  it("never exposes the expiry and reuse rules", async () => {
    const body = (await get()).json();
    expect(body).not.toHaveProperty("expiryDays");
    expect(body).not.toHaveProperty("reuseCount");
  });
});
