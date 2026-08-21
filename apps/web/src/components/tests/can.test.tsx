// Author: Brijesh Dave <https://github.com/brijeshdave>
// <Can> must mirror the API's `can()`: show only what the caller may actually do,
// and let a superadmin through regardless of the listed permissions.
import { PERMISSIONS } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { expect, it } from "vitest";

import { Can } from "@/components/can.js";
import { queryKeys } from "@/lib/queries.js";
import type { Session } from "@/services/session.js";

function renderWithSession(session: Partial<Session>, ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.session, {
    user: {
      id: "u1",
      name: "Test",
      email: "t@x.io",
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
    systemRoles: true,
    ...session,
  } satisfies Session);

  return render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>{ui}</Suspense>
    </QueryClientProvider>,
  );
}

it("renders children when the permission is granted", () => {
  renderWithSession(
    { permissions: [PERMISSIONS.USERS_READ] },
    <Can permission={PERMISSIONS.USERS_READ}>visible</Can>,
  );
  expect(screen.getByText("visible")).toBeInTheDocument();
});

it("renders the fallback when the permission is missing", () => {
  renderWithSession(
    { permissions: [PERMISSIONS.USERS_READ] },
    <Can permission={PERMISSIONS.USERS_RESET_PASSWORD} fallback={<span>denied</span>}>
      visible
    </Can>,
  );
  expect(screen.queryByText("visible")).not.toBeInTheDocument();
  expect(screen.getByText("denied")).toBeInTheDocument();
});

it("lets a superadmin through without the explicit permission", () => {
  renderWithSession(
    { isSuperadmin: true, permissions: [] },
    <Can permission={PERMISSIONS.SETTINGS_MANAGE}>admin only</Can>,
  );
  expect(screen.getByText("admin only")).toBeInTheDocument();
});
