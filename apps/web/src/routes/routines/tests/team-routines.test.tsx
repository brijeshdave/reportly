// Author: Brijesh Dave <https://github.com/brijeshdave>
// The team routines table. What is worth testing here is not that a table renders
// but that its two odd filters — "assigned to" and "site" — reach the server:
// neither is a column on a routine, and a filter the API silently ignores looks
// exactly like one that works.
import type { PaginatedResult, Routine } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { TeamRoutinesPage } from "@/routes/routines/team-routines.js";
import * as departments from "@/services/departments.js";
import * as list from "@/services/list.js";
import * as locations from "@/services/locations.js";
import type { Session } from "@/services/session.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock("@/services/list.js", async (importOriginal) => ({
  ...(await importOriginal<typeof list>()),
  fetchList: vi.fn(),
}));
vi.mock("@/services/departments.js", async (importOriginal) => ({
  ...(await importOriginal<typeof departments>()),
  fetchMyDepartments: vi.fn(),
  fetchDownline: vi.fn(),
}));
vi.mock("@/services/locations.js", async (importOriginal) => ({
  ...(await importOriginal<typeof locations>()),
  fetchMyLocations: vi.fn(),
}));

const fetchList = vi.mocked(list.fetchList);
const fetchMyDepartments = vi.mocked(departments.fetchMyDepartments);
const fetchDownline = vi.mocked(departments.fetchDownline);
const fetchMyLocations = vi.mocked(locations.fetchMyLocations);

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: "r1",
    companyId: "c1",
    departmentId: "d1",
    departmentName: "Maintenance",
    title: "Boiler check",
    description: null,
    cadence: "daily",
    anchorWeekday: null,
    anchorDay: null,
    points: 2,
    status: "active",
    startDate: "2026-08-01",
    endDate: null,
    graceDays: 0,
    createdBy: "u1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    assignees: [{ userId: "u2", name: "Ravi" }],
    ...overrides,
  } as Routine;
}

function page(rows: Routine[]): PaginatedResult<Routine> {
  return {
    data: rows,
    page: 1,
    pageSize: 20,
    total: rows.length,
    totalPages: 1,
    firstPage: 1,
    lastPage: 1,
    previousPage: null,
    nextPage: null,
    hasPrevious: false,
    hasNext: false,
  };
}

const session: Session = {
  user: {
    id: "u1",
    name: "Boss",
    email: "b@x.io",
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
  permissions: [] as Session["permissions"],
  passwordExpired: false,
  queueAdmin: "off",
  modules: { parts: false },
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.session, session);
  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <TeamRoutinesPage />
      </Suspense>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchList.mockResolvedValue(page([routine(), routine({ id: "r2", title: "Air filter swap" })]));
  fetchMyDepartments.mockResolvedValue([
    {
      departmentId: "d1",
      companyId: "c1",
      companyName: "Acme",
      name: "Maintenance",
      path: "Maintenance",
      rank: "lead",
      isCentral: false,
      reportsToId: null,
      reportsToName: null,
      locationIds: [],
    },
  ]);
  fetchDownline.mockResolvedValue([
    {
      userId: "u2",
      name: "Ravi",
      email: "ravi@x.io",
      designation: null,
      rank: "member",
      departmentId: "d1",
      departmentName: "Maintenance",
      reportsToId: "u1",
      depth: 1,
    },
  ]);
  fetchMyLocations.mockResolvedValue([
    {
      id: "l1",
      companyId: "c1",
      name: "Kim",
      isRemote: false,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
});

describe("TeamRoutinesPage", () => {
  it("lists the routines a manager owns, paged by the server", async () => {
    renderPage();
    // Twice over: the table renders the rows and, for narrow screens, the cards.
    expect(await screen.findAllByText("Boiler check")).not.toHaveLength(0);
    expect(screen.getAllByText("Air filter swap")).not.toHaveLength(0);
    expect(fetchList).toHaveBeenCalledWith(
      "/routines/managed",
      expect.objectContaining({ sortBy: "title", page: 1 }),
    );
  });

  it("sends the site filter to the server, where the assignees' sites are known", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("Boiler check");

    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.click(await screen.findByLabelText(/site \(of whoever does it\)/i));
    await user.click(await screen.findByRole("option", { name: /kim/i }));
    await user.click(screen.getByRole("button", { name: /apply filters/i }));

    await waitFor(() =>
      expect(fetchList).toHaveBeenLastCalledWith(
        "/routines/managed",
        expect.objectContaining({
          filters: [{ field: "locationId", op: "eq", value: "l1" }],
        }),
      ),
    );
  });

  it("offers only the caller's downline to filter by assignee", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("Boiler check");

    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.click(await screen.findByLabelText(/assigned to/i));
    expect(await screen.findByRole("option", { name: /ravi/i })).toBeInTheDocument();
  });
});
