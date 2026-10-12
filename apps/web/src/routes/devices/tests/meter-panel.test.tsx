// Author: Brijesh Dave <https://github.com/brijeshdave>
// The printer's counter history.
//
// The resets are the point. A reset is the only legitimate way for the series to
// go backwards, and it is what tells the page-count reports not to read the drop
// as pages printed — so a wrong one quietly changes every figure built on it.
// This panel is where a wrong one gets found, which means it has to show them as
// their own thing rather than as another number in a list.
import type { MeterReading } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { MeterPanel } from "@/routes/devices/meter-panel.js";
import * as parts from "@/services/parts.js";
import type { Session } from "@/services/session.js";

vi.mock("@/services/parts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof parts>()),
  fetchDeviceMeter: vi.fn(),
  recordMeterReading: vi.fn(),
}));

const fetchDeviceMeter = vi.mocked(parts.fetchDeviceMeter);

let seq = 0;
function reading(over: Partial<MeterReading> = {}): MeterReading {
  seq += 1;
  return {
    id: `r${seq}`,
    deviceId: "d1",
    pages: 1000,
    readAt: "2026-10-01T09:00:00.000Z",
    source: "install",
    placementId: null,
    note: null,
    readBy: "u1",
    readByName: "Asha",
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
    ...over,
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
  companyId: "c1",
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

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.session, session);
  render(
    <QueryClientProvider client={queryClient}>
      <MeterPanel deviceId="d1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("the counter history", () => {
  it("shows the last reading and every one behind it", async () => {
    fetchDeviceMeter.mockResolvedValue({
      last: reading({ pages: 12_600, source: "manual" }),
      readings: [reading({ pages: 10_000 }), reading({ pages: 12_600, source: "manual" })],
    });
    renderPanel();

    expect(await screen.findByText(/Last read/)).toHaveTextContent("12,600");
    expect(screen.getByText("10,000")).toBeInTheDocument();
    // Each reading says where it came from: a swap, a round, or a reset.
    expect(screen.getByText("Cartridge in")).toBeInTheDocument();
    expect(screen.getByText("Read on a round")).toBeInTheDocument();
  });

  it("calls a reset a reset, rather than leaving it as another number", async () => {
    fetchDeviceMeter.mockResolvedValue({
      last: reading({ pages: 300 }),
      readings: [
        reading({ pages: 12_000 }),
        reading({ pages: 5, source: "reset", note: "Counter reset or printer replaced" }),
      ],
    });
    renderPanel();

    expect(await screen.findByText("Counter reset")).toBeInTheDocument();
    expect(screen.getByText("Counter reset or printer replaced")).toBeInTheDocument();
  });

  it("says so when a counter keeps being reset", async () => {
    // One is a replaced machine. Several is somebody reading the wrong line of
    // the display and waving the question away — the pattern that filled a live
    // register with impossible tours, invisible unless it is named.
    fetchDeviceMeter.mockResolvedValue({
      last: reading({ pages: 80 }),
      readings: [
        reading({ pages: 5, source: "reset" }),
        reading({ pages: 40, source: "reset" }),
        reading({ pages: 80, source: "reset" }),
      ],
    });
    renderPanel();

    expect(await screen.findByText(/declared reset 3 times/)).toBeInTheDocument();
  });

  it("does not nag about a single reset", async () => {
    fetchDeviceMeter.mockResolvedValue({
      last: reading({ pages: 5 }),
      readings: [reading({ pages: 12_000 }), reading({ pages: 5, source: "reset" })],
    });
    renderPanel();

    await screen.findByText("Counter reset");
    expect(screen.queryByText(/declared reset/)).not.toBeInTheDocument();
  });

  it("says a printer has never been read rather than showing nothing", async () => {
    fetchDeviceMeter.mockResolvedValue({ last: null, readings: [] });
    renderPanel();

    expect(await screen.findByText("Never read.")).toBeInTheDocument();
  });
});
