// Author: Brijesh Dave <https://github.com/brijeshdave>
// The shared shape of an email provider's HTTP API.
//
// One authenticated POST with a JSON body, for every provider here. Four vendor
// SDKs to send one email would be exactly the dependency creep the project's rules
// forbid, and each would bring its own retry policy and its own opinions about
// logging — while the queue already owns both.
//
// What matters most is the failure path: the provider's own words are lifted out
// of the response and thrown as-is. "API key not authorized for this domain" is
// the entire diagnosis, and any tidying-up loses it.
export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * POST it, and turn a refusal into an error carrying what the provider said.
 *
 * Non-2xx is a failure even when the body is empty: silence from a provider is not
 * consent, and the email queue must see a rejection so it retries and the message
 * log records it.
 */
export async function postToProvider(name: string, request: ProviderRequest): Promise<void> {
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...request.headers },
      body: JSON.stringify(request.body),
    });
  } catch (error) {
    // A DNS failure or a dropped connection. Named, so the message log does not
    // just say "fetch failed" with no clue which provider.
    throw new Error(`${name} could not be reached: ${(error as Error).message}`, {
      cause: error,
    });
  }

  if (response.ok) return;

  const detail = (await response.text().catch(() => "")).trim();
  throw new Error(
    `${name} refused the message (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
  );
}
