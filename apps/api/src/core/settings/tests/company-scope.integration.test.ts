// Author: Brijesh Dave <https://github.com/brijeshdave>
// Settings resolve most-specific-first: user → company → system → default.
//
// The order is the whole point of the scope, and every way of getting it wrong is
// quiet. Resolve too eagerly and one tenant's choice leaks into another's; resolve
// too late and a company's own setting silently does nothing while its screen
// cheerfully shows the value it thinks it saved.
//
// The opt-in flags matter as much as the order. Most settings here describe the
// installation — how long a session lasts, what a password must contain — and a
// tenant answering those differently is either meaningless or a security hole.
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "@/core/app.js";
import {
  clearCompanySetting,
  getCompanySetting,
  getEffectiveSetting,
  setCompanySetting,
  setSystemSetting,
  setUserSetting,
} from "@/core/settings/service.js";
import { db } from "@/core/db/index.js";
import { users } from "@/core/db/schema.js";
import { resetDb } from "../../../../test/reset-db.js";
import type { SettingDef } from "@reportly/shared";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY_ID = "22222222-2222-2222-2222-222222222222";

const schema = z.object({ label: z.string().default("default") });

/** Overridable by everyone — the case with a full resolution chain. */
const EVERYWHERE: SettingDef<typeof schema> = {
  namespace: "test-scope",
  key: "everywhere",
  schema,
  userOverridable: true,
  companyOverridable: true,
  description: "Test setting, overridable at every scope",
};

/** System-only — the case that must ignore a company entirely. */
const SYSTEM_ONLY: SettingDef<typeof schema> = {
  namespace: "test-scope",
  key: "system-only",
  schema,
  userOverridable: false,
  description: "Test setting nobody may override",
};

let app: Awaited<ReturnType<typeof buildApp>>;
/** A real user id: `settings.user_id` is a foreign key, so an invented one is rejected. */
let someone: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  const [row] = await db.select({ id: users.id }).from(users).limit(1);
  someone = row!.id;
});

describe("resolution order", () => {
  it("falls back to the registry default when nobody has said otherwise", async () => {
    expect((await getEffectiveSetting(EVERYWHERE)).label).toBe("default");
  });

  it("prefers the company's value over the system one", async () => {
    await setSystemSetting(EVERYWHERE, { label: "system" });
    await setCompanySetting(EVERYWHERE, DEMO_COMPANY_ID, { label: "acme" });

    expect((await getEffectiveSetting(EVERYWHERE, { companyId: DEMO_COMPANY_ID })).label).toBe(
      "acme",
    );
    // And says nothing about anybody else.
    expect((await getEffectiveSetting(EVERYWHERE, { companyId: OTHER_COMPANY_ID })).label).toBe(
      "system",
    );
    expect((await getEffectiveSetting(EVERYWHERE)).label).toBe("system");
  });

  it("prefers a user's own value over their company's", async () => {
    await setSystemSetting(EVERYWHERE, { label: "system" });
    await setCompanySetting(EVERYWHERE, DEMO_COMPANY_ID, { label: "acme" });
    await setUserSetting(EVERYWHERE, someone, { label: "mine" });

    expect(
      (await getEffectiveSetting(EVERYWHERE, { userId: someone, companyId: DEMO_COMPANY_ID }))
        .label,
    ).toBe("mine");
  });

  it("falls through to the company when the user has no opinion", async () => {
    await setSystemSetting(EVERYWHERE, { label: "system" });
    await setCompanySetting(EVERYWHERE, DEMO_COMPANY_ID, { label: "acme" });

    expect(
      (await getEffectiveSetting(EVERYWHERE, { userId: someone, companyId: DEMO_COMPANY_ID }))
        .label,
    ).toBe("acme");
  });
});

describe("opting in", () => {
  it("refuses a company value for a setting that is not company-overridable", async () => {
    await expect(setCompanySetting(SYSTEM_ONLY, DEMO_COMPANY_ID, { label: "no" })).rejects.toThrow(
      /cannot be set per company/i,
    );
  });

  it("ignores a company id for a setting that did not opt in", async () => {
    // Even with a stored row — which only a bug could produce — the resolver must
    // not consult it, because the flag is what says whose business the value is.
    await setSystemSetting(SYSTEM_ONLY, { label: "system" });
    expect((await getEffectiveSetting(SYSTEM_ONLY, { companyId: DEMO_COMPANY_ID })).label).toBe(
      "system",
    );
  });
});

describe("clearing", () => {
  it("puts a company back on the system value", async () => {
    await setSystemSetting(EVERYWHERE, { label: "system" });
    await setCompanySetting(EVERYWHERE, DEMO_COMPANY_ID, { label: "acme" });
    expect(await getCompanySetting(EVERYWHERE, DEMO_COMPANY_ID)).not.toBeNull();

    await clearCompanySetting(EVERYWHERE, DEMO_COMPANY_ID);

    // Cleared, not set-to-the-current-system-value: the company follows an
    // administrator who changes it later.
    expect(await getCompanySetting(EVERYWHERE, DEMO_COMPANY_ID)).toBeNull();
    await setSystemSetting(EVERYWHERE, { label: "changed" });
    expect((await getEffectiveSetting(EVERYWHERE, { companyId: DEMO_COMPANY_ID })).label).toBe(
      "changed",
    );
  });
});
