// Author: Brijesh Dave <https://github.com/brijeshdave>
// The one move a cartridge can make next.
//
// The actions are driven by status rather than all shown and half disabled, so
// the thing worth testing is that the screen offers exactly the transition the
// API would accept. Offering "Install" on a part already in a printer is not a
// cosmetic slip: somebody presses it, gets a 409, and learns to distrust the
// buttons.
//
// The permission half matters for the same reason: a technician who may install
// but not scrap must not see a Scrap button that would 403.
import { PERMISSIONS, type Part, type PartEvent, type PartModel } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { PartDetailPage } from "@/routes/parts/part-detail.js";
import * as parts from "@/services/parts.js";
import type { Session } from "@/services/session.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock("@/services/parts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof parts>()),
  fetchPart: vi.fn(),
  fetchPartTimeline: vi.fn(),
  fetchPartModel: vi.fn(),
  fetchFittingDevices: vi.fn(),
  fetchServiceKinds: vi.fn(),
  fetchConsumables: vi.fn(),
}));

const fetchPart = vi.mocked(parts.fetchPart);

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "p1",
    identifier: "TN-0042",
    partModelId: "m1",
    partModelName: "HP 12A Toner",
    status: "needs_service",
    cycleCount: 2,
    overCycleLimit: false,
    locationId: null,
    locationName: "Store room",
    deviceId: null,
    deviceName: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function session(permissions: string[]): Session {
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
    permissions: permissions as Session["permissions"],
    passwordExpired: false,
    queueAdmin: "off",
    modules: { parts: true },
  };
}

function renderDetail(permissions: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.session, session(permissions));
  render(
    <QueryClientProvider client={queryClient}>
      <PartDetailPage partId="p1" />
    </QueryClientProvider>,
  );
}

const TECHNICIAN = [PERMISSIONS.PARTS_READ, PERMISSIONS.PARTS_DEPLOY, PERMISSIONS.PARTS_SERVICE];

/** One timeline entry. Defaults to a finished tour of duty. */
function tour(overrides: Partial<PartEvent> = {}): PartEvent {
  return {
    id: "removed:pl1",
    at: "2026-02-01T00:00:00.000Z",
    kind: "removed",
    actorName: "Asha",
    deviceName: "Reception LJ-01",
    serviceKindName: null,
    outcome: "ok",
    points: null,
    pointsReversedAt: null,
    meterStart: null,
    meterEnd: null,
    pagesPrinted: null,
    consumptions: [],
    note: null,
    ...overrides,
  };
}

function model(ratedPageYield: number | null): PartModel {
  return {
    id: "m1",
    name: "HP 12A Toner",
    description: null,
    cycleLimit: 6,
    ratedPageYield,
    status: "active",
    compatibleDeviceTypeIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parts.fetchPartTimeline).mockResolvedValue([]);
  vi.mocked(parts.fetchPartModel).mockResolvedValue(model(2300));
  vi.mocked(parts.fetchFittingDevices).mockResolvedValue([
    { id: "d1", name: "Reception LJ-01", typeName: "Printers LaserJet" },
  ]);
  vi.mocked(parts.fetchServiceKinds).mockResolvedValue([]);
  vi.mocked(parts.fetchConsumables).mockResolvedValue([]);
});

describe("PartDetailPage", () => {
  it("offers Install and Service for a part that is ready", async () => {
    // Ready is the only state an install accepts. Servicing one already ready is
    // a top-up, which is somebody's business and not ours to refuse.
    fetchPart.mockResolvedValue(part({ status: "ready" }));
    renderDetail(TECHNICIAN);

    expect(await screen.findByRole("button", { name: /install/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^service$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /book in/i })).not.toBeInTheDocument();
  });

  it("offers only Book in for a part inside a printer", async () => {
    fetchPart.mockResolvedValue(
      part({ status: "installed", deviceId: "d1", deviceName: "Reception LJ-01" }),
    );
    renderDetail(TECHNICIAN);

    expect(await screen.findByRole("button", { name: /book in/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
    // Nor Scrap, even for somebody who holds parts:manage — a part inside a
    // machine is still inside it.
    expect(screen.queryByRole("button", { name: /scrap/i })).not.toBeInTheDocument();
  });

  it("offers Service and Mark ready for one awaiting service", async () => {
    fetchPart.mockResolvedValue(part({ status: "needs_service" }));
    renderDetail(TECHNICIAN);

    expect(await screen.findByRole("button", { name: /^service$/i })).toBeInTheDocument();
    // Restock is the honest way back for one that came off working: forcing a
    // service event to move it would pay somebody for work nobody did.
    expect(screen.getByRole("button", { name: /mark ready/i })).toBeInTheDocument();
  });

  it("hides Service from somebody who may deploy but not service", async () => {
    // The two are separate grants because only one of them pays.
    fetchPart.mockResolvedValue(part({ status: "needs_service" }));
    renderDetail([PERMISSIONS.PARTS_READ, PERMISSIONS.PARTS_DEPLOY]);

    expect(await screen.findByRole("button", { name: /mark ready/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^service$/i })).not.toBeInTheDocument();
  });

  it("says a part is past its rated cycles without refusing anything", async () => {
    fetchPart.mockResolvedValue(part({ status: "ready", cycleCount: 7, overCycleLimit: true }));
    renderDetail(TECHNICIAN);

    expect(await screen.findByText(/past its rated cycles/i)).toBeInTheDocument();
    // Advisory, never a block: the maker's figure is an opinion and the person
    // holding the part knows better.
    expect(screen.getByRole("button", { name: /install/i })).toBeEnabled();
  });
});

describe("page counts on the part", () => {
  it("shows what a tour printed against the model's rated figure", async () => {
    fetchPart.mockResolvedValue(part({ status: "ready" }));
    vi.mocked(parts.fetchPartTimeline).mockResolvedValue([
      tour({ meterStart: 48_120, meterEnd: 49_970 }),
    ]);
    renderDetail(TECHNICIAN);

    // The exact string, not a substring: with one measured tour the header's
    // average says "1,850" too, and a loose match finds both.
    expect(await screen.findByText("1,850")).toBeInTheDocument();
    // Awaited separately: the rated figure comes from the model, which is a
    // second request and lands a tick after the history.
    expect(await screen.findByText(/80% of rated/)).toBeInTheDocument();
  });

  it("says a meter was reset rather than showing a dash", async () => {
    // "Not recorded" and "the counter went backwards" send a reader to fix
    // different things, so they must not read the same.
    fetchPart.mockResolvedValue(part({ status: "ready" }));
    vi.mocked(parts.fetchPartTimeline).mockResolvedValue([
      tour({ meterStart: 49_970, meterEnd: 120 }),
    ]);
    renderDetail(TECHNICIAN);

    expect(await screen.findByText(/meter reset/i)).toBeInTheDocument();
  });

  it("shows pages without a comparison when the model has no rated figure", async () => {
    fetchPart.mockResolvedValue(part({ status: "ready" }));
    vi.mocked(parts.fetchPartModel).mockResolvedValue(model(null));
    vi.mocked(parts.fetchPartTimeline).mockResolvedValue([tour({ pagesPrinted: 1420 })]);
    renderDetail(TECHNICIAN);

    expect(await screen.findByText("1,420")).toBeInTheDocument();
    expect(screen.queryByText(/% of rated/)).not.toBeInTheDocument();
  });

  it("averages the measured tours in the header, ignoring the unmeasured ones", async () => {
    // The unmeasured tour is left out rather than counted as zero, which would
    // make a healthy cartridge look like a failing one.
    fetchPart.mockResolvedValue(part({ status: "ready" }));
    vi.mocked(parts.fetchPartTimeline).mockResolvedValue([
      tour({ id: "a", meterStart: 0, meterEnd: 2000 }),
      tour({ id: "b" }),
      tour({ id: "c", meterStart: 0, meterEnd: 1000 }),
    ]);
    renderDetail(TECHNICIAN);

    expect(await screen.findByText(/1,500 pages a tour on average/)).toBeInTheDocument();
  });

  it("asks for the counter when one was read on the way in", async () => {
    // And for a plain page count when none was: two boxes saying the same thing
    // would leave the reader deciding which we meant.
    fetchPart.mockResolvedValue(part({ status: "installed", deviceId: "d1" }));
    vi.mocked(parts.fetchPartTimeline).mockResolvedValue([
      tour({ id: "installed:pl1", kind: "installed", outcome: null, meterStart: 48_120 }),
    ]);
    renderDetail(TECHNICIAN);

    await userEvent.click(await screen.findByRole("button", { name: /book in/i }));
    expect(await screen.findByLabelText(/printer's page counter/i)).toBeInTheDocument();
    expect(screen.getByText(/48,120 when this cartridge went in/)).toBeInTheDocument();
  });

  it("asks for a plain page count when no counter was read", async () => {
    fetchPart.mockResolvedValue(part({ status: "installed", deviceId: "d1" }));
    vi.mocked(parts.fetchPartTimeline).mockResolvedValue([
      tour({ id: "installed:pl1", kind: "installed", outcome: null }),
    ]);
    renderDetail(TECHNICIAN);

    await userEvent.click(await screen.findByRole("button", { name: /book in/i }));
    expect(await screen.findByLabelText(/pages printed this tour/i)).toBeInTheDocument();
  });
});

describe("the install picker", () => {
  it("offers only the machines this model fits", async () => {
    // The register lists every device the company owns, including desktops and
    // switches. Offering one the API would certainly refuse teaches people to
    // distrust the form, so the server answers what fits and the picker shows
    // exactly that.
    fetchPart.mockResolvedValue(part({ status: "ready" }));
    renderDetail(TECHNICIAN);

    await userEvent.click(await screen.findByRole("button", { name: /install/i }));
    const picker = await screen.findByLabelText("Printer");
    expect(picker).toHaveTextContent("Reception LJ-01 — Printers LaserJet");
    expect(parts.fetchFittingDevices).toHaveBeenCalledWith("p1");
  });

  it("explains an empty picker instead of showing a dead dropdown", async () => {
    vi.mocked(parts.fetchFittingDevices).mockResolvedValue([]);
    fetchPart.mockResolvedValue(part({ status: "ready" }));
    renderDetail(TECHNICIAN);

    await userEvent.click(await screen.findByRole("button", { name: /install/i }));
    expect(await screen.findByText(/No machine here takes a HP 12A Toner/)).toBeInTheDocument();
  });
});

describe("the history table", () => {
  it("puts installs, returns and services in one sequence", async () => {
    // The point of merging them: "was it refilled before or after that printer
    // chewed it?" is a question about one sequence, and two lists made the
    // reader interleave them by eye.
    fetchPart.mockResolvedValue(part({ status: "ready" }));
    vi.mocked(parts.fetchPartTimeline).mockResolvedValue([
      tour({
        id: "s1",
        kind: "serviced",
        at: "2026-03-01T00:00:00.000Z",
        outcome: null,
        serviceKindName: "Refill",
        points: 3,
      }),
      tour({ id: "r1", meterStart: 0, meterEnd: 1000 }),
      tour({ id: "i1", kind: "installed", at: "2026-01-01T00:00:00.000Z", outcome: null }),
    ]);
    renderDetail(TECHNICIAN);

    const rows = await screen.findAllByRole("row");
    // Header plus three events, newest first as the server sorted them.
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("Serviced");
    expect(rows[2]).toHaveTextContent("Taken out");
    expect(rows[3]).toHaveTextContent("Installed");
  });

  it("filters to one kind of event", async () => {
    fetchPart.mockResolvedValue(part({ status: "ready" }));
    vi.mocked(parts.fetchPartTimeline).mockResolvedValue([
      tour({ id: "s1", kind: "serviced", outcome: null, serviceKindName: "Refill", points: 3 }),
      tour({ id: "r1" }),
    ]);
    renderDetail(TECHNICIAN);

    await userEvent.selectOptions(
      await screen.findByRole("combobox", { name: "Filter by event" }),
      "serviced",
    );
    expect(screen.getAllByRole("row")).toHaveLength(2);
    // Scoped to the table: "Taken out" is also one of the filter's own options.
    expect(within(screen.getByRole("table")).queryByText("Taken out")).not.toBeInTheDocument();
  });

  it("offers a printer filter only once there is more than one", async () => {
    // A filter with a single choice is furniture.
    fetchPart.mockResolvedValue(part({ status: "ready" }));
    vi.mocked(parts.fetchPartTimeline).mockResolvedValue([tour({ id: "r1" })]);
    renderDetail(TECHNICIAN);

    await screen.findByRole("combobox", { name: "Filter by event" });
    expect(screen.queryByRole("combobox", { name: "Filter by printer" })).not.toBeInTheDocument();

    vi.mocked(parts.fetchPartTimeline).mockResolvedValue([
      tour({ id: "r1", deviceName: "Reception LJ-01" }),
      tour({ id: "r2", deviceName: "Stores BR-01" }),
    ]);
    renderDetail(TECHNICIAN);
    expect(
      (await screen.findAllByRole("combobox", { name: "Filter by printer" }))[0],
    ).toBeInTheDocument();
  });
});
