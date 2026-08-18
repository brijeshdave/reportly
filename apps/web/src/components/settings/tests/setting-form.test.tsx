// Author: Brijesh Dave <https://github.com/brijeshdave>
// The form is generated from the setting's Zod schema. A control that writes the
// wrong shape produces a value the API then rejects, so each field kind is pinned
// against the real registry definitions.
import { LOG_LEVEL_SETTINGS, LOG_SINKS, PASSWORD_POLICY, UI_THEME } from "@reportly/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingForm } from "@/components/settings/setting-form.js";

const onSave = vi.fn().mockResolvedValue(undefined);

beforeEach(() => vi.clearAllMocks());

describe("generated controls", () => {
  it("renders a checkbox per boolean, labelled from the schema key", () => {
    render(
      <SettingForm
        def={LOG_SINKS}
        value={{ console: true, file: false, database: true }}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Console" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "File" })).not.toBeChecked();
  });

  it("renders numbers with the schema's bounds", () => {
    render(
      <SettingForm
        def={PASSWORD_POLICY}
        value={{
          minLength: 12,
          requireUppercase: true,
          requireNumber: true,
          requireSymbol: false,
          expiryDays: 0,
          reuseCount: 3,
        }}
        onSave={onSave}
      />,
    );

    const minLength = screen.getByLabelText("Min length");
    expect(minLength).toHaveAttribute("type", "number");
    expect(minLength).toHaveAttribute("min", "8");
    expect(minLength).toHaveAttribute("max", "128");
  });

  it("renders an enum as a select of its allowed values", () => {
    render(
      <SettingForm def={UI_THEME} value={{ palette: "aurora", mode: "system" }} onSave={onSave} />,
    );

    const mode = screen.getByLabelText("Mode");
    expect(mode).toHaveValue("system");
    expect(within(mode).getByRole("option", { name: "dark" })).toBeInTheDocument();
  });
});

describe("a record of per-feature overrides", () => {
  it("suggests the feature names instead of leaving the operator to guess", async () => {
    // The map is keyed by a plain string, so the schema cannot say what belongs
    // in it and the box used to sit there empty saying only "Feature name". The
    // setting declares its known keys; the form offers them.
    render(
      <SettingForm
        def={LOG_LEVEL_SETTINGS}
        value={{ default: "info", features: {} }}
        onSave={onSave}
      />,
    );

    const input = screen.getByLabelText(/Add an override to Features/i);
    const listId = input.getAttribute("list");
    expect(listId).toBeTruthy();

    const options = document.querySelectorAll(`#${listId} option`);
    const names = [...options].map((o) => o.getAttribute("value"));
    expect(names).toEqual(expect.arrayContaining(["auth", "email", "notifications"]));
  });

  it("still accepts a name that is not on the list", async () => {
    // A datalist and not a select, deliberately: a feature added tomorrow must be
    // turn-up-able today, without waiting for the list to catch up.
    const user = userEvent.setup({ delay: null });
    render(
      <SettingForm
        def={LOG_LEVEL_SETTINGS}
        value={{ default: "info", features: {} }}
        onSave={onSave}
      />,
    );

    await user.type(screen.getByLabelText(/Add an override to Features/i), "something-new");
    await user.click(screen.getByRole("button", { name: /add/i }));

    expect(screen.getByText("something-new")).toBeInTheDocument();
  });

  it("stops suggesting a feature once it is already overridden", () => {
    render(
      <SettingForm
        def={LOG_LEVEL_SETTINGS}
        value={{ default: "info", features: { auth: "debug" } }}
        onSave={onSave}
      />,
    );

    // Listed as a row with its own level, and no longer offered as one to add.
    expect(screen.getByRole("combobox", { name: /Features for auth/i })).toHaveValue("debug");
    expect(screen.getByText(/^Known:/)).not.toHaveTextContent(/\bauth\b/);
  });
});

describe("saving", () => {
  it("cannot save until something changes", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <SettingForm
        def={LOG_SINKS}
        value={{ console: true, file: false, database: true }}
        onSave={onSave}
      />,
    );

    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "File" }));
    expect(save).toBeEnabled();
  });

  it("sends the whole value, not just the changed field", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <SettingForm
        def={LOG_SINKS}
        value={{ console: true, file: false, database: true }}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "File" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSave).toHaveBeenCalledWith({ console: true, file: true, database: true });
  });

  it("surfaces a rejected write", async () => {
    onSave.mockRejectedValueOnce(new Error("minLength must be at least 8"));
    const user = userEvent.setup({ delay: null });
    render(
      <SettingForm
        def={LOG_SINKS}
        value={{ console: true, file: false, database: true }}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "File" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("minLength must be at least 8");
  });

  it("disables every control for a caller who cannot manage settings", () => {
    render(
      <SettingForm
        def={LOG_SINKS}
        value={{ console: true, file: false, database: true }}
        onSave={onSave}
        disabled
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Console" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});

describe("record fields", () => {
  const value = { default: "info", features: { auth: "debug" } };

  it("lists each override with a level picker", () => {
    render(<SettingForm def={LOG_LEVEL_SETTINGS} value={value} onSave={onSave} />);

    expect(screen.getByText("auth")).toBeInTheDocument();
    expect(screen.getByLabelText("Features for auth")).toHaveValue("debug");
  });

  it("adds an override at the first allowed level", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingForm def={LOG_LEVEL_SETTINGS} value={value} onSave={onSave} />);

    await user.type(screen.getByLabelText("Add an override to Features"), "logs");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSave).toHaveBeenCalledWith({
      default: "info",
      features: { auth: "debug", logs: "fatal" },
    });
  });

  it("removes an override", async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingForm def={LOG_LEVEL_SETTINGS} value={value} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Remove auth" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSave).toHaveBeenCalledWith({ default: "info", features: {} });
  });
});
