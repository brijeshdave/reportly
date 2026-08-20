// Author: Brijesh Dave <https://github.com/brijeshdave>
// The API replaces the whole assignment set, so this must submit every ticked id
// — not a delta. Submitting only the change would silently drop everyone else.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssignmentPicker, type PickerOption } from "@/components/assignment-picker.js";

const options: PickerOption[] = [
  { id: "1", label: "Ada Lovelace", description: "ada@acme.test" },
  { id: "2", label: "Grace Hopper", description: "grace@acme.test" },
  { id: "3", label: "Remote office", description: "Assign its company first", locked: true },
];

const onSave = vi.fn().mockResolvedValue(undefined);

function renderPicker(selectedIds: string[] = [], props = {}) {
  return render(
    <AssignmentPicker options={options} selectedIds={selectedIds} onSave={onSave} {...props} />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("AssignmentPicker", () => {
  it("starts from the current assignment", () => {
    renderPicker(["2"]);
    expect(screen.getByRole("checkbox", { name: /Grace Hopper/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Ada Lovelace/ })).not.toBeChecked();
  });

  it("submits the whole set, not just the change", async () => {
    const user = userEvent.setup({ delay: null });
    renderPicker(["2"]);

    await user.click(screen.getByRole("checkbox", { name: /Ada Lovelace/ }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSave).toHaveBeenCalledWith(expect.arrayContaining(["1", "2"]));
    expect(onSave.mock.calls[0]![0]).toHaveLength(2);
  });

  it("submits an empty set when everything is unticked", async () => {
    const user = userEvent.setup({ delay: null });
    renderPicker(["1"]);

    await user.click(screen.getByRole("checkbox", { name: /Ada Lovelace/ }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSave).toHaveBeenCalledWith([]);
  });

  it("cannot save until something changes", async () => {
    const user = userEvent.setup({ delay: null });
    renderPicker(["1"]);

    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /Grace Hopper/ }));
    expect(save).toBeEnabled();

    // Undoing the change returns to the saved state.
    await user.click(screen.getByRole("checkbox", { name: /Grace Hopper/ }));
    expect(save).toBeDisabled();
  });

  it("refuses to toggle a locked row", async () => {
    const user = userEvent.setup({ delay: null });
    renderPicker([]);

    const locked = screen.getByRole("checkbox", { name: /Remote office/ });
    expect(locked).toBeDisabled();
    await user.click(locked);
    expect(locked).not.toBeChecked();
  });

  it("disables every control for a caller who cannot assign", () => {
    renderPicker(["1"], { disabled: true });
    expect(screen.getByRole("checkbox", { name: /Ada Lovelace/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("surfaces a rejected save and keeps the selection", async () => {
    onSave.mockRejectedValueOnce(new Error("Each location must belong to the group's companies"));
    const user = userEvent.setup({ delay: null });
    renderPicker([]);

    await user.click(screen.getByRole("checkbox", { name: /Ada Lovelace/ }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("must belong to the group");
    expect(screen.getByRole("checkbox", { name: /Ada Lovelace/ })).toBeChecked();
  });

  it("filters the options by the search box", async () => {
    const user = userEvent.setup({ delay: null });
    renderPicker([]);

    await user.type(screen.getByLabelText("Search options"), "grace");
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("reports its dirtiness, so the tab can be marked", async () => {
    // A preserved draft looks exactly like a saved one; the page needs to know.
    const onDirtyChange = vi.fn();
    const user = userEvent.setup({ delay: null });
    renderPicker(["1"], { onDirtyChange });

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole("checkbox", { name: /Grace Hopper/ }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    // Undoing the change is not a change.
    await user.click(screen.getByRole("checkbox", { name: /Grace Hopper/ }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("puts what is already assigned at the top, and counts it", async () => {
    // With fifty roles to choose from, "what does this group have?" is the question
    // being asked — and the answer used to be scattered down an alphabetical list.
    const user = userEvent.setup({ delay: null });
    renderPicker(["2"]);

    expect(screen.getByRole("heading", { name: "Selected (1)" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3 selected");

    const [firstRow] = screen.getAllByRole("checkbox");
    expect(firstRow).toBeChecked();

    // Ticking another moves it up with the rest.
    await user.click(screen.getByRole("checkbox", { name: /Ada Lovelace/ }));
    expect(screen.getByRole("heading", { name: "Selected (2)" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 of 3 selected");
  });

  it("shows a badge and an inline count without a second line", () => {
    render(
      <AssignmentPicker
        options={[
          { id: "r1", label: "Journal editor", meta: "(12)", badge: "System" },
          { id: "r2", label: "Night shift only", meta: "(3)", badge: "Custom" },
        ]}
        selectedIds={[]}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole("checkbox", { name: /Journal editor/ })).toBeInTheDocument();
    expect(screen.getByText("(12)")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });
});
