// Author: Brijesh Dave <https://github.com/brijeshdave>
// SSO provider configuration service: reads/writes provider configs from the
// settings store and enforces the shared "enable when complete" rule. The
// better-auth wiring that consumes enabled providers lands in the next slice.
import {
  ERROR_CODES,
  SSO_PROVIDERS,
  type SsoProviderConfig,
  type SsoProviderId,
  ssoProviderConfigSchema,
  validateSsoProviderConfig,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { getSettingRow, listSettings, upsertSetting } from "@/core/settings/repo.js";

export const SSO_NAMESPACE = "sso";

function isProviderId(key: string): key is SsoProviderId {
  return (SSO_PROVIDERS as readonly string[]).includes(key);
}

export async function getProvider(id: SsoProviderId): Promise<SsoProviderConfig> {
  const row = await getSettingRow(SSO_NAMESPACE, id);
  return ssoProviderConfigSchema.parse(row?.value ?? {});
}

/** All providers, defaulting any not yet stored to a disabled config. */
export async function listProviders(): Promise<Record<SsoProviderId, SsoProviderConfig>> {
  const result = Object.fromEntries(
    SSO_PROVIDERS.map((p) => [p, ssoProviderConfigSchema.parse({})]),
  ) as Record<SsoProviderId, SsoProviderConfig>;
  for (const row of await listSettings(SSO_NAMESPACE)) {
    if (isProviderId(row.key)) result[row.key] = ssoProviderConfigSchema.parse(row.value ?? {});
  }
  return result;
}

/** Enabled providers only — used to register providers with better-auth. */
export async function enabledProviders(): Promise<
  { id: SsoProviderId; config: SsoProviderConfig }[]
> {
  const all = await listProviders();
  return SSO_PROVIDERS.filter((id) => all[id].enabled).map((id) => ({ id, config: all[id] }));
}

export async function setProvider(id: SsoProviderId, input: unknown): Promise<SsoProviderConfig> {
  const parsed = ssoProviderConfigSchema.parse(input);

  // Reads never return the stored secret, so an admin editing the client id has
  // nothing to send back. An empty secret means "keep the one already stored"; a
  // rotation sends the new value.
  const existing = await getProvider(id);
  const config: SsoProviderConfig =
    parsed.clientSecret === "" ? { ...parsed, clientSecret: existing.clientSecret } : parsed;

  const result = validateSsoProviderConfig(id, config);
  if (!result.ok) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `Cannot enable ${id}: missing ${result.missing.join(", ")}`,
      { missing: result.missing },
    );
  }
  await upsertSetting(SSO_NAMESPACE, id, config);
  return config;
}
