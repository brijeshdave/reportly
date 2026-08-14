// Author: Brijesh Dave <https://github.com/brijeshdave>
// SSO provider administration. The API never returns a stored client secret, only
// whether one is set, so the form must treat an empty secret as "leave unchanged".
import type { SsoProviderId } from "@reportly/shared";

import { http } from "@/services/http.js";

/** What the API returns: the secret is replaced by a boolean. */
export interface RedactedSsoProvider {
  enabled: boolean;
  clientId: string;
  issuer: string;
  clientSecretSet: boolean;
}

export function fetchSsoProviders(): Promise<Record<SsoProviderId, RedactedSsoProvider>> {
  return http.get<Record<SsoProviderId, RedactedSsoProvider>>("/sso/providers");
}

export function saveSsoProvider(
  id: SsoProviderId,
  config: { enabled: boolean; clientId: string; clientSecret: string; issuer: string },
): Promise<RedactedSsoProvider> {
  return http.put<RedactedSsoProvider>(`/sso/providers/${id}`, config);
}
