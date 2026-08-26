// Author: Brijesh Dave <https://github.com/brijeshdave>
// The API refuses every route but /me once a password expires, and the router
// redirects the user here. Without an explanation on the page, that redirect just
// looks like the app is broken.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { ProfilePage } from "@/routes/profile/profile-page.js";
import type { Session } from "@/services/session.js";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,fake") },
}));

function session(passwordExpired: boolean): Session {
  return {
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
    passwordExpired,
    queueAdmin: "off",
    modules: { parts: false },
    plannedWork: false,
    systemRoles: true,
    twoFactor: { required: false, enrolled: false, deadline: null, overdue: false },
  };
}

/** Mount the page at /profile so its `useNavigate({ from })` resolves. */
function renderProfile(passwordExpired: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.session, session(passwordExpired));
  queryClient.setQueryData(queryKeys.passwordRules, {
    minLength: 12,
    requireUppercase: true,
    requireNumber: true,
    requireSymbol: false,
  });

  const rootRoute = createRootRoute();
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/profile",
    validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
      tab: typeof search.tab === "string" ? search.tab : undefined,
    }),
    component: () => <ProfilePage tab="profile" />,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([profileRoute]),
    history: createMemoryHistory({ initialEntries: ["/profile"] }),
  });

  render(
    <QueryClientProvider client={queryClient}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );
}

describe("password expiry notice", () => {
  it("tells an expired user why they were sent here", async () => {
    renderProfile(true);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your password needs changing");
    expect(alert).toHaveTextContent("Security");
  });

  it("says nothing when the password is current", async () => {
    renderProfile(false);

    await screen.findByRole("heading", { name: "Your account" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
