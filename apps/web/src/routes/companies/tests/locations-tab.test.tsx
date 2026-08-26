// Author: Brijesh Dave <https://github.com/brijeshdave>
// Deleting a location cascades in the database, stripping it from every group
// scoped to it. The tab must never let that happen quietly: it names the groups
// first, and offers deactivation as the reversible alternative.
import type { Location } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries.js";
import { LocationsTab } from "@/routes/companies/locations-tab.js";
import * as locations from "@/services/locations.js";
import type { Session } from "@/services/session.js";

vi.mock("@/services/locations.js", async (importOriginal) => ({
  ...(await importOriginal<typeof locations>()),
  fetchCompanyLocations: vi.fn(),
  fetchLocationReferences: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
  setLocationStatus: vi.fn(),
}));

const fetchCompanyLocations = vi.mocked(locations.fetchCompanyLocations);
const fetchLocationReferences = vi.mocked(locations.fetchLocationReferences);
const updateLocation = vi.mocked(locations.updateLocation);
const deleteLocation = vi.mocked(locations.deleteLocation);
const setLocationStatus = vi.mocked(locations.setLocationStatus);

const COMPANY = "c1";

function location(overrides: Partial<Location> = {}): Location {
  return {
    id: "l1",
    companyId: COMPANY,
    name: "Depot",
    isRemote: false,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
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
  companyId: null,
  isSuperadmin: true,
  groups: [],
  companies: [],
  locationIds: [],
  permissions: [],
  passwordExpired: false,
  queueAdmin: "off",
  modules: { parts: false },
  plannedWork: false,
  systemRoles: true,
  twoFactor: { required: false, enrolled: false, deadline: null, overdue: false },
};

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.session, session);

  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <LocationsTab companyId={COMPANY} />,
  });
  const groupRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/groups/$groupId",
    component: () => <div>group</div>,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, groupRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(
    <QueryClientProvider client={queryClient}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchCompanyLocations.mockResolvedValue([location()]);
  fetchLocationReferences.mockResolvedValue([]);
  deleteLocation.mockResolvedValue(undefined);
  setLocationStatus.mockResolvedValue(location({ status: "inactive" }));
  updateLocation.mockResolvedValue(location({ name: "Depot North" }));
});

describe("rename", () => {
  it("renames a location", async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();

    await user.click(await screen.findByRole("button", { name: "Rename Depot" }));
    const dialog = screen.getByRole("dialog", { name: "Rename Depot" });

    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Depot North");
    await user.click(within(dialog).getByRole("button", { name: "Save name" }));

    expect(updateLocation).toHaveBeenCalledWith(COMPANY, "l1", "Depot North");
  });

  it("cannot save an unchanged name", async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();

    await user.click(await screen.findByRole("button", { name: "Rename Depot" }));
    const dialog = screen.getByRole("dialog", { name: "Rename Depot" });

    expect(within(dialog).getByRole("button", { name: "Save name" })).toBeDisabled();
  });
});

describe("deactivate", () => {
  it("deactivates without touching group scopes", async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();

    await user.click(await screen.findByRole("button", { name: "Deactivate Depot" }));
    const dialog = await screen.findByRole("dialog", { name: "Deactivate Depot?" });
    expect(dialog).toHaveTextContent("Groups scoped to it keep that scope");

    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    expect(setLocationStatus).toHaveBeenCalledWith(COMPANY, "l1", "inactive");
  });

  it("shows an inactive location as such, and offers to reactivate", async () => {
    fetchCompanyLocations.mockResolvedValue([location({ status: "inactive" })]);
    renderTab();

    expect(await screen.findByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reactivate Depot" })).toBeInTheDocument();
  });
});

describe("delete", () => {
  it("deletes an unreferenced location outright", async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();

    await user.click(await screen.findByRole("button", { name: "Delete Depot" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Depot?" });
    expect(dialog).toHaveTextContent("Nothing references this location");

    await user.click(within(dialog).getByRole("button", { name: "Delete location" }));
    expect(deleteLocation).toHaveBeenCalledWith(COMPANY, "l1", false);
  });

  it("names the groups a delete would detach, before the click", async () => {
    fetchLocationReferences.mockResolvedValue([{ id: "g1", name: "Field team" }]);
    const user = userEvent.setup({ delay: null });
    renderTab();

    await user.click(await screen.findByRole("button", { name: "Delete Depot" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Depot?" });

    expect(dialog).toHaveTextContent("One group is scoped to this location");
    expect(within(dialog).getByRole("link", { name: "Field team" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Deactivating it instead keeps every scope");
  });

  it("cascades only when the user confirms that wording", async () => {
    fetchLocationReferences.mockResolvedValue([{ id: "g1", name: "Field team" }]);
    const user = userEvent.setup({ delay: null });
    renderTab();

    await user.click(await screen.findByRole("button", { name: "Delete Depot" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Depot?" });

    await user.click(within(dialog).getByRole("button", { name: "Remove from groups and delete" }));
    expect(deleteLocation).toHaveBeenCalledWith(COMPANY, "l1", true);
  });
});

describe("the Remote location", () => {
  it("can be renamed, but never deactivated or deleted", async () => {
    fetchCompanyLocations.mockResolvedValue([location({ name: "Remote", isRemote: true })]);
    renderTab();

    expect(await screen.findByRole("button", { name: "Rename Remote" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deactivate Remote" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Remote" })).not.toBeInTheDocument();
  });
});
