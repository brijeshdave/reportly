// Author: Brijesh Dave <https://github.com/brijeshdave>
// Vitest config for the API package: resolves the in-package `@/*` alias so tests
// run against source. `@reportly/shared` resolves via the workspace's built dist
// (Turbo builds it first), matching how the API resolves it at runtime.
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": src,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests need a database and run via vitest.integration.config.ts.
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.integration.test.ts"],
  },
});
