// Author: Brijesh Dave <https://github.com/brijeshdave>
// The searchable multi-select — the one people pick assignees from. Its keyboard
// story differs from the single-select's in one way that matters, and that is what
// most of this file is about: Enter toggles and the list stays open, because
// choosing three people should not be three round trips.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MultiSelect } from "@/components/multi-select.js";

const OPTIONS = [
  { value: "a", label: "Anita Rao", hint: "Engineering" },
  { value: "b", label: "Bhavesh Shah", hint: "Maintenance" },
  { value: "c", label: "Chandni Patel", hint: "Engineering › Platform" },
];

function setup(values: string[] = []) {
  const onChange = vi.fn();
  render(
    <MultiSelect
      values={values}
      onChange={onChange}
      options={OPTIONS}
      placeholder="Nobody"
      ariaLabel="Assignees"
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe("MultiSelect", () => {
  it("opens on down-arrow and toggles with Enter, staying open", async () => {
    const { onChange, user } = setup();
    screen.getByLabelText("Assignees").focus();

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith(["a"]);

    // Still open, ready for the next person — the difference from the single-select.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("takes someone back off with a second Enter", async () => {
    const { onChange, user } = setup(["a"]);
    await user.click(screen.getByLabelText("Assignees"));
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("searches the second line as well as the name", async () => {
    const { user } = setup();
    await user.click(screen.getByLabelText("Assignees"));
    await user.type(screen.getByLabelText("Search options"), "maintenance");

    expect(screen.getByRole("option", { name: /Bhavesh/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Anita/ })).not.toBeInTheDocument();
  });

  it("says how many are picked rather than listing five names", async () => {
    setup(["a", "b", "c"]);
    expect(screen.getByLabelText("Assignees")).toHaveTextContent("3 selected");
  });

  it("takes an id so a Field's label points at the control", () => {
    render(
      <>
        <label htmlFor="who">Assign to</label>
        <MultiSelect id="who" values={[]} onChange={vi.fn()} options={OPTIONS} />
      </>,
    );
    expect(screen.getByLabelText("Assign to")).toHaveAttribute("id", "who");
  });
});
