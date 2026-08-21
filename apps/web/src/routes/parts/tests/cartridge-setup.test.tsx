// Author: Brijesh Dave <https://github.com/brijeshdave>
// What a cartridge model fits, and being able to change it.
//
// Both of these are here because both were missing, and their absence was
// reported as "not all the types are showing" — which is what a screen with no
// empty state and no edit path looks like from the outside.
//
// The compatibility list is the one thing that decides whether a part can be
// installed at all. A model that fits nothing refuses every install, and until
// this could be edited, a model created before the right device type existed was
// permanently useless.
import { PERMISSIONS, type PartModel } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { CartridgeSetupPage } from "@/routes/parts/cartridge-setup.js";
import * as parts from "@/services/parts.js";
import { http } from "@/services/http.js";
import type { Session } from "@/services/session.js";

vi.mock("@tanstack/react-router", () => ({
  // `to` becomes a real href so the assertion below tests a link rather than
  // some text; `search` is an object and would be an invalid DOM attribute.
  Link: ({
    children,
    to,
    search: _search,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    search?: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/services/parts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof parts>()),
  fetchPartModels: vi.fn(),
  updatePartModel: vi.fn(),
  fetchServiceKinds: vi.fn(),
  fetchConsumables: vi.fn(),
  fetchRates: vi.fn(),
  updateServiceKind: vi.fn(),
}));

// The device-type picker loads through the generic options hook, which goes
// straight to the HTTP client rather than a typed service.
vi.mock("@/services/http.js", async (importOriginal) => {
  const actual = await importOriginal<{ http: typeof http }>();
  return { ...actual, http: { ...actual.http, get: vi.fn() } };
});

const TYPES = [
  { id: "t1", name: "HP LaserJet M404", departmentName: "IT" },
  { id: "t2", name: "Brother HL-L2350", departmentName: "IT" },
];

function model(overrides: Partial<PartModel> = {}): PartModel {
  return {
    id: "m1",
    name: "HP 12A Toner",
    description: null,
    cycleLimit: 6,
    ratedPageYield: 2300,
    status: "active",
    compatibleDeviceTypeIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function session(): Session {
  return {
    user: {
      id: "u1",
      name: "Asha",
      email: "a@x.io",
      avatarUrl: null,
      avatarVersion: null,
      status: "active",
      twoFactorEnabled: false,
    },
    companyId: "c1",
    isSuperadmin: false,
    groups: [],
    companies: [],
    locationIds: [],
    permissions: [PERMISSIONS.PARTS_READ, PERMISSIONS.PARTS_CONFIGURE] as Session["permissions"],
    passwordExpired: false,
    queueAdmin: "off",
    modules: { parts: true },
    systemRoles: true,
  };
}

function renderSetup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.session, session());
  render(
    <QueryClientProvider client={queryClient}>
      <CartridgeSetupPage tab="models" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parts.fetchServiceKinds).mockResolvedValue([]);
  vi.mocked(parts.fetchConsumables).mockResolvedValue([]);
  vi.mocked(parts.fetchRates).mockResolvedValue([]);
  vi.mocked(http.get).mockResolvedValue(TYPES);
});

describe("what a model fits", () => {
  it("says a model fits nothing rather than showing a zero", async () => {
    // This is the sentence that answers "why is every install being refused".
    vi.mocked(parts.fetchPartModels).mockResolvedValue([model()]);
    renderSetup();

    expect(await screen.findByText(/fits nothing yet/)).toBeInTheDocument();
  });

  it("names the types a model fits", async () => {
    vi.mocked(parts.fetchPartModels).mockResolvedValue([
      model({ compatibleDeviceTypeIds: ["t1", "t2"] }),
    ]);
    renderSetup();

    expect(await screen.findByText(/fits HP LaserJet M404, Brother HL-L2350/)).toBeInTheDocument();
  });

  it("changes what an existing model fits", async () => {
    // The gap this closes: a model created before the right device type existed
    // could never be made to fit anything, and nothing built on it could be
    // installed.
    vi.mocked(parts.fetchPartModels).mockResolvedValue([model()]);
    vi.mocked(parts.updatePartModel).mockResolvedValue(model({ compatibleDeviceTypeIds: ["t1"] }));
    renderSetup();

    await userEvent.click(await screen.findByRole("button", { name: "Fits" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /HP LaserJet M404/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(parts.updatePartModel).toHaveBeenCalledWith("m1", {
        compatibleDeviceTypeIds: ["t1"],
      }),
    );
  });

  it("does not keep a cancelled edit as a draft", async () => {
    // Reopening has to show what the model actually says, or a tick somebody
    // abandoned gets saved later by somebody who never made it.
    vi.mocked(parts.fetchPartModels).mockResolvedValue([model()]);
    renderSetup();

    await userEvent.click(await screen.findByRole("button", { name: "Fits" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /HP LaserJet M404/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await userEvent.click(screen.getByRole("button", { name: "Fits" }));
    expect(await screen.findByRole("checkbox", { name: /HP LaserJet M404/ })).not.toBeChecked();
  });

  it("says where device types come from even when the list is not empty", async () => {
    // The reported symptom, and the reason this is not conditional: somebody
    // whose type is missing from a list of five needs the sentence more than
    // somebody looking at none, and they are exactly who never saw it.
    vi.mocked(parts.fetchPartModels).mockResolvedValue([model()]);
    renderSetup();

    await userEvent.click(await screen.findByRole("button", { name: "Fits" }));
    expect(await screen.findByRole("link", { name: /Journal setup/ })).toBeInTheDocument();
    expect(
      screen.getByText(/add one there if the machine you want is missing/),
    ).toBeInTheDocument();
  });

  it("says the company has none when it has none", async () => {
    vi.mocked(http.get).mockResolvedValue([]);
    vi.mocked(parts.fetchPartModels).mockResolvedValue([model()]);
    renderSetup();

    await userEvent.click(await screen.findByRole("button", { name: "Fits" }));
    expect(await screen.findByText(/this company has none yet/i)).toBeInTheDocument();
  });

  it("names the department beside each type", async () => {
    // Two departments may name a type the same, and without this the duplicate
    // is a coin toss.
    vi.mocked(parts.fetchPartModels).mockResolvedValue([model()]);
    renderSetup();

    await userEvent.click(await screen.findByRole("button", { name: "Fits" }));
    expect(await screen.findByRole("checkbox", { name: /HP LaserJet M404 \(IT\)/ })).toBeVisible();
  });
});

describe("what a service kind uses", () => {
  const KINDS = [
    {
      id: "k1",
      name: "Refill",
      description: null,
      defaultPoints: 2,
      status: "active" as const,
      consumables: [{ consumableId: "c1", minQuantity: 1, maxQuantity: 2 }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "k2",
      name: "Repair",
      description: null,
      defaultPoints: 2,
      status: "active" as const,
      consumables: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const CONSUMABLES = [
    {
      id: "c1",
      name: "Toner Powder",
      unit: "ea" as const,
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "c2",
      name: "OPC Drum",
      unit: "ea" as const,
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  function renderKinds() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(queryKeys.session, session());
    render(
      <QueryClientProvider client={queryClient}>
        <CartridgeSetupPage tab="kinds" />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    vi.mocked(parts.fetchServiceKinds).mockResolvedValue(KINDS);
    vi.mocked(parts.fetchConsumables).mockResolvedValue(CONSUMABLES);
    vi.mocked(parts.fetchPartModels).mockResolvedValue([]);
  });

  it("names what a kind uses, and what it requires", async () => {
    renderKinds();
    expect(await screen.findByText(/uses Toner Powder \(needs 1\)/)).toBeInTheDocument();
    // A kind with no rules is unrestricted. It says so, and points at the control
    // that changes it — the reported "why does Refill offer every consumable"
    // was this feature existing and nothing on the screen naming it.
    expect(screen.getByText(/offers every consumable — set Uses to narrow it/)).toBeInTheDocument();
  });

  it("saves a kind's rules with their quantities", async () => {
    vi.mocked(parts.updateServiceKind).mockResolvedValue(KINDS[0]!);
    renderKinds();

    await userEvent.click((await screen.findAllByRole("button", { name: "Uses" }))[1]!);
    await userEvent.click(await screen.findByRole("checkbox", { name: /OPC Drum/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(parts.updateServiceKind).toHaveBeenCalledWith("k2", {
        consumables: [{ consumableId: "c2", minQuantity: 0, maxQuantity: null }],
      }),
    );
  });
});
