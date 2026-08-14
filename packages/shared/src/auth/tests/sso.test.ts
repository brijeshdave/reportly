// Author: Brijesh Dave <https://github.com/brijeshdave>
// Tests for the SSO "enable when complete" rule.
import { describe, expect, it } from "vitest";

import { ssoProviderConfigSchema, validateSsoProviderConfig } from "@/auth/sso.js";

const cfg = (over: Record<string, unknown>) => ssoProviderConfigSchema.parse(over);

describe("validateSsoProviderConfig", () => {
  it("allows a disabled provider with empty fields", () => {
    expect(validateSsoProviderConfig("google", cfg({ enabled: false })).ok).toBe(true);
  });

  it("rejects enabling google without client credentials", () => {
    const result = validateSsoProviderConfig("google", cfg({ enabled: true }));
    expect(result).toEqual({ ok: false, missing: ["clientId", "clientSecret"] });
  });

  it("requires an issuer for generic OIDC providers", () => {
    const result = validateSsoProviderConfig(
      "auth0",
      cfg({ enabled: true, clientId: "id", clientSecret: "secret" }),
    );
    expect(result).toEqual({ ok: false, missing: ["issuer"] });
  });

  it("accepts a complete enabled provider", () => {
    expect(
      validateSsoProviderConfig(
        "authentik",
        cfg({ enabled: true, clientId: "id", clientSecret: "secret", issuer: "https://idp" }),
      ).ok,
    ).toBe(true);
  });

  it("does not require an issuer for microsoft", () => {
    expect(
      validateSsoProviderConfig(
        "microsoft",
        cfg({ enabled: true, clientId: "id", clientSecret: "secret" }),
      ).ok,
    ).toBe(true);
  });
});
