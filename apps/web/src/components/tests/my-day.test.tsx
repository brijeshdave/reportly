// Author: Brijesh Dave <https://github.com/brijeshdave>
// The load-bearing contract of "My day": a tile appears only when the server sent
// its section. An absent key means "not yours to see"; an empty array means "you
// are clear". Rendering an empty tile for a section the caller has no permission
// for would tell them they are clear of work they can never be given — so the test
// that matters here is the *absence* of tiles, not their contents.
import type { MyDay as MyDayData } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queries.js";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MyDay } from "@/components/my-day.js";
import * as analytics from "@/services/analytics.js";

// The tiles link with the router's <Link>; a plain anchor is enough for the DOM.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock("@/services/analytics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof analytics>()),
  fetchMyDay: vi.fn(),
}));

const fetchMyDay = vi.mocked(analytics.fetchMyDay);

function base(overrides: Partial<MyDayData> = {}): MyDayData {
  return {
    dayStart: "2026-07-17T00:00:00.000Z",
    dayEnd: "2026-07-18T00:00:00.000Z",
    points: { own: 12, rollup: 3, total: 15 },
    myReports: [],
    draftCount: 0,
    ...overrides,
  };
}

/**
 * A session in the cache, because the strip now carries a `<Can>`-gated tile and
 * `Can` reads the session from there. Seeded WITHOUT insights:view by default:
 * these tests are about the my-day contract, and a chart tile appearing in them
 * would be noise. The one test that wants it passes the permission in.
 */
function renderMyDay(permissions: string[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.session, {
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
    permissions,
    passwordExpired: false,
    queueAdmin: "off",
    modules: { parts: false },
    plannedWork: false,
    systemRoles: true,
    twoFactor: { required: false, enrolled: false, deadline: null, overdue: false },
  });
  return render(
    <QueryClientProvider client={client}>
      <MyDay />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("MyDay", () => {
  it("always shows the points and today tiles", async () => {
    fetchMyDay.mockResolvedValue(base());
    renderMyDay();

    expect(await screen.findByText("Your points")).toBeInTheDocument();
    expect(screen.getByText("Filed today")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("omits the appraisals, downtime and tasks tiles when their keys are absent", async () => {
    // A Member with none of reports:appraise / downtime:read / tasks:read. The API
    // sends no such keys, and the tiles must not appear at all.
    fetchMyDay.mockResolvedValue(base());
    renderMyDay();

    await screen.findByText("Your points");
    expect(screen.queryByText("Awaiting your review")).not.toBeInTheDocument();
    expect(screen.queryByText("Still down")).not.toBeInTheDocument();
    expect(screen.queryByText("On your plate")).not.toBeInTheDocument();
  });

  it("shows a tile with its empty state when the key is present but the array is empty", async () => {
    // The distinction that makes the contract worth having: an EMPTY array is "you
    // are clear" and DOES render — unlike an absent key.
    fetchMyDay.mockResolvedValue(base({ pendingAppraisals: [], openDowntimes: [], openTasks: [] }));
    renderMyDay();

    expect(await screen.findByText("Awaiting your review")).toBeInTheDocument();
    expect(screen.getByText(/Nothing to score/)).toBeInTheDocument();
    expect(screen.getByText("Still down")).toBeInTheDocument();
    expect(screen.getByText("On your plate")).toBeInTheDocument();
  });

  it("lists the caller's open downtimes with a running age", async () => {
    fetchMyDay.mockResolvedValue(
      base({
        openDowntimes: [
          {
            id: "d1",
            reportId: "r1",
            targetLabel: "Station A",
            startedAt: "2026-07-17T06:00:00.000Z",
            openForMinutes: 125,
          },
        ],
      }),
    );
    renderMyDay();

    expect(await screen.findByText("Station A")).toBeInTheDocument();
    // 125 minutes → "2h 5m", an age that is still climbing, not a finished duration.
    expect(screen.getByText("2h 5m")).toBeInTheDocument();
  });

  it("flags an overdue task", async () => {
    fetchMyDay.mockResolvedValue(
      base({
        openTasks: [
          {
            id: "t1",
            title: "Replace belt",
            state: "open",
            dueAt: "2020-01-01T00:00:00.000Z",
            overdue: true,
          },
        ],
      }),
    );
    renderMyDay();

    expect(await screen.findByText("Replace belt")).toBeInTheDocument();
    expect(screen.getByText("overdue")).toBeInTheDocument();
  });
});
