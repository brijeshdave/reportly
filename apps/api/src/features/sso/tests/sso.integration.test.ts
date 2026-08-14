// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for SSO provider configuration (settings-backed).
import { beforeEach, describe, expect, it } from "vitest";

import { AppError } from "@/core/errors.js";
import {
  enabledProviders,
  getProvider,
  listProviders,
  setProvider,
} from "@/features/sso/service.js";
import { resetDb } from "../../../../test/reset-db.js";

beforeEach(async () => {
  await resetDb();
});

describe("sso provider service", () => {
  it("seeds all five providers disabled", async () => {
    const all = await listProviders();
    expect(Object.keys(all).sort()).toEqual(["auth0", "authentik", "clerk", "google", "microsoft"]);
    expect(Object.values(all).every((p) => !p.enabled)).toBe(true);
    expect(await enabledProviders()).toEqual([]);
  });

  it("rejects enabling an incomplete provider and leaves it unchanged", async () => {
    await expect(setProvider("google", { enabled: true })).rejects.toBeInstanceOf(AppError);
    expect((await getProvider("google")).enabled).toBe(false);
  });

  it("persists and enables a complete provider", async () => {
    const saved = await setProvider("google", {
      enabled: true,
      clientId: "cid",
      clientSecret: "sec",
    });
    expect(saved.enabled).toBe(true);
    expect((await getProvider("google")).clientId).toBe("cid");
    expect((await enabledProviders()).map((e) => e.id)).toEqual(["google"]);
  });

  it("requires an issuer for generic OIDC providers", async () => {
    await expect(
      setProvider("auth0", { enabled: true, clientId: "c", clientSecret: "s" }),
    ).rejects.toBeInstanceOf(AppError);
    const ok = await setProvider("auth0", {
      enabled: true,
      clientId: "c",
      clientSecret: "s",
      issuer: "https://idp.example.com",
    });
    expect(ok.enabled).toBe(true);
  });
});

describe("client secret retention", () => {
  it("keeps the stored secret when an edit sends an empty one", async () => {
    await setProvider("google", { enabled: true, clientId: "cid", clientSecret: "sec" });

    // The admin screen never receives the secret, so it cannot send it back.
    await setProvider("google", { enabled: true, clientId: "changed", clientSecret: "" });

    const saved = await getProvider("google");
    expect(saved.clientId).toBe("changed");
    expect(saved.clientSecret).toBe("sec");
    expect(saved.enabled).toBe(true);
  });

  it("replaces the secret when a new one is supplied", async () => {
    await setProvider("google", { enabled: true, clientId: "cid", clientSecret: "sec" });
    await setProvider("google", { enabled: true, clientId: "cid", clientSecret: "rotated" });

    expect((await getProvider("google")).clientSecret).toBe("rotated");
  });

  it("still refuses to enable a provider that has never had a secret", async () => {
    await expect(
      setProvider("auth0", {
        enabled: true,
        clientId: "cid",
        clientSecret: "",
        issuer: "https://idp.test",
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
