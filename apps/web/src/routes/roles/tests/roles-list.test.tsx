// Author: Brijesh Dave <https://github.com/brijeshdave>
// Roles are a table, one row each. The previous design gave every role its own
// column, which read well for the four seeded roles and pushed the table off the
// screen once an organisation added its own.
import { PERMISSIONS, type PaginatedResult, type Role } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { RolesListPage } from "@/routes/roles/roles-list.js";
import * as list from "@/services/list.js";
import type { Session } from "@/services/session.js";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

vi.mock("@/services/list.js", async (importOriginal) => ({
  ...(await importOriginal<typeof list>()),
  fetchList: vi.fn(),
}));

const fetchList = vi.mocked(list.fetchList);

function role(overrides: Partial<Role> = {}): Role {
  return {
    id: "r1",
    name: "Auditor",
    isSystem: false,
    permissions: [PERMISSIONS.AUDIT_VIEW],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The API returns system roles first; the table renders what it is given. */
const ROLES: Role[] = [
  role({
    id: "s1",
    name: "Superadmin",
    isSystem: true,
    permissions: [
      PERMISSIONS.USERS_READ,
      PERMISSIONS.USERS_RESET_PASSWORD,
      PERMISSIONS.SETTINGS_MANAGE,
    ],
  }),
  role({ id: "s2", name: "Member", isSystem: true, permissions: [PERMISSIONS.USERS_READ] }),
  role({ id: "c1", name: "Auditor", isSystem: false, permissions: [PERMISSIONS.AUDIT_VIEW] }),
];

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
};

function page(): PaginatedResult<Role> {
  return {
    data: ROLES,
    page: 1,
    pageSize: 20,
    total: ROLES.length,
    totalPages: 1,
    firstPage: 1,
    lastPage: 1,
    previousPage: null,
    nextPage: null,
    hasPrevious: false,
    hasNext: false,
  };
}

function renderRoles() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.session, session);
  queryClient.setQueryData(queryKeys.preferences, {
    theme: { palette: "aurora", mode: "system" },
    tableDefaults: { pageSize: 20, density: "comfortable" },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <RolesListPage />
      </Suspense>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchList.mockResolvedValue(page() as never);
});

describe("the table", () => {
  it("gives each role a row, not a column", async () => {
    renderRoles();

    // One header row plus one row per role — not one column per role.
    const rows = await screen.findAllByRole("row");
    expect(rows).toHaveLength(ROLES.length + 1);

    // The columns are fixed, whatever the number of roles.
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers).toEqual(expect.arrayContaining(["Name", "Type", "Permissions"]));
  });

  it("shows system roles first, as the API orders them", async () => {
    renderRoles();

    const cells = await screen.findAllByRole("cell");
    const names = cells.map((cell) => cell.textContent);
    expect(names[0]).toContain("Superadmin");
  });

  it("marks which roles are fixed", async () => {
    renderRoles();
    // The table and the small-screen card list both render; scope to the table.
    const table = await screen.findByRole("table");
    expect(within(table).getAllByText("System")).toHaveLength(2);
    expect(within(table).getByText("Custom")).toBeInTheDocument();
  });

  it("summarises the permission count per role", async () => {
    renderRoles();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("3 granted")).toBeInTheDocument();
    expect(within(table).getAllByText("1 granted")).toHaveLength(2);
  });
});

describe("opening a role", () => {
  // What a role grants is now its own full page, not a right-hand panel — a
  // permission set is too big to study through a slide-over.
  it("goes to the role's own page from its name", async () => {
    const user = userEvent.setup({ delay: null });
    renderRoles();

    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Member" }));

    expect(navigate).toHaveBeenCalledWith({ to: "/roles/$roleId", params: { roleId: "s2" } });
  });

  it("goes to the same page from the permission count", async () => {
    const user = userEvent.setup({ delay: null });
    renderRoles();

    const table = await screen.findByRole("table");
    // Two roles hold one permission each; either count opens its own role.
    await user.click(within(table).getAllByRole("button", { name: "1 granted" })[0]!);

    expect(navigate).toHaveBeenCalledWith({
      to: "/roles/$roleId",
      params: { roleId: expect.any(String) },
    });
  });
});

describe("row actions", () => {
  it("never offers edit or delete on a system role", async () => {
    renderRoles();
    await screen.findAllByRole("row");

    expect(screen.getByRole("button", { name: "Clone Superadmin" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Superadmin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Superadmin" })).not.toBeInTheDocument();
  });

  it("offers all three on a custom role", async () => {
    renderRoles();
    await screen.findAllByRole("row");

    expect(screen.getByRole("button", { name: "Clone Auditor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Auditor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Auditor" })).toBeInTheDocument();
  });
});
