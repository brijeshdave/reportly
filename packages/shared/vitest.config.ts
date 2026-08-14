// Author: Brijesh Dave <https://github.com/brijeshdave>
// Vitest config for the shared package: resolves the in-package `@/*` alias so
// tests run against source without a build.
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
  },
});
