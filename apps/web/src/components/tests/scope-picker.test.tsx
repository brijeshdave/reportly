// Author: Brijesh Dave <https://github.com/brijeshdave>
// What an entry is about — specifically the one rule in here that is a UI decision
// rather than a server one:
//
// **Naming an end user replaces the department target.** The department chosen beside
// it goes on narrowing the list of people, but it stops being what the entry is
// recorded against. Without that, an issue about one person's laptop would be counted
// twice — once against them and once against everybody in their department, which is
// what 198 of the first 199 such entries actually did.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScopePicker, type ScopeTarget } from "@/routes/journal/scope-picker.js";
import * as assetsService from "@/services/assets.js";
import * as departmentsService from "@/services/departments.js";
import * as endUsersService from "@/services/end-users.js";

vi.mock("@/services/assets.js", async (importOriginal) => ({
  ...(await importOriginal<typeof assetsService>()),
  fetchAssets: vi.fn(),
  fetchDevices: vi.fn(),
}));
vi.mock("@/services/departments.js", async (importOriginal) => ({
  ...(await importOriginal<typeof departmentsService>()),
  fetchDepartments: vi.fn(),
}));
vi.mock("@/services/end-users.js", async (importOriginal) => ({
  ...(await importOriginal<typeof endUsersService>()),
  fetchPickableEndUsers: vi.fn(),
}));

const fetchAssets = vi.mocked(assetsService.fetchAssets);
const fetchDepartments = vi.mocked(departmentsService.fetchDepartments);
const fetchPickableEndUsers = vi.mocked(endUsersService.fetchPickableEndUsers);

const ACCOUNTS = "11111111-1111-4111-8111-111111111111";
const STORES = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  fetchAssets.mockResolvedValue([]);
  fetchDepartments.mockResolvedValue([
    {
      id: ACCOUNTS,
      name: "Accounts",
      path: "Accounts",
      companyId: "c1",
    },
    {
      id: STORES,
      name: "Stores",
      path: "Stores",
      companyId: "c1",
    },
  ] as unknown as Awaited<ReturnType<typeof departmentsService.fetchDepartments>>);
  fetchPickableEndUsers.mockResolvedValue([
    {
      id: "e1",
      fullName: "Anita Sharma",
      employeeNumber: "EMP-1001",
      departmentName: "Accounts",
    },
  ]);
});

/** Renders the picker as a controlled field, and reports what it asked for. */
function renderPicker(initial: ScopeTarget[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let latest: ScopeTarget[] = initial;
  const onChange = vi.fn((next: ScopeTarget[]) => {
    latest = next;
    rerender(next);
  });
  const tree = (value: ScopeTarget[]) => (
    <QueryClientProvider client={client}>
      <ScopePicker value={value} onChange={onChange} />
    </QueryClientProvider>
  );
  const result = render(tree(initial));
  const rerender = (value: ScopeTarget[]) => result.rerender(tree(value));
  return { onChange, current: () => latest };
}

const open = async (user: ReturnType<typeof userEvent.setup>, label: string) =>
  user.click(screen.getByLabelText(label));

const pick = async (user: ReturnType<typeof userEvent.setup>, label: string) =>
  user.click(await screen.findByRole("option", { name: new RegExp(label) }));

describe("ScopePicker end users", () => {
  it("offers the people in the departments chosen", async () => {
    const user = userEvent.setup({ delay: null });
    renderPicker();

    await open(user, "Departments this report is about");
    await pick(user, "Accounts");

    // The narrowing is the server's: the request carries the department, so a plant
    // of thousands costs one small list rather than all of them.
    await vi.waitFor(() => expect(fetchPickableEndUsers).toHaveBeenCalledWith([ACCOUNTS]));
  });

  it("is searched by employee number as well as by name", async () => {
    // Asked for in as many words. The number is part of the option's own label, so
    // the picker's search finds it without a second, invisible search field.
    const user = userEvent.setup({ delay: null });
    fetchPickableEndUsers.mockResolvedValue([
      { id: "e1", fullName: "Anita Sharma", employeeNumber: "EMP-1001", departmentName: null },
      { id: "e2", fullName: "Ravi Kumar", employeeNumber: "EMP-1002", departmentName: null },
    ]);
    renderPicker();

    await open(user, "End users this report is about");
    await screen.findByRole("option", { name: /Anita Sharma/ });
    await user.type(screen.getAllByLabelText("Search options")[0]!, "EMP-1002");

    expect(screen.getByRole("option", { name: /Ravi Kumar/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Anita Sharma/ })).not.toBeInTheDocument();
  });

  it("replaces the department target once somebody is named", async () => {
    const user = userEvent.setup({ delay: null });
    const picker = renderPicker();

    await open(user, "Departments this report is about");
    await pick(user, "Accounts");
    expect(picker.current()).toEqual([{ kind: "department", id: ACCOUNTS, label: "Accounts" }]);

    await open(user, "End users this report is about");
    await pick(user, "Anita Sharma");

    // The person, and only the person: the department is narrowing, not recording.
    expect(picker.current()).toEqual([
      { kind: "endUser", id: "e1", label: "Anita Sharma (EMP-1001)" },
    ]);
  });

  it("puts the department back when the last person is cleared", async () => {
    const user = userEvent.setup({ delay: null });
    const picker = renderPicker();

    await open(user, "Departments this report is about");
    await pick(user, "Accounts");
    await open(user, "End users this report is about");
    await pick(user, "Anita Sharma");
    // Same option again: the multi-select toggles.
    await pick(user, "Anita Sharma");

    expect(picker.current()).toEqual([{ kind: "department", id: ACCOUNTS, label: "Accounts" }]);
  });

  it("keeps the department of an entry it was handed, not of the first render", async () => {
    const user = userEvent.setup({ delay: null });
    // An entry being edited: its targets are already there, which is the case that
    // state seeded at mount got wrong.
    const picker = renderPicker([{ kind: "department", id: STORES, label: "Stores" }]);

    await open(user, "End users this report is about");
    await pick(user, "Anita Sharma");
    expect(picker.current()).toEqual([
      { kind: "endUser", id: "e1", label: "Anita Sharma (EMP-1001)" },
    ]);

    await pick(user, "Anita Sharma");
    expect(picker.current()).toEqual([{ kind: "department", id: STORES, label: "Stores" }]);
  });
});
