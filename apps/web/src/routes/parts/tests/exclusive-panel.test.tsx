// Author: Brijesh Dave <https://github.com/brijeshdave>
// One open panel at a time.
//
// Reported from use: "if open any options like fits, edit, rates it keeps previous
// all open options opened so ui become very complicated". Every inline editor owned
// a private `useState(false)`, so nothing ever closed anything and a few clicks
// buried the row you wanted under a stack of open forms.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExclusivePanels, useExclusivePanel } from "@/routes/parts/use-exclusive-panel.js";

function Panel({ id, label }: { id: string; label: string }) {
  const { open, setOpen } = useExclusivePanel(id);
  return (
    <div>
      <button onClick={() => setOpen(!open)}>{label}</button>
      {open ? <p>{label} body</p> : null}
    </div>
  );
}

function Tab({ children }: { children: React.ReactNode }) {
  return <ExclusivePanels>{children}</ExclusivePanels>;
}

describe("the setup tabs' panels", () => {
  it("closes the open one when another is opened", () => {
    render(
      <Tab>
        <Panel id="model-1:fits" label="Fits" />
        <Panel id="model-1:rates" label="Rates" />
      </Tab>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fits" }));
    expect(screen.getByText("Fits body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rates" }));
    expect(screen.getByText("Rates body")).toBeInTheDocument();
    expect(screen.queryByText("Fits body")).not.toBeInTheDocument();
  });

  it("closes one row's panel when a different row is opened", () => {
    // The worse half of the report: the stack grew *down the page*, so the row
    // being worked on ended up below several other rows' open forms.
    render(
      <Tab>
        <Panel id="model-1:edit" label="Edit one" />
        <Panel id="model-2:edit" label="Edit two" />
      </Tab>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit one" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit two" }));

    expect(screen.getByText("Edit two body")).toBeInTheDocument();
    expect(screen.queryByText("Edit one body")).not.toBeInTheDocument();
  });

  it("closes on a second click, so a panel can still be dismissed", () => {
    render(
      <Tab>
        <Panel id="only:edit" label="Edit" />
      </Tab>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByText("Edit body")).not.toBeInTheDocument();
  });

  it("still works on its own, outside a tab", () => {
    // The fallback matters: an editor dropped somewhere without the provider must
    // open and close rather than throw.
    render(<Panel id="loose:edit" label="Edit" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Edit body")).toBeInTheDocument();
  });
});
