// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration-test config: runs *.integration.test.ts against the dedicated test
// databases (see test/global-setup.ts). Serial (no file parallelism) so suites
// don't race on shared tables.
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { TEST_DATABASE_URL, TEST_LOG_DATABASE_URL, TEST_REDIS_URL } from "./test/config.js";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": src } },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      LOG_DATABASE_URL: TEST_LOG_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      BETTER_AUTH_SECRET: "integration-test-secret-abcdef",
      LOG_DIR: "./.tmp-logs",
      // Suites create members through the public sign-up endpoint, so the feature
      // must be on here even though it ships off by default.
      ALLOW_REGISTRATION: "true",
    },
  },
});
