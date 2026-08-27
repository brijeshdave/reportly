// Author: Brijesh Dave <https://github.com/brijeshdave>
// Vitest setup: extend `expect` with jest-dom matchers for DOM assertions.
import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

/**
 * How long `findBy*` and `waitFor` keep looking.
 *
 * **Not the same clock as vitest's `testTimeout`**, which vite.config.ts already
 * raises to twenty seconds for exactly this reason. Testing-library keeps its own,
 * defaulting to one second, so a render test could fail at ~2.3s with the suite
 * timeout nowhere near — which is how `cartridge-setup` failed about one run in
 * three under `turbo run test` and passed every time on its own.
 *
 * A ceiling, not a sleep: a query that resolves in 40ms still takes 40ms, and an
 * element that never appears still fails — later, and for the right reason. It only
 * stops four suites competing for the same cores being reported as a product bug.
 */
configure({ asyncUtilTimeout: 5_000 });

// jsdom has no layout, so it throws "not implemented" when the router restores
// scroll after a navigation. Nothing under test depends on scrolling.
window.scrollTo = () => undefined;
