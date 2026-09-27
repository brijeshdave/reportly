// Author: Brijesh Dave <https://github.com/brijeshdave>
// Forms that check what they send against the schema the API parses with, and put
// what they find under the field it is about.
//
// Reported from use: "when in any form there is some issue on submit, it shows that
// generic api kind of error message on top not in ui fields... it should show the
// error at specific field with error in that field with message under it", and "there
// should be frontend side validation that is in sync with api so that any validation
// errros can be stopped in front and and api validation stays as of final validation
// check".
//
// Both halves are tested here: nothing leaves the browser when the browser can
// already tell it will be refused, and a refusal only the server could make still
// arrives at the right input.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { Field, Input } from "@/components/ui/form.js";
import { useForm } from "@/hooks/use-form.js";
import { ApiError } from "@/services/http.js";

const schema = z.object({
  title: z.string().min(1, "Give it a title"),
  email: z.email("That is not an email address"),
});

function TestForm({ submit }: { submit: (payload: unknown) => Promise<unknown> }) {
  const form = useForm({
    schema,
    initial: { title: "", email: "" },
    submit,
  });

  return (
    <form ref={form.formRef} onSubmit={form.handleSubmit}>
      <Field label="Title" error={form.errorFor("title")}>
        {(props) => <Input {...props} {...form.register("title")} />}
      </Field>
      <Field label="Email" error={form.errorFor("email")}>
        {(props) => <Input {...props} {...form.register("email")} />}
      </Field>
      <button type="submit">Save</button>
    </form>
  );
}

describe("useForm", () => {
  it("shows each message under its own field and sends nothing", async () => {
    // The complaint, exactly: a broken form used to reach the API and come back as one
    // sentence above everything. Now it does not reach the API at all.
    const submit = vi.fn();
    render(<TestForm submit={submit} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Give it a title")).toBeInTheDocument();
    expect(screen.getByText("That is not an email address")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("marks the bad field for a screen reader, not only in colour", async () => {
    // A red border is a design decision; `aria-invalid` is the meaning, and it is what
    // survives a palette where two neighbouring surfaces look the same.
    render(<TestForm submit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true"),
    );
  });

  it("clears a field's message as soon as the person starts fixing it", async () => {
    // Re-validating on every keystroke would narrate how wrong a half-typed value is
    // so far. Clearing is the honest middle: the complaint goes, and the next submit
    // decides whether it comes back.
    render(<TestForm submit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Give it a title")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Title"), "A");

    await waitFor(() => expect(screen.queryByText("Give it a title")).not.toBeInTheDocument());
  });

  it("checks a field on the way out of it", async () => {
    render(<TestForm submit={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Email"), "nope");
    await userEvent.tab();

    expect(await screen.findByText("That is not an email address")).toBeInTheDocument();
    // And only that field: leaving the email does not start complaining about a title
    // the person has not reached yet.
    expect(screen.queryByText("Give it a title")).not.toBeInTheDocument();
  });

  it("submits the parsed payload once the form is clean", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(<TestForm submit={submit} />);

    await userEvent.type(screen.getByLabelText("Title"), "Belt snapped");
    await userEvent.type(screen.getByLabelText("Email"), "sam@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ title: "Belt snapped", email: "sam@example.com" }),
    );
  });

  it("never refuses in silence, even when a bad field is not on the screen", async () => {
    // Reported from use, about the journal editor's work fields: "no proper errors or
    // some times no errors shown". They were validated and not drawn, so the messages
    // were set on inputs that did not exist and the focus had nowhere to move — the
    // submit stopped and said nothing, which reads as a dead button.
    //
    // The field's own message is still the right place and the fix was to draw it.
    // This is the floor underneath that: anything with nowhere to go is gathered into
    // the form-level alert rather than swallowed.
    const submit = vi.fn();

    function PartialForm() {
      const form = useForm({
        schema,
        initial: { title: "", email: "" },
        submit,
      });
      return (
        <form ref={form.formRef} onSubmit={form.handleSubmit}>
          {/* `email` is validated but never registered — the case that went quiet. */}
          <Field label="Title" error={form.errorFor("title")}>
            {(props) => <Input {...props} {...form.register("title")} />}
          </Field>
          {form.formError ? <p role="alert">{(form.formError as Error).message}</p> : null}
          <button type="submit">Save</button>
        </form>
      );
    }

    render(<PartialForm />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // The drawn field still says its own piece.
    expect(await screen.findByText("Give it a title")).toBeInTheDocument();
    // And the undrawn one is not lost.
    expect(await screen.findByRole("alert")).toHaveTextContent("That is not an email address");
    expect(submit).not.toHaveBeenCalled();
  });

  it("puts a server refusal under the field the server blamed", async () => {
    // The half the browser cannot do for itself. Uniqueness, a grace period, a rule
    // that depends on stored settings — the server is the only thing that knows, and
    // its answer belongs in the same place as everything else.
    const submit = vi.fn().mockRejectedValue(
      new ApiError(
        400,
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            fields: { email: "That address is already in use" },
          },
        },
        "req-1",
      ),
    );
    render(<TestForm submit={submit} />);

    await userEvent.type(screen.getByLabelText("Title"), "Belt snapped");
    await userEvent.type(screen.getByLabelText("Email"), "sam@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("That address is already in use")).toBeInTheDocument();
  });
});
