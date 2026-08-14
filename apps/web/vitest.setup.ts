// Author: Brijesh Dave <https://github.com/brijeshdave>
// Vitest setup: extend `expect` with jest-dom matchers for DOM assertions.
import "@testing-library/jest-dom/vitest";

// jsdom has no layout, so it throws "not implemented" when the router restores
// scroll after a navigation. Nothing under test depends on scrolling.
window.scrollTo = () => undefined;
