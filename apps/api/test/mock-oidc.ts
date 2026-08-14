// Author: Brijesh Dave <https://github.com/brijeshdave>
// Minimal in-process mock OIDC provider for SSO integration tests: serves a
// discovery document, a token endpoint, and a userinfo endpoint on a random port.
import { createServer, type Server } from "node:http";

export interface MockOidc {
  url: string;
  close: () => Promise<void>;
}

export async function startMockOidc(profile: {
  sub?: string;
  email: string;
  name?: string;
}): Promise<MockOidc> {
  const server: Server = createServer((req, res) => {
    const base = `http://${req.headers.host}`;
    const url = new URL(req.url ?? "/", base);
    res.setHeader("content-type", "application/json");

    if (url.pathname === "/.well-known/openid-configuration") {
      res.end(
        JSON.stringify({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          userinfo_endpoint: `${base}/userinfo`,
          jwks_uri: `${base}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          scopes_supported: ["openid", "email", "profile"],
        }),
      );
      return;
    }
    if (url.pathname === "/token" && req.method === "POST") {
      res.end(
        JSON.stringify({
          access_token: "mock-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid email profile",
        }),
      );
      return;
    }
    if (url.pathname === "/userinfo") {
      res.end(
        JSON.stringify({
          sub: profile.sub ?? "mock-sub-123",
          email: profile.email,
          email_verified: true,
          name: profile.name ?? "SSO User",
        }),
      );
      return;
    }
    if (url.pathname === "/jwks") {
      res.end(JSON.stringify({ keys: [] }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
