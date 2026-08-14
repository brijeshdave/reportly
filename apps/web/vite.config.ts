// Author: Brijesh Dave <https://github.com/brijeshdave>
// Vite + Vitest config: React, Tailwind, workspace aliases, and a dev proxy that
// forwards /api to the Fastify server so the web app calls the API same-origin.
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig(({ mode }) => {
  // Vite loads .env into `import.meta.env` for the *app*, but NOT into
  // `process.env` for this config file. So `process.env.WEB_PORT` was always
  // undefined here and the default silently won — meaning WEB_PORT in .env, which
  // .env.example advertises, has never actually done anything. `loadEnv` with an
  // empty prefix reads the file properly; the shell still takes precedence, which
  // is the order people expect.
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const apiPort = env.API_PORT ?? "3000";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        // `@reportly/shared` resolves via the workspace's built dist (Turbo builds
        // it first), matching runtime resolution.
        "@": src,
      },
    },
    server: {
      // Listen on every interface, not just loopback.
      //
      // Vite defaults to 127.0.0.1, which is unreachable from outside the machine
      // running it — including from a Windows browser when the dev server is inside
      // WSL2, where it presents as "connection refused" even though the server is up
      // and its own logs look healthy. The API already binds 0.0.0.0, which is why
      // that half of the stack works and this half appears broken.
      //
      // Set WEB_HOST=127.0.0.1 to go back to loopback-only. Note the trade: on all
      // interfaces the dev server is reachable from the local network, so do not run
      // it unfirewalled on an untrusted one.
      host: env.WEB_HOST ?? true,
      port: Number(env.WEB_PORT ?? 5173),
      proxy: {
        "/api": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Split the dependencies that almost never change away from the app
          // code that changes every release. Both are content-hashed, so without
          // this a one-line fix invalidates the whole bundle and every user
          // re-downloads React, the router and the table library to get it.
          //
          // Deliberately NOT route-level code splitting. That would mean 57
          // `lazyRouteComponent(() => import(...), "ExportName")` call sites
          // whose second argument is a string the compiler cannot check — a typo
          // fails at runtime, on one route, in production. The initial bundle is
          // 258 KB gzipped, which is not a problem worth that failure mode for an
          // internal tool. Revisit if it grows.
          // The function form, not the object form: Vite 8 only accepts a
          // function here.
          manualChunks(id: string) {
            if (!id.includes("node_modules")) return;
            if (/[\\/]node_modules[\\/]react(-dom)?[\\/]/.test(id)) return "react";
            if (id.includes("node_modules/@tanstack/")) return "tanstack";
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      // Vitest's default is 5s per test, which is comfortable for a suite running
      // alone and marginal for a jsdom render test when `turbo run test` has the
      // api, web and shared suites competing for the same cores — as CI does, on
      // a runner with fewer of them than a developer's machine.
      //
      // This is a ceiling, not a sleep: a test that finishes in 40ms still takes
      // 40ms. Raising it cannot turn a broken test green, because every one of
      // these assertions is for something that either happens or does not. It
      // only stops the suite reporting a scheduling delay as a product bug.
      testTimeout: 20_000,
    },
  };
});
