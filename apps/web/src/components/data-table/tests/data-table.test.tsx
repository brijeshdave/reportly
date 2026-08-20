// Author: Brijesh Dave <https://github.com/brijeshdave>
// The table must never paginate, sort or filter client-side: every interaction
// asks the server. These tests hand it one page of rows and assert it reports the
// intent upward rather than reordering what it was given.
import type { PaginatedResult } from "@reportly/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import type { ListResource } from "@/hooks/use-list-resource.js";
import { initialListState, type ListState } from "@/lib/list-query.js";

interface Row {
  id: string;
  name: string;
  email: string;
}

const columns: TableColumn<Row>[] = [
  { id: "name", accessorKey: "name", header: "Name" },
  { id: "email", accessorKey: "email", header: "Email" },
];

const filterDefs: FilterDef[] = [
  { field: "name", label: "Name", kind: "text" },
  { field: "active", label: "Active", kind: "boolean" },
];

// Deliberately out of alphabetical order: the table must render server order.
const rows: Row[] = [
  { id: "2", name: "Zoe", email: "zoe@acme.test" },
  { id: "1", name: "Adam", email: "adam@acme.test" },
];

function result(overrides: Partial<PaginatedResult<Row>> = {}): PaginatedResult<Row> {
  return {
    data: rows,
    page: 2,
    pageSize: 20,
    total: 45,
    totalPages: 3,
    firstPage: 1,
    lastPage: 3,
    previousPage: 1,
    nextPage: 3,
    hasPrevious: true,
    hasNext: true,
    ...overrides,
  };
}

const handlers = {
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  onSortChange: vi.fn(),
  onFilterChange: vi.fn(),
  onFilterRemove: vi.fn(),
  onFiltersClear: vi.fn(),
  refetch: vi.fn(),
  onExport: vi.fn(),
};

function renderTable(
  overrides: Partial<ListResource<Row>> = {},
  state: ListState = initialListState,
) {
  const list: ListResource<Row> = {
    state,
    result: result(),
    isLoading: false,
    isFetching: false,
    error: undefined,
    pageSize: 20,
    density: "comfortable",
    ...handlers,
    ...overrides,
  };
  return render(<DataTable {...list} columns={columns} filterDefs={filterDefs} />);
}

beforeEach(() => vi.clearAllMocks());

describe("rendering", () => {
  it("renders the rows in the order the server returned them", () => {
    renderTable();
    const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual(["Zoe", "zoe@acme.test", "Adam", "adam@acme.test"]);
  });

  it("shows a loading skeleton instead of rows", () => {
    renderTable({ isLoading: true, result: undefined });
    expect(screen.getByLabelText("Loading rows")).toBeInTheDocument();
    expect(screen.queryByRole("cell")).not.toBeInTheDocument();
  });

  it("offers a retry when the list failed to load", async () => {
    const user = userEvent.setup({ delay: null });
    renderTable({ error: new Error("Boom"), result: undefined });

    expect(screen.getByText("Couldn't load this list")).toBeInTheDocument();
    expect(screen.getByText("Boom")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(handlers.refetch).toHaveBeenCalled();
  });

  it("distinguishes an empty resource from an empty filter result", () => {
    const { unmount } = renderTable({ result: result({ data: [], total: 0, totalPages: 0 }) });
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    unmount();

    renderTable(
      { result: result({ data: [], total: 0, totalPages: 0 }) },
      {
        ...initialListState,
        filters: [{ field: "name", op: "contains", value: "zzz" }],
      },
    );
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });
});

describe("sorting", () => {
  it("asks the server to sort when a header is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    renderTable();

    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(handlers.onSortChange).toHaveBeenCalledWith("name");
  });

  it("marks the sorted column for assistive technology", () => {
    renderTable({}, { ...initialListState, sortBy: "email", sortDir: "desc" });

    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).not.toHaveAttribute("aria-sort");
    expect(headers[1]).toHaveAttribute("aria-sort", "descending");
  });
});

describe("pagination", () => {
  /**
   * The controls appear above the rows and below them, so a bare `getByRole` finds
   * two of everything. These assertions are about the pair behaving identically,
   * which is why they are scoped to one bar rather than made ambiguous.
   */
  const bottomBar = () =>
    within(screen.getByRole("group", { name: "Pagination, below the table" }));
  const topBar = () => within(screen.getByRole("group", { name: "Pagination, above the table" }));

  it("offers the same controls above the rows as below", async () => {
    const user = userEvent.setup({ delay: null });
    renderTable();

    // A full page of rows put "next" a scroll away; the top bar is the fix, and
    // it has to actually work rather than merely be there.
    await user.click(topBar().getByRole("button", { name: "Next page" }));
    expect(handlers.onPageChange).toHaveBeenCalledWith(3);
    expect(topBar().getByText("21-40 of 45")).toBeInTheDocument();
  });

  it("uses the page numbers the server supplied", async () => {
    const user = userEvent.setup({ delay: null });
    renderTable();

    await user.click(bottomBar().getByRole("button", { name: "Next page" }));
    expect(handlers.onPageChange).toHaveBeenCalledWith(3);

    await user.click(bottomBar().getByRole("button", { name: "Last page" }));
    expect(handlers.onPageChange).toHaveBeenCalledWith(3);

    await user.click(bottomBar().getByRole("button", { name: "First page" }));
    expect(handlers.onPageChange).toHaveBeenCalledWith(1);
  });

  it("disables the boundaries the server says are unavailable", () => {
    renderTable({
      result: result({ page: 1, previousPage: null, hasPrevious: false }),
    });
    expect(bottomBar().getByRole("button", { name: "First page" })).toBeDisabled();
    expect(bottomBar().getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(bottomBar().getByRole("button", { name: "Next page" })).toBeEnabled();
  });

  it("reports the visible range and the page position", () => {
    renderTable();
    // Both bars report it; they read from the same result, so they cannot disagree.
    expect(bottomBar().getByText("21-40 of 45")).toBeInTheDocument();
    expect(topBar().getByText("21-40 of 45")).toBeInTheDocument();
    expect(bottomBar().getByText("Page 2 of 3")).toBeInTheDocument();
  });

  it("changes the page size through the shared options", async () => {
    const user = userEvent.setup({ delay: null });
    renderTable();

    await user.selectOptions(bottomBar().getByLabelText("Rows per page"), "50");
    expect(handlers.onPageSizeChange).toHaveBeenCalledWith(50);
  });
});

describe("filters", () => {
  it("sends a text filter with the contains operator, on apply", async () => {
    const user = userEvent.setup({ delay: null });
    renderTable();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    const panel = screen.getByRole("dialog", { name: "Filters" });

    await user.type(within(panel).getByLabelText("Name"), "acme");
    // Not yet. Typing used to commit per keystroke, which is a request per
    // character — and a half-typed word is not a question anybody meant to ask.
    expect(handlers.onFilterChange).not.toHaveBeenCalled();

    await user.click(within(panel).getByRole("button", { name: "Apply filters" }));
    expect(handlers.onFilterChange).toHaveBeenCalledTimes(1);
    expect(handlers.onFilterChange).toHaveBeenCalledWith({
      field: "name",
      op: "contains",
      value: "acme",
    });
  });

  it("applies on Enter, because that is what people press in a text box", async () => {
    const user = userEvent.setup({ delay: null });
    renderTable();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    const panel = screen.getByRole("dialog", { name: "Filters" });
    await user.type(within(panel).getByLabelText("Name"), "acme{Enter}");

    expect(handlers.onFilterChange).toHaveBeenCalledWith({
      field: "name",
      op: "contains",
      value: "acme",
    });
  });

  it("sends a real boolean, not the string 'true'", async () => {
    const user = userEvent.setup({ delay: null });
    renderTable();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    const panel = screen.getByRole("dialog", { name: "Filters" });
    await user.selectOptions(within(panel).getByLabelText("Active"), "true");
    await user.click(within(panel).getByRole("button", { name: "Apply filters" }));

    expect(handlers.onFilterChange).toHaveBeenCalledWith({
      field: "active",
      op: "eq",
      value: true,
    });
  });

  it("throws away a draft when the panel is cancelled", async () => {
    // A draft that outlives its own dialog is one somebody applies later without
    // remembering they made it.
    const user = userEvent.setup({ delay: null });
    renderTable();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    let panel = screen.getByRole("dialog", { name: "Filters" });
    await user.type(within(panel).getByLabelText("Name"), "acme");
    await user.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(handlers.onFilterChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    panel = screen.getByRole("dialog", { name: "Filters" });
    expect(within(panel).getByLabelText("Name")).toHaveValue("");
  });

  it("applies several fields in one go", async () => {
    // One render, one refetch, however many fields moved — which is the whole
    // reason for applying rather than typing straight through.
    const user = userEvent.setup({ delay: null });
    renderTable();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    const panel = screen.getByRole("dialog", { name: "Filters" });
    await user.type(within(panel).getByLabelText("Name"), "acme");
    await user.selectOptions(within(panel).getByLabelText("Active"), "true");
    await user.click(within(panel).getByRole("button", { name: "Apply filters" }));

    expect(handlers.onFilterChange).toHaveBeenCalledTimes(2);
  });

  it("shows a chip per active filter and removes it on demand", async () => {
    const user = userEvent.setup({ delay: null });
    renderTable(
      {},
      { ...initialListState, filters: [{ field: "name", op: "contains", value: "ac" }] },
    );

    expect(screen.getByText("ac")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Name filter" }));
    expect(handlers.onFilterRemove).toHaveBeenCalledWith("name");
  });
});

describe("export", () => {
  it("offers csv and json when the resource supports it", async () => {
    const user = userEvent.setup({ delay: null });
    renderTable();

    await user.click(screen.getByRole("button", { name: /Export/ }));
    const menu = screen.getByRole("menu", { name: "Export" });
    await user.click(within(menu).getByRole("menuitem", { name: "Download CSV" }));

    expect(handlers.onExport).toHaveBeenCalledWith("csv");
  });

  it("hides the export button when the resource has no export endpoint", () => {
    renderTable({ onExport: undefined });
    expect(screen.queryByRole("button", { name: /Export/ })).not.toBeInTheDocument();
  });
});

describe("column visibility", () => {
  it("hides a column without asking the server", async () => {
    const user = userEvent.setup({ delay: null });
    renderTable();

    await user.click(screen.getByRole("button", { name: /Columns/ }));
    const menu = screen.getByRole("menu", { name: "Columns" });
    await user.click(within(menu).getByRole("menuitem", { name: /Email/ }));

    expect(screen.queryByRole("columnheader", { name: /Email/ })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Name/ })).toBeInTheDocument();
    expect(handlers.refetch).not.toHaveBeenCalled();
  });
});
