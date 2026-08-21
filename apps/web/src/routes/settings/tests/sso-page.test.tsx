// Author: Brijesh Dave <https://github.com/brijeshdave>
// The form must never offer a save the API would refuse, and must not blank a
// stored secret it was never shown.
import type { SsoProviderId } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { SsoPage } from "@/routes/settings/sso-page.js";
import * as sso from "@/services/sso.js";
import type { RedactedSsoProvider } from "@/services/sso.js";

vi.mock("@/services/sso.js", async (importOriginal) => ({
  ...(await importOriginal<typeof sso>()),
  saveSsoProvider: vi.fn(),
}));

const saveSsoProvider = vi.mocked(sso.saveSsoProvider);

const blank: RedactedSsoProvider = {
  enabled: false,
  clientId: "",
  issuer: "",
  clientSecretSet: false,
};

function renderPage(overrides: Partial<Record<SsoProviderId, RedactedSsoProvider>> = {}) {
  // Seeded data must not go stale: a refetch would hit the unstubbed fetch and
  // replace the page with an error.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["sso", "providers"], {
    google: blank,
    microsoft: blank,
    authentik: blank,
    auth0: blank,
    clerk: blank,
    ...overrides,
  });
  queryClient.setQueryData(queryKeys.session, {
    user: {
      id: "u1",
      name: "A",
      email: "a@x.io",
      avatarUrl: null,
      avatarVersion: null,
      status: "active",
      twoFactorEnabled: false,
    },
    companyId: null,
    isSuperadmin: true,
    groups: [],
    companies: [],
    locationIds: [],
    permissions: [],
    passwordExpired: false,
    queueAdmin: "off",
    modules: { parts: false },
    systemRoles: true,
    twoFactor: { required: false, enrolled: false, deadline: null, overdue: false },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <SsoPage />
    </QueryClientProvider>,
  );
}

/** The card for one provider, so the five don't collide in queries. */
const cardFor = (label: string) =>
  screen.getByRole("heading", { name: label }).closest("div")!.parentElement!.parentElement!;

beforeEach(() => {
  vi.clearAllMocks();
  saveSsoProvider.mockResolvedValue(blank);
});

describe("SsoPage", () => {
  it("shows a card per provider", () => {
    renderPage();
    for (const label of ["Google", "Microsoft", "Authentik", "Auth0", "Clerk"]) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
  });

  it("asks for an issuer only where the provider needs one", () => {
    renderPage();
    expect(within(cardFor("Authentik")).getByLabelText("Issuer URL")).toBeInTheDocument();
    expect(within(cardFor("Google")).queryByLabelText("Issuer URL")).not.toBeInTheDocument();
  });

  it("refuses to enable a provider with nothing filled in", () => {
    renderPage();
    expect(within(cardFor("Google")).getByRole("button", { name: "Enable" })).toBeDisabled();
  });

  it("names the fields still missing", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();

    await user.type(within(cardFor("Google")).getByLabelText("Client ID"), "cid");
    expect(within(cardFor("Google")).getByRole("status")).toHaveTextContent("clientSecret");
  });

  it("allows enabling once every required field is present", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();

    await user.type(within(cardFor("Google")).getByLabelText("Client ID"), "cid");
    await user.type(within(cardFor("Google")).getByLabelText("Client secret"), "sec");

    const enable = within(cardFor("Google")).getByRole("button", { name: "Enable" });
    expect(enable).toBeEnabled();

    await user.click(enable);
    expect(saveSsoProvider).toHaveBeenCalledWith("google", {
      enabled: true,
      clientId: "cid",
      clientSecret: "sec",
      issuer: "",
    });
  });

  it("counts an already-stored secret as present", () => {
    renderPage({ google: { ...blank, clientId: "cid", clientSecretSet: true } });
    expect(within(cardFor("Google")).getByRole("button", { name: "Enable" })).toBeEnabled();
  });

  it("sends an empty secret when it was never shown, so the stored one survives", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage({ google: { ...blank, enabled: true, clientId: "cid", clientSecretSet: true } });

    await user.clear(within(cardFor("Google")).getByLabelText("Client ID"));
    await user.type(within(cardFor("Google")).getByLabelText("Client ID"), "changed");
    await user.click(within(cardFor("Google")).getByRole("button", { name: "Save" }));

    expect(saveSsoProvider).toHaveBeenCalledWith("google", {
      enabled: true,
      clientId: "changed",
      clientSecret: "",
      issuer: "",
    });
  });

  it("offers to disable an enabled provider", () => {
    renderPage({ google: { ...blank, enabled: true, clientId: "cid", clientSecretSet: true } });
    expect(within(cardFor("Google")).getByRole("button", { name: "Disable" })).toBeEnabled();
  });
});
