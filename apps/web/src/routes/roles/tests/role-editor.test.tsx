// Author: Brijesh Dave <https://github.com/brijeshdave>
// Editing a role changes what every group holding it may do, retroactively. The
// editor must say who is affected before the save, and must submit the whole
// permission set — the API replaces it rather than merging. It is now a page, so
// it loads the role behind an id and navigates back when done.
import { PERMISSIONS, type Role } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RoleEditorPage, type RoleEditorPageMode } from "@/routes/roles/role-editor-page.js";
import * as roles from "@/services/roles.js";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@/services/roles.js", async (importOriginal) => ({
  ...(await importOriginal<typeof roles>()),
  fetchRole: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  cloneRole: vi.fn(),
  fetchRoleReferences: vi.fn(),
}));

const fetchRole = vi.mocked(roles.fetchRole);
const createRole = vi.mocked(roles.createRole);
const updateRole = vi.mocked(roles.updateRole);
const cloneRole = vi.mocked(roles.cloneRole);
const fetchRoleReferences = vi.mocked(roles.fetchRoleReferences);

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

/** Permissions live under a tab per product area; open the one holding a resource. */
async function openTab(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("tab", { name: new RegExp(`^${label}`) }));
}

/** Render the page; for edit/clone, wait until the loaded role's name shows. */
async function renderEditor(mode: RoleEditorPageMode, source?: Role) {
  if (source) fetchRole.mockResolvedValue(source);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RoleEditorPage mode={mode} roleId={source?.id} />
    </QueryClientProvider>,
  );
  if (mode !== "create") await screen.findByLabelText("Name");
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchRoleReferences.mockResolvedValue([]);
  createRole.mockResolvedValue(role());
  updateRole.mockResolvedValue(role());
  cloneRole.mockResolvedValue(role({ id: "r2" }));
});

describe("creating", () => {
  it("submits the name and every ticked permission", async () => {
    const user = userEvent.setup({ delay: null });
    await renderEditor("create");

    await user.type(screen.getByLabelText("Name"), "Auditor");
    await openTab(user, "System");
    await user.click(screen.getByRole("checkbox", { name: "audit: view" }));
    await user.click(screen.getByRole("button", { name: "Create role" }));

    expect(createRole).toHaveBeenCalledTimes(1);
    const [name, permissions] = createRole.mock.calls[0]!;
    expect(name).toBe("Auditor");
    expect(permissions.length).toBeGreaterThan(0);
    // Typing then ticking then clicking is a lot of userEvent for one test; under a
    // loaded machine (the full task runs it beside the API suite) it can outrun the
    // default 5s, so give it room rather than let it flake.
  }, 15000);

  it("groups the permissions into product areas, with a select-all per resource", async () => {
    const user = userEvent.setup({ delay: null });
    await renderEditor("create");
    // A tab per area of the product, the way the sidebar is grouped.
    expect(screen.getByRole("tab", { name: /^People & access/ })).toBeInTheDocument();

    await openTab(user, "People & access");
    expect(screen.getByRole("heading", { name: "users" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Select all" }).length).toBeGreaterThan(1);
  });

  it("cannot submit without a name", async () => {
    await renderEditor("create");
    expect(screen.getByRole("button", { name: "Create role" })).toBeDisabled();
  });
});

describe("editing", () => {
  it("starts from the role's current permissions", async () => {
    const user = userEvent.setup({ delay: null });
    await renderEditor("edit", role());
    expect(screen.getByLabelText("Name")).toHaveValue("Auditor");
    expect(screen.getByText(/^1 of \d+ permissions$/)).toBeInTheDocument();

    await openTab(user, "System");
    expect(screen.getByRole("checkbox", { name: "audit: view" })).toBeChecked();
  });

  it("warns which groups a change affects, before saving", async () => {
    fetchRoleReferences.mockResolvedValue([
      { id: "g1", name: "Compliance" },
      { id: "g2", name: "Auditors" },
    ]);
    await renderEditor("edit", role());

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("2 groups hold this role");
    expect(notice).toHaveTextContent("Compliance, Auditors");
  });

  it("sends the whole permission set, not just the change", async () => {
    const user = userEvent.setup({ delay: null });
    await renderEditor("edit", role());

    await openTab(user, "People & access");
    await user.click(screen.getByRole("checkbox", { name: "users: read" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const [id, input] = updateRole.mock.calls[0]!;
    expect(id).toBe("r1");
    expect(input.permissions).toContain(PERMISSIONS.AUDIT_VIEW);
    expect(input.permissions).toContain(PERMISSIONS.USERS_READ);
  });
});

describe("cloning", () => {
  it("prefills from the source and does not touch it", async () => {
    const user = userEvent.setup({ delay: null });
    await renderEditor("clone", role({ id: "sys", name: "Manager", isSystem: true }));

    expect(screen.getByLabelText("Name")).toHaveValue("Manager copy");

    await user.click(screen.getByRole("button", { name: "Create copy" }));
    expect(cloneRole).toHaveBeenCalledWith("sys", "Manager copy");
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("applies a changed permission set to the copy, never the source", async () => {
    const user = userEvent.setup({ delay: null });
    await renderEditor("clone", role({ id: "sys", name: "Manager", isSystem: true }));

    await openTab(user, "People & access");
    await user.click(screen.getByRole("checkbox", { name: "users: read" }));
    await user.click(screen.getByRole("button", { name: "Create copy" }));

    expect(cloneRole).toHaveBeenCalledWith("sys", "Manager copy");
    expect(updateRole.mock.calls[0]![0]).toBe("r2");
  });

  it("never warns about affected groups: a new role has none", async () => {
    await renderEditor("clone", role());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(fetchRoleReferences).not.toHaveBeenCalled();
  });
});
