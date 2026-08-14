// Author: Brijesh Dave <https://github.com/brijeshdave>
// Runs once before the suite: log in as the superadmin and save the session, so the
// specs start authenticated instead of re-typing the form every time.
//
// The databases and the servers are built by the stack the config launches (see
// prepare-db.ts); by the time this runs, the seed is in place and the superadmin's
// password is E2E_PASSWORD. Against an external stack (CI sets BASE_URL) the
// password is set here instead, because there is no stack of ours to have done it.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type FullConfig } from "@playwright/test";

import { E2E_PASSWORD, E2E_WEB_URL, isExternalStack } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
export const AUTH_DIR = join(here, ".auth");
export const SUPERADMIN_STATE = join(AUTH_DIR, "superadmin.json");
export const CREDS_FILE = join(AUTH_DIR, "creds.json");

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL ?? "admin@reportly.local";

/**
 * Set the password on a stack we did not build — the CI case, where the app is
 * already running against its own database and only needs a credential we know.
 *
 * Telling the CLI what to set beats parsing what it generated: the regex that used
 * to pull the password out of stdout made the command's wording a suite-wide failure
 * waiting to happen.
 */
function setPasswordOnExternalStack(): void {
  execSync("pnpm --filter @reportly/api cli reset-superadmin --password-stdin", {
    cwd: join(here, ".."),
    encoding: "utf8",
    input: E2E_PASSWORD,
    stdio: ["pipe", "pipe", "inherit"],
  });
}

async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? E2E_WEB_URL;
  if (isExternalStack()) setPasswordOnExternalStack();

  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(CREDS_FILE, JSON.stringify({ email: SUPERADMIN_EMAIL, password: E2E_PASSWORD }));

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto("/login");
  await page.getByLabel("Email").fill(SUPERADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The redirect to the dashboard is the signal the session cookie is set.
  await page.waitForURL(new URL("/", baseURL).toString());

  // The suite signs in many times over — a fresh session for the 2FA round trip,
  // clean sessions for the redirect checks, three people each in the appraisal and
  // swap flows. The default sign-in limit (5/minute) is a real protection, and
  // tripping it would make the suite flaky rather than find a bug, so this
  // dedicated environment raises it. Rate limiting stays on; only the ceiling moves.
  //
  // Note what this does NOT lift: better-auth's own built-in rule of three
  // password changes per ten seconds, which no configuration here overrides. The
  // specs wait that out instead — see `changePassword` in tests/helpers.ts.
  const response = await page.request.put(
    new URL("/api/v1/settings/auth/rateLimit", baseURL).toString(),
    { data: { value: { signInMax: 1000, signInWindowSeconds: 60 } } },
  );
  if (!response.ok()) {
    throw new Error(`Could not raise the sign-in rate limit for e2e: ${response.status()}`);
  }

  await page.context().storageState({ path: SUPERADMIN_STATE });
  await browser.close();
}

export default globalSetup;
