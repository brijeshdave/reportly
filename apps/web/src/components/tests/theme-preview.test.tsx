// Author: Brijesh Dave <https://github.com/brijeshdave>
// The theme preview must apply a selected palette to the document root — the
// mechanism every theme change depends on.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/theme-provider.js";
import { ThemePreview } from "@/components/theme-preview.js";

/** The provider reconciles the theme through a query, so it needs a client. */
function withProviders(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  // Signed out: the provider's /settings/me reconciliation just fails.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 401 })),
  );
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => vi.unstubAllGlobals());

it("starts on the default palette", () => {
  render(withProviders(<ThemePreview />));
  expect(screen.getByRole("heading", { name: "Reportly design system" })).toBeInTheDocument();
  expect(document.documentElement.getAttribute("data-theme")).toBe("aurora");
});

it("applies a palette when one is selected", async () => {
  render(withProviders(<ThemePreview />));
  await userEvent.click(screen.getByRole("button", { name: /Forest/ }));
  expect(document.documentElement.getAttribute("data-theme")).toBe("forest");
});

it("adopts the theme the server reports, so a saved change applies live", async () => {
  // The regression this guards: the provider used to read /settings/me once and
  // never again, so changing the org default in Settings did nothing until a
  // reload. It now reconciles through the preferences query.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json([
        { namespace: "ui", key: "theme", value: { palette: "citrus", mode: "dark" } },
      ]),
    ),
  );

  render(withProviders(<ThemePreview />));

  await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("citrus"));
});
