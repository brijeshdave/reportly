// Author: Brijesh Dave <https://github.com/brijeshdave>
// Production must not inherit the defaults that make development pleasant. Each
// of these fails silently in the wild — a shipped signing secret forges every
// session; an http origin drops `Secure` and puts the session cookie on the wire
// in clear text — so the app refuses to boot rather than run insecurely.
import { describe, expect, it } from "vitest";

import { INSECURE_SECRET, productionSecurityErrors, type Env } from "@/core/env.js";

/** A production environment with nothing wrong with it. */
function safe(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "production",
    ALLOW_INSECURE_HTTP: false,
    BETTER_AUTH_SECRET: "a-real-secret-from-the-secret-store",
    BETTER_AUTH_URL: "https://reportly.example.com",
    WEB_URL: "https://reportly.example.com",
    ...overrides,
  } as Env;
}

describe("production security guards", () => {
  it("lets a properly configured production boot", () => {
    expect(productionSecurityErrors(safe())).toEqual([]);
  });

  it("refuses the development signing secret", () => {
    const errors = productionSecurityErrors(safe({ BETTER_AUTH_SECRET: INSECURE_SECRET }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("forgeable");
  });

  it("refuses plain http, and names the variable at fault", () => {
    const errors = productionSecurityErrors(safe({ BETTER_AUTH_URL: "http://reportly.local" }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("BETTER_AUTH_URL");
    expect(errors[0]).toContain("Secure");
  });

  it("checks the web origin too, not just the API's", () => {
    const errors = productionSecurityErrors(safe({ WEB_URL: "http://reportly.local" }));
    expect(errors[0]).toContain("WEB_URL");
  });

  it("does not object to http on loopback", () => {
    // A browser treats http://localhost as a secure context, so the production-style
    // compose run on localhost is not a finding — and must not need an escape hatch.
    const errors = productionSecurityErrors(
      safe({ BETTER_AUTH_URL: "http://localhost:8080", WEB_URL: "http://127.0.0.1:8080" }),
    );
    expect(errors).toEqual([]);
  });

  it("allows http on a real hostname only when it has been explicitly asked for", () => {
    // A self-hosted install on a trusted private network is a real deployment.
    // It just has to be a decision rather than an accident.
    const errors = productionSecurityErrors(
      safe({
        ALLOW_INSECURE_HTTP: true,
        BETTER_AUTH_URL: "http://reportly.lan",
        WEB_URL: "http://reportly.lan",
      }),
    );
    expect(errors).toEqual([]);
  });

  it("still refuses the default secret even with http explicitly allowed", () => {
    // The escape hatch is about transport, and must not become a way to ship the
    // signing secret that every copy of the repository already knows.
    const errors = productionSecurityErrors(
      safe({
        ALLOW_INSECURE_HTTP: true,
        BETTER_AUTH_URL: "http://reportly.lan",
        WEB_URL: "http://reportly.lan",
        BETTER_AUTH_SECRET: INSECURE_SECRET,
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("BETTER_AUTH_SECRET");
  });

  it("reports every problem at once, so a deploy is not fixed one restart at a time", () => {
    const errors = productionSecurityErrors(
      safe({
        BETTER_AUTH_SECRET: INSECURE_SECRET,
        BETTER_AUTH_URL: "http://reportly.local",
        WEB_URL: "http://reportly.local",
      }),
    );
    expect(errors).toHaveLength(3);
  });

  it("leaves development and test alone", () => {
    for (const NODE_ENV of ["development", "test"] as const) {
      const errors = productionSecurityErrors(
        safe({
          NODE_ENV,
          BETTER_AUTH_SECRET: INSECURE_SECRET,
          BETTER_AUTH_URL: "http://localhost",
        }),
      );
      expect(errors).toEqual([]);
    }
  });
});
