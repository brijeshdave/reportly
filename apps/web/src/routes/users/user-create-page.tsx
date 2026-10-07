// Author: Brijesh Dave <https://github.com/brijeshdave>
// Creating a user outright — the alternative to inviting one. A full page, not a
// modal: it asks for a login name, contact channels and possibly a password, and
// that is too much to cram into a dialog (invite, which asks for two fields,
// stays a dialog on the list).
//
// The password is optional. Give one and the person can sign in immediately, but
// they are made to replace it before the app opens to them — a password their
// administrator knows is not one to leave standing. Leave it blank and they get
// the same set-password email an invite sends.
import { createUserSchema, suggestUsername, type CreateUser } from "@reportly/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { useForm } from "@/hooks/use-form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { DesignationPicker } from "@/components/designation-picker.js";
import { createUser } from "@/services/users.js";

/** What the form holds. Text as typed; the payload builder does the converting. */
interface UserForm {
  name: string;
  email: string;
  username: string;
  designationId: string;
  employeeId: string;
  countsOnLeaderboard: boolean;
  /** Not sent: it decides whether `password` is. */
  setPassword: boolean;
  password: string;
  mobile: string;
  whatsappOnMobile: boolean;
  telegramOnMobile: boolean;
  discordHandle: string;
}

export function UserCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Once the admin edits the login name themselves, stop overwriting it.
  const [usernameTouched, setUsernameTouched] = useState(false);

  // The route's own schema. Email and username are unique across the installation,
  // which only the server can know — those refusals arrive named and land under the
  // field rather than as a sentence above three cards of inputs.
  const form = useForm<UserForm, CreateUser>({
    schema: createUserSchema,
    initial: {
      name: "",
      email: "",
      username: "",
      designationId: "",
      employeeId: "",
      countsOnLeaderboard: true,
      setPassword: false,
      password: "",
      mobile: "",
      whatsappOnMobile: false,
      telegramOnMobile: false,
      discordHandle: "",
    },
    toPayload: (v) => ({
      name: v.name.trim(),
      email: v.email.trim(),
      username: v.username.trim().toLowerCase(),
      whatsappOnMobile: v.whatsappOnMobile,
      telegramOnMobile: v.telegramOnMobile,
      countsOnLeaderboard: v.countsOnLeaderboard,
      status: "active" as const,
      ...(v.setPassword && v.password ? { password: v.password } : {}),
      ...(v.designationId ? { designationId: v.designationId } : {}),
      ...(v.employeeId.trim() ? { employeeId: v.employeeId.trim() } : {}),
      ...(v.mobile.trim() ? { mobile: v.mobile.trim() } : {}),
      ...(v.discordHandle.trim() ? { discordHandle: v.discordHandle.trim() } : {}),
    }),
    submit: (input) => createUser(input),
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await navigate({ to: "/users/$userId", params: { userId: (user as { id: string }).id } });
    },
  });
  const {
    designationId,
    countsOnLeaderboard,
    setPassword,
    mobile,
    whatsappOnMobile,
    telegramOnMobile,
  } = form.values;

  const onEmailChange = (value: string) => {
    form.set("email", value);
    if (!usernameTouched) {
      form.set("username", value.includes("@") ? suggestUsername(value) : "");
    }
  };

  const hasMobile = mobile.trim() !== "";

  return (
    <>
      <PageHeader
        title="New user"
        description="They have no access until you add them to a group. Only the email is required — every other channel is optional."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void navigate({ to: "/users" })}>
            Back to users
          </Button>
        }
      />

      <form {...form.formProps} className="mt-2 flex max-w-2xl flex-col gap-4">
        {/* Whatever could not be blamed on a field — a permission, a conflict. */}
        {form.formError ? <ErrorAlert error={form.formError} /> : null}

        <Card className="flex flex-col gap-4 p-6">
          <h2 className="text-sm font-semibold">Identity</h2>

          <Field label="Full name" required error={form.errorFor("name")}>
            {(props) => (
              <Input {...props} {...form.register("name")} autoFocus disabled={form.submitting} />
            )}
          </Field>

          <Field label="Email" required error={form.errorFor("email")}>
            {(props) => (
              <Input
                {...props}
                type="email"
                name="email"
                value={form.values.email}
                onChange={(event) => onEmailChange(event.target.value)}
                disabled={form.submitting}
              />
            )}
          </Field>

          <Field label="Username" required error={form.errorFor("username")}>
            {(props) => (
              <Input
                {...props}
                name="username"
                value={form.values.username}
                onChange={(event) => {
                  setUsernameTouched(true);
                  form.set("username", event.target.value);
                }}
                disabled={form.submitting}
                placeholder="suggested from the email"
              />
            )}
          </Field>
          <p className="-mt-2 text-xs text-muted-foreground">
            They can sign in with either their email or this. Letters, numbers, dot, underscore or
            hyphen.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <DesignationPicker
              value={designationId || null}
              onChange={(next) => form.set("designationId", next ?? "")}
              disabled={form.submitting}
            />
            <Field label="Employee ID" error={form.errorFor("employeeId")}>
              {(props) => (
                <Input
                  {...props}
                  {...form.register("employeeId")}
                  placeholder="e.g. EMP-001"
                  disabled={form.submitting}
                />
              )}
            </Field>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={countsOnLeaderboard}
              onChange={(event) => form.set("countsOnLeaderboard", event.target.checked)}
              disabled={form.submitting}
            />
            <span>
              Count on the leaderboard
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Include their points in the standings. Turn off for someone who should not compete.
              </span>
            </span>
          </label>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <h2 className="text-sm font-semibold">Password</h2>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={setPassword}
              onChange={(event) => form.set("setPassword", event.target.checked)}
              disabled={form.submitting}
            />
            Set a password now
          </label>

          {setPassword ? (
            <>
              <Field label="Password" required error={form.errorFor("password")}>
                {(props) => (
                  <Input
                    {...props}
                    type="password"
                    {...form.register("password")}
                    autoComplete="new-password"
                    disabled={form.submitting}
                  />
                )}
              </Field>
              <Alert tone="info">
                They can sign in straight away, but must choose their own password before they can
                use the app — you would otherwise know a working credential of theirs.
              </Alert>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              They will be emailed a link to set their own password, exactly as an invitation does.
            </p>
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <h2 className="text-sm font-semibold">Contact channels</h2>
          <p className="-mt-2 text-xs text-muted-foreground">
            All optional, and all unverified until the person proves them from their own account.
          </p>

          <Field label="Mobile" error={form.errorFor("mobile")}>
            {(props) => (
              <Input
                {...props}
                {...form.register("mobile")}
                placeholder="+919876543210"
                disabled={form.submitting}
              />
            )}
          </Field>
          <p className="-mt-2 text-xs text-muted-foreground">
            International format, with the country code — SMS, WhatsApp and Telegram all need it.
          </p>

          <fieldset className="flex flex-col gap-2" disabled={!hasMobile || form.submitting}>
            <legend className="sr-only">Apps on this mobile</legend>
            <p
              className={`text-xs ${hasMobile ? "text-muted-foreground" : "text-muted-foreground/50"}`}
            >
              This number is also on:
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={whatsappOnMobile}
                onChange={(event) => form.set("whatsappOnMobile", event.target.checked)}
              />
              WhatsApp
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={telegramOnMobile}
                onChange={(event) => form.set("telegramOnMobile", event.target.checked)}
              />
              Telegram
            </label>
          </fieldset>

          <Field label="Discord handle" error={form.errorFor("discordHandle")}>
            {(props) => (
              <Input
                {...props}
                {...form.register("discordHandle")}
                placeholder="e.g. ada.dev"
                disabled={form.submitting}
              />
            )}
          </Field>
          <p className="-mt-2 text-xs text-muted-foreground">
            Discord has its own handle: it cannot be reached through a phone number.
          </p>
        </Card>

        <div className="flex justify-end gap-2 pb-4">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => void navigate({ to: "/users" })}
            disabled={form.submitting}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={form.submitting}>
            {form.submitting ? <Spinner /> : null}
            Create user
          </Button>
        </div>
      </form>
    </>
  );
}
