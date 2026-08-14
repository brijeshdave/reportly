// Author: Brijesh Dave <https://github.com/brijeshdave>
// The bug this exists to prevent: rendering only the active tab unmounts the
// others, so anything half-typed in them is destroyed silently. Fill in a name,
// glance at another tab, come back — gone, with no warning at all.
//
// A panel therefore mounts on its first visit and stays mounted afterwards, and
// a tab holding unsaved work is marked so a preserved draft is never mistaken for
// a saved one.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { PageTabs, TabPanel } from "@/components/page-tabs.js";
import {
  UnsavedChangesNotice,
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/components/unsaved-changes.js";

const TABS = [
  { id: "one", label: "One" },
  { id: "two", label: "Two" },
];

/** A tab with a text field that reports whether it holds unsaved work. */
function EditableTab({ id, label }: { id: string; label: string }) {
  const [value, setValue] = useState("");
  useUnsavedChanges(id, value !== "");

  return (
    <label>
      {label}
      <input value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}

const mounted = vi.fn();

function LazyTab() {
  mounted();
  return <p>expensive</p>;
}

function Harness() {
  const [active, setActive] = useState("one");

  return (
    <UnsavedChangesProvider>
      <UnsavedChangesNotice />
      <PageTabs tabs={TABS} active={active} onSelect={setActive} />

      <TabPanel id="one" active={active}>
        <EditableTab id="one" label="Field one" />
      </TabPanel>
      <TabPanel id="two" active={active}>
        <LazyTab />
      </TabPanel>
    </UnsavedChangesProvider>
  );
}

describe("switching tabs", () => {
  it("keeps what was typed into the tab you left", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness />);

    await user.type(screen.getByLabelText("Field one"), "half typed");

    await user.click(screen.getByRole("tab", { name: /Two/ }));
    // Still mounted — that is what preserves it — but hidden, so it is out of the
    // accessibility tree and out of the layout.
    expect(screen.getByLabelText("Field one")).not.toBeVisible();
    expect(screen.getByText("expensive")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: /One/ }));
    expect(screen.getByLabelText("Field one")).toBeVisible();
    expect(screen.getByLabelText("Field one")).toHaveValue("half typed");
  });

  it("does not mount a tab until it is visited", async () => {
    mounted.mockClear();
    const user = userEvent.setup({ delay: null });
    render(<Harness />);

    // Opening a page must not fetch the contents of every tab on it.
    expect(mounted).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: /Two/ }));
    expect(mounted).toHaveBeenCalledTimes(1);
  });
});

describe("unsaved work", () => {
  it("marks the tab holding it, even while you are on another", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness />);

    const tabOne = screen.getByRole("tab", { name: /One/ });
    expect(tabOne).not.toHaveTextContent("unsaved");

    await user.type(screen.getByLabelText("Field one"), "x");
    expect(screen.getByLabelText("unsaved changes")).toBeInTheDocument();

    // The marker follows you to the other tab: that is the whole point.
    await user.click(screen.getByRole("tab", { name: /Two/ }));
    expect(screen.getByLabelText("unsaved changes")).toBeInTheDocument();
  });

  it("says the kept changes are not saved changes", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Field one"), "x");
    expect(screen.getByRole("alert")).toHaveTextContent("only applied once you save");
  });

  it("stops marking a tab once the change is undone", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness />);

    await user.type(screen.getByLabelText("Field one"), "x");
    expect(screen.getByLabelText("unsaved changes")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Field one"));
    expect(screen.queryByLabelText("unsaved changes")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
