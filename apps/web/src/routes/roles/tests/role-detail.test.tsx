// Author: Brijesh Dave <https://github.com/brijeshdave>
// What a role grants is its own full page now. The rules that used to live on the
// slide-over live here: a system role may be cloned but never edited, and the page
// says plainly which permissions the role does and does not hold.
import { PERMISSIONS, type Role } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { RoleDetailPage } from "@/routes/roles/role-detail-page.js";
import * as roles from "@/services/roles.js";
import type { Session } from "@/services/session.js";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

vi.mock("@/services/roles.js", async (importOriginal) => ({
  ...(await importOriginal<typeof roles>()),
  fetchRole: vi.fn(),
  fetchRoleReferences: vi.fn(),
}));

const fetchRole = vi.mocked(roles.fetchRole);
const fetchRoleReferences = vi.mocked(roles.fetchRoleReferences);

function role(overrides: Partial<Role> = {}): Role {
  return {
    id: "r1",
    name: "Auditor",
    isSystem: false,
    permissions: [PERMISSIONS.USERS_READ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const session: Session = {
  user: {
    id: "u1",
    name: "Admin",
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
};

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.session, session);
  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <RoleDetailPage roleId="r1" />
      </Suspense>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchRoleReferences.mockResolvedValue([]);
});

describe("RoleDetailPage", () => {
  it("says what the role does and does not hold", async () => {
    fetchRole.mockResolvedValue(role());
    renderDetail();

    const user = userEvent.setup({ delay: null });
    await screen.findByRole("tab", { name: /^People & access/ });
    await user.click(screen.getByRole("tab", { name: /^People & access/ }));

    expect(screen.getByText("Auditor has users:read")).toBeInTheDocument();
    expect(screen.getByText("Auditor does not have users:reset-password")).toBeInTheDocument();
  });

  it("offers clone on a system role, but never edit", async () => {
    fetchRole.mockResolvedValue(role({ name: "Member", isSystem: true }));
    renderDetail();

    expect(await screen.findByRole("button", { name: /Clone/ })).toBeInTheDocument();
    // Editing a system role would silently re-grant every group holding it.
    expect(screen.queryByRole("button", { name: /Edit permissions/ })).not.toBeInTheDocument();
  });

  it("offers edit on a custom role", async () => {
    fetchRole.mockResolvedValue(role());
    renderDetail();
    expect(await screen.findByRole("button", { name: /Edit permissions/ })).toBeInTheDocument();
  });

  it("names the groups that hold the role", async () => {
    fetchRole.mockResolvedValue(role());
    fetchRoleReferences.mockResolvedValue([{ id: "g1", name: "Compliance" }]);
    renderDetail();
    expect(await screen.findByText(/One group holds this role: Compliance/)).toBeInTheDocument();
  });
});
