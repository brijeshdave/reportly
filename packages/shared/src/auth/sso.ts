// Author: Brijesh Dave <https://github.com/brijeshdave>
// SSO/OIDC provider contracts shared by API (validation on write) and web (form
// gating). Provider configs live in the settings store; a provider may only be
// enabled once all of its required fields are present ("enable when complete").
import { z } from "zod";

export const SSO_PROVIDERS = ["google", "microsoft", "authentik", "auth0", "clerk"] as const;
export type SsoProviderId = (typeof SSO_PROVIDERS)[number];

/** Display names for the sign-in buttons and the admin provider list. */
export const SSO_PROVIDER_LABELS: Record<SsoProviderId, string> = {
  google: "Google",
  microsoft: "Microsoft",
  authentik: "Authentik",
  auth0: "Auth0",
  clerk: "Clerk",
};

/** A provider as offered on the sign-in page: no config, no secrets. */
export const publicSsoProviderSchema = z.object({
  id: z.enum(SSO_PROVIDERS),
  label: z.string(),
});
export type PublicSsoProvider = z.infer<typeof publicSsoProviderSchema>;

/**
 * Providers that need an explicit issuer / discovery URL (generic OIDC). Google
 * and Microsoft have well-known issuers, so they don't.
 */
export const SSO_PROVIDERS_REQUIRING_ISSUER: readonly SsoProviderId[] = [
  "authentik",
  "auth0",
  "clerk",
];

/** Stored shape of a provider config. Empty strings until an admin fills them. */
export const ssoProviderConfigSchema = z.object({
  enabled: z.boolean().default(false),
  clientId: z.string().trim().default(""),
  clientSecret: z.string().trim().default(""),
  issuer: z.string().trim().default(""),
});

export type SsoProviderConfig = z.infer<typeof ssoProviderConfigSchema>;

/** Fields required before a given provider can be enabled. */
export function requiredFieldsFor(provider: SsoProviderId): (keyof SsoProviderConfig)[] {
  const fields: (keyof SsoProviderConfig)[] = ["clientId", "clientSecret"];
  if (SSO_PROVIDERS_REQUIRING_ISSUER.includes(provider)) fields.push("issuer");
  return fields;
}

/**
 * Missing required fields for enabling. Empty array = enableable. A disabled
 * config is always valid regardless of completeness.
 */
export function missingRequiredFields(
  provider: SsoProviderId,
  config: SsoProviderConfig,
): (keyof SsoProviderConfig)[] {
  if (!config.enabled) return [];
  return requiredFieldsFor(provider).filter((field) => !config[field]);
}

/** Validate a provider config, enforcing the enable-when-complete rule. */
export function validateSsoProviderConfig(
  provider: SsoProviderId,
  config: SsoProviderConfig,
): { ok: true } | { ok: false; missing: (keyof SsoProviderConfig)[] } {
  const missing = missingRequiredFields(provider, config);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
