// Author: Brijesh Dave <https://github.com/brijeshdave>
// The Reports landing separates the shipped reports from the company's own, and only
// offers the build/clone actions to someone who may manage reports — the button a
// viewer-only person sees would 403 at the API, so it must not be there.
import { PERMISSIONS, type ReportView } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { ReportsListPage } from "@/routes/reports/reports-list.js";
import * as reports from "@/services/reports.js";
import type { Session } from "@/services/session.js";

// Link needs a router; here it is a plain anchor, and navigate is a no-op.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock("@/services/reports.js", async (importOriginal) => ({
  ...(await importOriginal<typeof reports>()),
  fetchReportViews: vi.fn(),
}));

const fetchReportViews = vi.mocked(reports.fetchReportViews);

function view(overrides: Partial<ReportView> = {}): ReportView {
  return {
    id: "v1",
    companyId: null,
    name: "Daily journal",
    description: "The day's record.",
    isSystem: true,
    ownerId: null,
    ownerName: null,
    access: "company",
    groupIds: [],
    definition: {
      source: "journal",
      range: "today",
      grouping: "none",
      columns: ["date", "title"],
      filters: {},
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const VIEWS: ReportView[] = [
  view(),
  view({ id: "v2", name: "My line report", isSystem: false, access: "private" }),
];

function session(permissions: string[]): Session {
  return {
    user: {
      id: "u1",
      name: "Ravi",
      email: "r@x.io",
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
    modules: { parts: false },
  };
}

function renderList(permissions: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.session, session(permissions));
  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <ReportsListPage />
      </Suspense>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchReportViews.mockResolvedValue(VIEWS);
});

describe("ReportsListPage", () => {
  it("lists shipped and custom reports under their own headings", async () => {
    renderList([PERMISSIONS.REPORTS_VIEW]);
    expect(await screen.findByText("Daily journal")).toBeInTheDocument();
    expect(screen.getByText("My line report")).toBeInTheDocument();
    expect(screen.getByText("Ready-made reports")).toBeInTheDocument();
    expect(screen.getByText("Your reports")).toBeInTheDocument();
  });

  it("offers New report only to someone who may manage reports", async () => {
    renderList([PERMISSIONS.REPORTS_VIEW]);
    await screen.findByText("Daily journal");
    expect(screen.queryByRole("button", { name: /new report/i })).not.toBeInTheDocument();
  });

  it("shows New report to a manager", async () => {
    renderList([PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_MANAGE]);
    expect(await screen.findByRole("button", { name: /new report/i })).toBeInTheDocument();
  });
});
