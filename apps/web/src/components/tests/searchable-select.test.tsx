// Author: Brijesh Dave <https://github.com/brijeshdave>
// The dropdown that is replacing native selects wherever a list comes from the
// server. It is about to be the way people choose a person, a department, an asset
// — so the things a native select gives away for free are what these tests pin:
// choosing without a mouse, and a label that actually points at the control.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchableSelect } from "@/components/searchable-select.js";

const OPTIONS = [
  { value: "a", label: "Anita Rao", hint: "Engineering" },
  { value: "b", label: "Bhavesh Shah", hint: "Maintenance" },
  { value: "c", label: "Chandni Patel", hint: "Engineering › Platform" },
];

function setup(value = "") {
  const onChange = vi.fn();
  render(
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={OPTIONS}
      placeholder="Anyone"
      ariaLabel="Assign to"
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe("SearchableSelect", () => {
  it("filters on the label and on the second line", async () => {
    const { user } = setup();
    await user.click(screen.getByLabelText("Assign to"));

    await user.type(screen.getByLabelText("Search options"), "bhav");
    expect(screen.getByRole("option", { name: /Bhavesh/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Anita/ })).not.toBeInTheDocument();

    // The hint is searchable too, which is the point of showing it: "platform"
    // finds the person in Platform without knowing their name.
    await user.clear(screen.getByLabelText("Search options"));
    await user.type(screen.getByLabelText("Search options"), "platform");
    expect(screen.getByRole("option", { name: /Chandni/ })).toBeInTheDocument();
  });

  it("can be driven entirely from the keyboard", async () => {
    const { onChange, user } = setup();
    const trigger = screen.getByLabelText("Assign to");
    trigger.focus();

    // Down-arrow opens it, the way a native select does.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // Then arrows walk the list and Enter takes the one you are on. The first
    // press moves off the "clear" row onto the first real option.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("wraps at the ends rather than stopping dead", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByLabelText("Assign to"));

    // Up from the top lands on the last option — a list of forty is not something
    // to arrow all the way down.
    await user.keyboard("{ArrowUp}{Enter}");
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("Enter on the clear row clears, and Escape leaves without choosing", async () => {
    const { onChange, user } = setup("a");
    await user.click(screen.getByLabelText("Assign to"));

    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("");

    onChange.mockClear();
    await user.click(screen.getByLabelText("Assign to"));
    await user.keyboard("{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("re-aims after typing, so Enter takes what the list now shows", async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByLabelText("Assign to"));

    // Arrow onto the first option, then type — the index into the old list is
    // meaningless now, and taking whatever sits at that position would be a
    // silent mis-pick rather than a visible one.
    await user.keyboard("{ArrowDown}");
    await user.type(screen.getByLabelText("Search options"), "chandni");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("c");
  });

  // The bug this pins: an option's hint is part of its accessible name and matches
  // text filters, so "Engineering" found Backend — whose parent is Engineering —
  // and a screenshot of the leaderboard came out empty because of it.
  it("makes each option addressable by its own name, not its second line", async () => {
    const { user } = setup();
    await user.click(screen.getByLabelText("Assign to"));

    const byOwnName = document.querySelectorAll('[data-label="Engineering"]');
    expect(byOwnName).toHaveLength(0); // "Engineering" is only ever a hint here
    expect(document.querySelectorAll('[data-label="Anita Rao"]')).toHaveLength(1);
  });

  it("takes an id so a Field's label points at the control", () => {
    render(
      <>
        <label htmlFor="dept">Department</label>
        <SearchableSelect id="dept" value="" onChange={vi.fn()} options={OPTIONS} />
      </>,
    );
    // Found *by its label text* — before this the label pointed at nothing and a
    // screen reader announced an unnamed button.
    expect(screen.getByLabelText("Department")).toHaveAttribute("id", "dept");
  });
});
