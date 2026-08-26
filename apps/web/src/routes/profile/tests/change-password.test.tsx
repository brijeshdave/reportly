// Author: Brijesh Dave <https://github.com/brijeshdave>
// Changing a password signs the user out everywhere else, so a typo is expensive:
// it must be confirmed, and it must satisfy the policy the API will enforce —
// which is read from the server, not hardcoded here.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { ProfilePage } from "@/routes/profile/profile-page.js";
import * as auth from "@/services/auth.js";
import type { Session } from "@/services/session.js";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,fake") },
}));

vi.mock("@/services/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof auth>()),
  changePassword: vi.fn(),
  fetchMySessions: vi.fn().mockResolvedValue([]),
}));

const changePassword = vi.mocked(auth.changePassword);

const session: Session = {
  user: {
    id: "u1",
    name: "Ada",
    email: "ada@acme.test",
    avatarUrl: null,
    avatarVersion: null,
    status: "active",
    twoFactorEnabled: false,
  },
  companyId: null,
  isSuperadmin: false,
  groups: [],
  companies: [],
  locationIds: [],
  permissions: [],
  passwordExpired: false,
  queueAdmin: "off",
  modules: { parts: false },
  plannedWork: false,
  systemRoles: true,
  twoFactor: { required: false, enrolled: false, deadline: null, overdue: false },
};

/** The policy the server reports. Deliberately not the registry default. */
const rules = {
  minLength: 12,
  requireUppercase: true,
  requireNumber: true,
  requireSymbol: true,
};

function renderSecurity() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.session, session);
  queryClient.setQueryData(queryKeys.passwordRules, rules);

  const rootRoute = createRootRoute();
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/profile",
    validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
      tab: typeof search.tab === "string" ? search.tab : undefined,
    }),
    component: () => <ProfilePage tab="security" />,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([profileRoute]),
    history: createMemoryHistory({ initialEntries: ["/profile?tab=security"] }),
  });

  render(
    <QueryClientProvider client={queryClient}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );
}

const submitButton = () => screen.getByRole("button", { name: "Change password" });

beforeEach(() => {
  vi.clearAllMocks();
  changePassword.mockResolvedValue(undefined);
});

describe("the requirement checklist", () => {
  it("states the policy the server reports, not a hardcoded one", async () => {
    renderSecurity();

    // The server here requires a symbol; the registry default does not.
    expect(await screen.findByText("At least 12 characters")).toBeInTheDocument();
    expect(screen.getByText("An uppercase letter")).toBeInTheDocument();
    expect(screen.getByText("A number")).toBeInTheDocument();
    expect(screen.getByText("A symbol")).toBeInTheDocument();
  });

  it("shows the checklist only against the new password", async () => {
    renderSecurity();
    await screen.findByLabelText("Current password");

    // One checklist, not three: current and confirm take no rules.
    expect(screen.getAllByText("A number")).toHaveLength(1);
  });
});

describe("confirmation", () => {
  it("asks the user to confirm the new password", async () => {
    renderSecurity();
    expect(await screen.findByLabelText("Confirm new password")).toBeInTheDocument();
  });

  it("refuses to submit while the two do not match", async () => {
    const user = userEvent.setup({ delay: null });
    renderSecurity();

    await user.type(await screen.findByLabelText("Current password"), "OldPassw0rd!");
    await user.type(screen.getByLabelText("New password"), "N3wPassphrase!");
    await user.type(screen.getByLabelText("Confirm new password"), "N3wPassphrase");

    expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("submits once they match and the policy is met", async () => {
    const user = userEvent.setup({ delay: null });
    renderSecurity();

    await user.type(await screen.findByLabelText("Current password"), "OldPassw0rd!");
    await user.type(screen.getByLabelText("New password"), "N3wPassphrase!");
    await user.type(screen.getByLabelText("Confirm new password"), "N3wPassphrase!");

    expect(submitButton()).toBeEnabled();
    await user.click(submitButton());

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: "OldPassw0rd!",
      newPassword: "N3wPassphrase!",
    });
  });
});

describe("policy gating", () => {
  it("refuses a new password the API would reject", async () => {
    const user = userEvent.setup({ delay: null });
    renderSecurity();

    // Long enough, but no symbol — which this policy requires.
    await user.type(await screen.findByLabelText("Current password"), "OldPassw0rd!");
    await user.type(screen.getByLabelText("New password"), "N3wPassphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "N3wPassphrase");

    expect(submitButton()).toBeDisabled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("still needs the current password", async () => {
    const user = userEvent.setup({ delay: null });
    renderSecurity();

    await user.type(await screen.findByLabelText("New password"), "N3wPassphrase!");
    await user.type(screen.getByLabelText("Confirm new password"), "N3wPassphrase!");

    expect(submitButton()).toBeDisabled();
  });
});
