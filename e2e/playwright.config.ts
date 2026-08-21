// Author: Brijesh Dave <https://github.com/brijeshdave>
// End-to-end configuration. These tests drive the web app through a real browser
// against a real API — the one place the whole stack is exercised the way a person
// uses it, rather than through fastify.inject or jsdom.
//
// Locally the suite **owns its stack**: its own API and web server on their own
// ports, against databases it drops and rebuilds each run (see config.ts and
// prepare-db.ts). It used to share the development servers and their database, and
// left its users and departments in there permanently — a tax on every day after.
// Owning the stack also means a `pnpm dev` you have running is left completely
// alone, and a run never inherits what the run before it left behind.
//
// CI sets BASE_URL at a stack it starts itself, against its own throwaway database.
// There we launch nothing and drop nothing: we are a guest in someone else's stack.
import { defineConfig, devices } from "@playwright/test";

import {
  E2E_API_PORT,
  E2E_API_URL,
  E2E_WEB_PORT,
  E2E_WEB_URL,
  apiEnv,
  isExternalStack,
} from "./config.js";

const external = isExternalStack();
const BASE_URL = process.env.BASE_URL ?? E2E_WEB_URL;

export default defineConfig({
  testDir: "./tests",
  // A shared login runs first and writes storage state the other specs reuse.
  globalSetup: "./global-setup.ts",
  // These mutate shared server state (companies, settings), so they run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Most specs start already signed in as the superadmin (saved by global
    // setup). Specs that need a clean session override this per-file.
    storageState: "./.auth/superadmin.json",
  },
  // The API builds its databases as the first half of its own start command: it
  // cannot boot against a database that does not exist, and globalSetup is not
  // guaranteed to run first. reuseExistingServer stays off — a server already on
  // the port is a stale one from a killed run, pointed who-knows-where. `test:e2e`
  // runs `free-ports.ts` first to clear exactly that, which is what stops one
  // cancelled run from failing every run after it.
  webServer: external
    ? undefined
    : [
        {
          command: "pnpm stack:api",
          url: `${E2E_API_URL}/api/v1/health`,
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
          env: apiEnv(),
        },
        {
          command: "pnpm --filter @reportly/web dev",
          url: E2E_WEB_URL,
          reuseExistingServer: false,
          timeout: 120_000,
          // The web dev server proxies /api at API_PORT, so the browser talks to one
          // origin and never needs to know the API moved.
          env: { API_PORT: String(E2E_API_PORT), WEB_PORT: String(E2E_WEB_PORT) },
        },
      ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
