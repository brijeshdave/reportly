// Author: Brijesh Dave <https://github.com/brijeshdave>
// What a field is called, while it is complaining.
//
// Both of these put a message beside a control, and the message must not become
// part of what the control is called. Inside the `<label>` it does: a screen
// reader announces the field as "Name This cannot be empty.", and every lookup by
// label stops matching the moment something is wrong — which is exactly when a
// test is most likely to be looking.
//
// Pinned because the required asterisk fell into this twice before settling, and
// the fix is invisible: the markup renders identically either way.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field, InlineField, Input } from "@/components/ui/form.js";

describe("InlineField", () => {
  it("is still called by its label while a message is showing", () => {
    render(
      <InlineField label="Name" error="This cannot be empty.">
        <input />
      </InlineField>,
    );

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByText("This cannot be empty.")).toBeInTheDocument();
  });

  it("names the control when nothing is wrong", () => {
    render(
      <InlineField label="Name">
        <input />
      </InlineField>,
    );

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });
});

describe("Field", () => {
  it("is still called by its label while a message is showing", () => {
    render(
      <Field label="Name" required error="This cannot be empty.">
        {(props) => <Input {...props} />}
      </Field>,
    );

    // Exact: the asterisk and the message both sit outside the label, so neither
    // joins the name.
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByText("This cannot be empty.")).toBeInTheDocument();
  });
});
