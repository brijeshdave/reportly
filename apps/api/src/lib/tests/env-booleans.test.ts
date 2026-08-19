// Author: Brijesh Dave <https://github.com/brijeshdave>
// Environment flags are strings, and the obvious way to read them is wrong.
//
// `z.coerce.boolean()` is `Boolean(value)`, so every non-empty string is true —
// including "false". An operator who wrote ALLOW_INSECURE_HTTP=false, exactly as
// the documentation shows, switched insecure HTTP *on* and had no way to tell.
// Found in production on 2026-08-19; these tests are why it cannot come back.
import { describe, expect, it } from "vitest";

import { envSchema } from "@/core/env.js";

/** Parse a whole environment with the required values filled in. */
function parse(overrides: Record<string, string>) {
  return envSchema.parse({
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    LOG_DATABASE_URL: "postgres://u:p@localhost:5432/db_logs",
    BETTER_AUTH_SECRET: "a-secret-long-enough-for-the-schema-to-accept-it",
    ...overrides,
  });
}

describe("boolean environment variables", () => {
  it('reads "false" as false — the bug that started this', () => {
    expect(parse({ ALLOW_INSECURE_HTTP: "false" }).ALLOW_INSECURE_HTTP).toBe(false);
    expect(parse({ ALLOW_REGISTRATION: "false" }).ALLOW_REGISTRATION).toBe(false);
    expect(parse({ SMTP_SECURE: "false" }).SMTP_SECURE).toBe(false);
  });

  it("reads the other ways people write it", () => {
    for (const yes of ["true", "TRUE", " true ", "1", "yes", "on"]) {
      expect(parse({ ALLOW_INSECURE_HTTP: yes }).ALLOW_INSECURE_HTTP).toBe(true);
    }
    for (const no of ["false", "FALSE", " false ", "0", "no", "off"]) {
      expect(parse({ ALLOW_INSECURE_HTTP: no }).ALLOW_INSECURE_HTTP).toBe(false);
    }
  });

  it("keeps the safe default when the variable is absent", () => {
    expect(parse({}).ALLOW_INSECURE_HTTP).toBe(false);
    expect(parse({}).ALLOW_REGISTRATION).toBe(false);
  });

  it("refuses a value it cannot read rather than guessing", () => {
    // A misspelling is a question. Guessing "flase" means false is how a flag ends
    // up meaning its opposite for a year without anybody noticing.
    expect(() => parse({ ALLOW_INSECURE_HTTP: "flase" })).toThrow();
    expect(() => parse({ ALLOW_REGISTRATION: "maybe" })).toThrow();
  });
});
