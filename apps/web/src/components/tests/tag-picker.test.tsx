// Author: Brijesh Dave <https://github.com/brijeshdave>
// Searching and selecting from a department's existing tags.
//
// Creating a tag from here is deliberately impossible — tags are a shared
// vocabulary, and one added mid-form is how a department ends up with "leak",
// "Leak" and "water leak" meaning the same thing. These tests pin that.
import type { TagRow } from "@reportly/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TagPicker } from "@/components/tag-picker.js";
import * as vocabulary from "@/services/vocabulary.js";

vi.mock("@/services/vocabulary.js", async (importOriginal) => ({
  ...(await importOriginal<typeof vocabulary>()),
  fetchTags: vi.fn(),
  createTag: vi.fn(),
}));

const fetchTags = vi.mocked(vocabulary.fetchTags);
const createTag = vi.mocked(vocabulary.createTag);

const tag = (over: Partial<TagRow> & { id: string; name: string }): TagRow => ({
  departmentId: "d1",
  departmentName: "IT",
  description: null,
  color: "#3b82f6",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

function renderPicker(props: Partial<React.ComponentProps<typeof TagPicker>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TagPicker departmentId="d1" value={[]} onChange={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

/** Open the dropdown the way a person does. */
async function openList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Choose tags…|Add another tag…/ }));
}

describe("TagPicker", () => {
  it("shows the whole vocabulary as soon as the list is opened", async () => {
    const user = userEvent.setup({ delay: null });
    fetchTags.mockResolvedValue([
      tag({ id: "1", name: "Networking" }),
      tag({ id: "2", name: "Servers" }),
    ]);
    renderPicker();

    // Nothing is listed until it is asked for, but asking is a click rather than
    // guessing a word: a picker that shows nothing until you type requires you to
    // already know the vocabulary it exists to teach you.
    await openList(user);
    expect(screen.getByLabelText("Networking")).toBeInTheDocument();
    expect(screen.getByLabelText("Servers")).toBeInTheDocument();
  });

  it("narrows the list as you search, and selects on click", async () => {
    const user = userEvent.setup({ delay: null });
    fetchTags.mockResolvedValue([
      tag({ id: "1", name: "Networking" }),
      tag({ id: "2", name: "Servers" }),
    ]);
    const onChange = vi.fn();
    renderPicker({ onChange });

    await openList(user);
    await user.type(screen.getByPlaceholderText("Search tags…"), "serv");
    expect(screen.queryByLabelText("Networking")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Servers"));
    expect(onChange).toHaveBeenCalledWith(["2"]);
  });

  it("never offers to create a tag, however unfamiliar the search", async () => {
    const user = userEvent.setup({ delay: null });
    fetchTags.mockResolvedValue([tag({ id: "1", name: "Networking" })]);
    renderPicker();

    await openList(user);
    await user.type(screen.getByPlaceholderText("Search tags…"), "something brand new");

    expect(screen.queryByRole("button", { name: /Create/ })).not.toBeInTheDocument();
    expect(createTag).not.toHaveBeenCalled();
    // And it says where tags do come from, so the dead end has an exit.
    expect(screen.getByText(/set up under JournalEntry setup/)).toBeInTheDocument();
  });

  it("shows what is chosen as solid removable chips, not as ringed list entries", async () => {
    const user = userEvent.setup({ delay: null });
    fetchTags.mockResolvedValue([tag({ id: "1", name: "Networking" })]);
    const onChange = vi.fn();
    renderPicker({ value: ["1"], onChange });

    // The selected tag appears once, in full, with its own remove control — rather
    // than as one highlighted entry among the whole vocabulary.
    const remove = await screen.findByRole("button", { name: "Remove Networking" });
    await user.click(remove);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("keeps a selected tag out of the list, before any search", async () => {
    const user = userEvent.setup({ delay: null });
    fetchTags.mockResolvedValue([
      tag({ id: "1", name: "Networking" }),
      tag({ id: "2", name: "Network switch" }),
    ]);
    renderPicker({ value: ["1"] });

    // Offering something already chosen invites a click that does nothing — and it
    // has to hold on the freshly-opened list, not only once a search has narrowed
    // it, because that list is now the first thing anybody sees.
    await openList(user);
    expect(screen.getByLabelText("Network switch")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Networking" })).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search tags…"), "network");
    expect(screen.getByLabelText("Network switch")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Networking" })).not.toBeInTheDocument();
  });

  it("says so when everything available is already on the entry", async () => {
    const user = userEvent.setup({ delay: null });
    fetchTags.mockResolvedValue([tag({ id: "1", name: "Networking" })]);
    renderPicker({ value: ["1"] });

    // An empty dropdown reads as broken. This one says why it is empty.
    await openList(user);
    expect(screen.getByText(/already on this entry/)).toBeInTheDocument();
  });

  it("does not offer a retired tag", async () => {
    const user = userEvent.setup({ delay: null });
    fetchTags.mockResolvedValue([
      tag({ id: "1", name: "Legacy", status: "inactive" }),
      tag({ id: "2", name: "Live one" }),
    ]);
    renderPicker();

    // The API refuses a retired tag on new work, so offering it would be a picker
    // that produces a validation error.
    await openList(user);
    expect(screen.getByLabelText("Live one")).toBeInTheDocument();
    expect(screen.queryByLabelText("Legacy")).not.toBeInTheDocument();
  });

  it("distinguishes 'none exist' from 'all retired'", async () => {
    // One is an administrator's job to fix; the other is a state somebody chose
    // and may want to undo. Saying "no tags yet" for both sends people looking for
    // a setup screen where the tags already are.
    fetchTags.mockResolvedValue([tag({ id: "1", name: "Legacy", status: "inactive" })]);
    renderPicker();
    expect(await screen.findByText(/has been retired/)).toBeInTheDocument();
  });

  it("says which reason it has nothing to offer", async () => {
    fetchTags.mockResolvedValue([]);
    renderPicker();
    expect(await screen.findByText(/no tags yet/)).toBeInTheDocument();
  });

  it("asks for a department before anything else", () => {
    renderPicker({ departmentId: null });
    expect(screen.getByText(/Pick a department first/)).toBeInTheDocument();
  });
});
