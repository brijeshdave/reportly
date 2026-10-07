// Author: Brijesh Dave <https://github.com/brijeshdave>
// The cartridge module's failure window, which is the one number on this tab that
// can be got wrong. Zero is a meaningful answer here — it switches the points
// reversal off for the whole company — so it must only ever be saved on purpose.
import { PARTS_MODULE } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { ModulesTab } from "@/routes/companies/modules-tab.js";
import * as settings from "@/services/settings.js";
import type { Session } from "@/services/session.js";

vi.mock("@/services/settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof settings>()),
  fetchCompanySettings: vi.fn(),
  saveCompanySetting: vi.fn(),
}));

const fetchCompanySettings = vi.mocked(settings.fetchCompanySettings);
const saveCompanySetting = vi.mocked(settings.saveCompanySetting);

const COMPANY = "c1";

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
  modules: { parts: true },
  plannedWork: false,
  systemRoles: true,
  twoFactor: { required: false, enrolled: false, deadline: null, overdue: false },
};

/** The module switched on, with the default window. */
function enabled(failureWindowDays = 14) {
  return [
    {
      namespace: PARTS_MODULE.namespace,
      key: PARTS_MODULE.key,
      userOverridable: false,
      description: "",
      value: { enabled: true, failureWindowDays },
    },
  ];
}

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.session, session);

  render(
    <QueryClientProvider client={queryClient}>
      <ModulesTab companyId={COMPANY} />
    </QueryClientProvider>,
  );
}

/** Awaited: the tab shows a spinner until the company's settings arrive. */
const findWindowBox = () => screen.findByLabelText("Failure window (days)");
const windowBox = () => screen.getByLabelText("Failure window (days)");

beforeEach(() => {
  vi.clearAllMocks();
  fetchCompanySettings.mockResolvedValue(enabled());
  saveCompanySetting.mockResolvedValue({
    namespace: PARTS_MODULE.namespace,
    key: PARTS_MODULE.key,
    userOverridable: false,
    description: "",
    value: { enabled: true, failureWindowDays: 30 },
  });
});

describe("the failure window", () => {
  it("saves a number the policy allows", async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();

    await user.clear(await findWindowBox());
    await user.type(windowBox(), "30");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saveCompanySetting).toHaveBeenCalledWith(COMPANY, "parts", "module", {
      enabled: true,
      failureWindowDays: 30,
    });
  });

  it("does not turn an unreadable value into zero", async () => {
    // The regression this pins. The field used to coerce with `Number(draft) || 0`,
    // so anything that is not a number saved **zero** — which does not read as a
    // failed edit, it reads as "the reversal is off", for the whole company, from
    // then on. Nothing is sent now, and the field says why.
    const user = userEvent.setup({ delay: null });
    renderTab();

    await user.clear(await findWindowBox());
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Type a number of days.")).toBeInTheDocument();
    expect(saveCompanySetting).not.toHaveBeenCalled();
  });

  it("refuses a window longer than the schema allows", async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();

    await user.clear(await findWindowBox());
    await user.type(windowBox(), "900");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("A year is as far out as this can reach.")).toBeInTheDocument();
    expect(saveCompanySetting).not.toHaveBeenCalled();
  });

  it("still allows zero when it is typed deliberately", async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();

    await user.clear(await findWindowBox());
    await user.type(windowBox(), "0");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saveCompanySetting).toHaveBeenCalledWith(COMPANY, "parts", "module", {
      enabled: true,
      failureWindowDays: 0,
    });
  });
});
