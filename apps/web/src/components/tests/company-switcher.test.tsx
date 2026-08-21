// Author: Brijesh Dave <https://github.com/brijeshdave>
// "All companies" means *no* company, and permissions are resolved per company —
// so for anybody but a superadmin that state grants nothing at all: an empty
// sidebar and a 403 from every call. It looks exactly like somebody's access has
// been revoked, which is how it was reported: "I removed nothing and the user can
// see nothing."
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";

import { CompanySwitcher } from "@/components/app-shell.js";
import { queryKeys } from "@/lib/queries.js";
import { getActiveCompanyId, setActiveCompanyId } from "@/services/http.js";
import type { Session } from "@/services/session.js";

function session(over: Partial<Session>): Session {
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
    companies: [
      { id: "c1", name: "Plant Co" },
      { id: "c2", name: "Other Co" },
    ],
    locationIds: [],
    permissions: [],
    passwordExpired: false,
    queueAdmin: "off",
    modules: { parts: false },
    systemRoles: true,
    twoFactor: { required: false, enrolled: false, deadline: null, overdue: false },
    ...over,
  };
}

function renderSwitcher(over: Partial<Session>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.session, session(over));
  render(
    <QueryClientProvider client={queryClient}>
      <CompanySwitcher />
    </QueryClientProvider>,
  );
}

describe("the company switcher", () => {
  beforeEach(() => setActiveCompanyId(null));

  it("puts an ordinary user into a company rather than leaving them in none", async () => {
    renderSwitcher({ companyId: null });

    // Their own first company, chosen for them: the alternative is an app that
    // renders empty and reads as broken permissions.
    await waitFor(() => expect(getActiveCompanyId()).toBe("c1"));
  });

  it("does not offer 'All companies' to an ordinary user", () => {
    renderSwitcher({ companyId: "c1" });

    expect(screen.queryByRole("option", { name: "All companies" })).toBeNull();
    expect(screen.getByRole("option", { name: "Plant Co" })).toBeInTheDocument();
  });

  it("keeps 'All companies' for a superadmin, who holds everything anyway", () => {
    renderSwitcher({ companyId: null, isSuperadmin: true });

    expect(screen.getByRole("option", { name: "All companies" })).toBeInTheDocument();
    // And leaves them there — for a superadmin it is a real, working view.
    expect(getActiveCompanyId()).toBeNull();
  });
});
