// Author: Brijesh Dave <https://github.com/brijeshdave>
// Every environment variable the API reads must actually reach the container.
//
// `compose.prod.yaml`'s `x-app-env` is an **allow-list**, not a passthrough: a
// variable absent from it is silently ignored however carefully somebody sets it in
// `.env`. Sixteen of thirty-five had drifted out of it before anybody noticed —
// including `TRUST_PROXY`, whose absence made every caller look like the proxy and
// collapsed the sign-in throttle onto one shared bucket, and `QUEUE_ADMIN`, which an
// operator set, restarted, and found the screen still missing with nothing to say why.
//
// A missing variable produces no error anywhere: the schema's default quietly applies,
// so the feature is simply off. That is exactly the kind of fault a static test should
// catch instead of a person.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), "utf8");

/**
 * The names the env schema declares.
 *
 * Both spellings: `NAME: z.…` and the helpers (`envBool`, `envInt`) that wrap one.
 * Matching only `z.` is how the first version of this test reported thirty-five
 * variables when there were thirty-eight, and quietly gave `SMTP_SECURE` a pass.
 */
function declaredVars(): string[] {
  return [
    ...read("apps/api/src/core/env.ts").matchAll(
      /^ {2}([A-Z][A-Z0-9_]+):\s*(?:z\b|env[A-Z]\w*\()/gm,
    ),
  ].map((match) => match[1]!);
}

describe("production compose", () => {
  it("hands the whole .env to the services that run the app", () => {
    // The fix for the drift: `env_file` means a setting works the day it is added,
    // without this file having to name it. Both services run the same image and both
    // need it — the migrate gate reads DATABASE_URL and LOG_LEVEL like any other.
    const compose = read("compose.prod.yaml");
    const services = compose.slice(compose.indexOf("services:"));
    const api = services.slice(services.indexOf("\n  api:"));
    const migrate = services.slice(services.indexOf("\n  migrate:"), services.indexOf("\n  api:"));

    expect(api).toContain("env_file:");
    expect(migrate).toContain("env_file:");
  });

  it("keeps only what compose itself computes in the shared block", () => {
    // Anything of the form `${FOO:-default}` is a plain passthrough, and a passthrough
    // is exactly what `env_file` already does — but silently overrides it with a
    // default when the operator has not set it. That is how a value set in `.env`
    // stops taking effect, which is the fault this test exists to prevent.
    const compose = read("compose.prod.yaml");
    const anchor = compose.slice(compose.indexOf("x-app-env:"), compose.indexOf("x-logging:"));

    // PROJECT_NAME is compose's own — it names the containers — and is not read by
    // the API at all, so it is not a passthrough of an app setting.
    const passthroughs = [...anchor.matchAll(/^ {2}([A-Z][A-Z0-9_]+): \$\{\1:-/gm)]
      .map((match) => match[1]!)
      .filter((name) => name !== "PROJECT_NAME");

    expect(
      passthroughs,
      `These override .env with a default and should simply be left to env_file: ` +
        passthroughs.join(", "),
    ).toEqual([]);
  });

  it("still computes the values that only compose can know", () => {
    const anchor = read("compose.prod.yaml");
    // Assembled from the Postgres parts, fixed to a path inside the container, or
    // decided by the image — none of which an operator can write in .env.
    for (const name of ["DATABASE_URL", "LOG_DATABASE_URL", "REDIS_URL", "STORAGE_LOCAL_DIR"]) {
      expect(anchor).toContain(`${name}:`);
    }
    expect(anchor).toContain("NODE_ENV: production");
  });

  it("documents every setting an operator has to make in the example env", () => {
    // The other half of the report: `QUEUE_ADMIN` was absent from the file people
    // copy, so it read as a setting that did not exist.
    const documented = new Set(
      [...read(".env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]!),
    );
    const computed = new Set([
      "NODE_ENV",
      "HOST",
      "PORT",
      "DATABASE_URL",
      "LOG_DATABASE_URL",
      "REDIS_URL",
      "STORAGE_LOCAL_DIR",
      "LOG_DIR",
    ]);
    const missing = declaredVars().filter((name) => !documented.has(name) && !computed.has(name));

    expect(missing, `Not mentioned in .env.example: ${missing.join(", ")}`).toEqual([]);
  });
});
