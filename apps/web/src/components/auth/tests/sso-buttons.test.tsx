// Author: Brijesh Dave <https://github.com/brijeshdave>
// With no providers configured the component must disappear entirely — a dangling
// "or" divider above the password form would look broken.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SsoButtons } from "@/components/auth/sso-buttons.js";
import { queryKeys } from "@/lib/queries.js";
import * as auth from "@/services/auth.js";

vi.mock("@/services/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof auth>()),
  signInWithSso: vi.fn(),
}));

const signInWithSso = vi.mocked(auth.signInWithSso);

function renderWithProviders(providers: { id: string; label: string }[], ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.ssoProviders, providers);
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("SsoButtons", () => {
  it("renders nothing when no provider is enabled", () => {
    const { container } = renderWithProviders([], <SsoButtons />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a button per enabled provider", () => {
    renderWithProviders(
      [
        { id: "google", label: "Google" },
        { id: "authentik", label: "Authentik" },
      ],
      <SsoButtons />,
    );
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue with Authentik/ })).toBeInTheDocument();
  });

  it("starts the flow for the provider that was clicked", async () => {
    signInWithSso.mockImplementation(() => new Promise(() => undefined));
    const user = userEvent.setup({ delay: null });
    renderWithProviders([{ id: "google", label: "Google" }], <SsoButtons callbackURL="/journal" />);

    await user.click(screen.getByRole("button", { name: /Continue with Google/ }));

    expect(signInWithSso).toHaveBeenCalledWith("google", "/journal");
  });

  it("surfaces a failure to start the flow", async () => {
    signInWithSso.mockRejectedValue(new Error("Provider unavailable"));
    const user = userEvent.setup({ delay: null });
    renderWithProviders([{ id: "google", label: "Google" }], <SsoButtons />);

    await user.click(screen.getByRole("button", { name: /Continue with Google/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Provider unavailable");
    // The button is usable again, rather than stuck in its pending state.
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeEnabled();
  });
});
