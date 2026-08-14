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
import { suggestUsername } from "@reportly/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { DesignationPicker } from "@/components/designation-picker.js";
import { createUser } from "@/services/users.js";

export function UserCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  // Once the admin edits the login name themselves, stop overwriting it.
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [designationId, setDesignationId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [countsOnLeaderboard, setCountsOnLeaderboard] = useState(true);

  const [setPassword, setSetPassword] = useState(false);
  const [password, setPassword_] = useState("");

  const [mobile, setMobile] = useState("");
  const [whatsappOnMobile, setWhatsapp] = useState(false);
  const [telegramOnMobile, setTelegram] = useState(false);
  const [discordHandle, setDiscord] = useState("");

  const onEmailChange = (value: string) => {
    setEmail(value);
    if (!usernameTouched) setUsername(value.includes("@") ? suggestUsername(value) : "");
  };

  const create = useMutation({
    mutationFn: () =>
      createUser({
        name: name.trim(),
        email: email.trim(),
        username: username.trim().toLowerCase(),
        ...(setPassword && password ? { password } : {}),
        ...(designationId ? { designationId } : {}),
        ...(employeeId.trim() ? { employeeId: employeeId.trim() } : {}),
        ...(mobile.trim() ? { mobile: mobile.trim() } : {}),
        whatsappOnMobile,
        telegramOnMobile,
        countsOnLeaderboard,
        ...(discordHandle.trim() ? { discordHandle: discordHandle.trim() } : {}),
        status: "active",
      }),
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await navigate({ to: "/users/$userId", params: { userId: user.id } });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  const hasMobile = mobile.trim() !== "";
  const ready = name.trim() !== "" && email.trim() !== "" && username.trim() !== "";

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

      <form onSubmit={submit} className="mt-2 flex max-w-2xl flex-col gap-4">
        {create.error ? <ErrorAlert error={create.error} /> : null}

        <Card className="flex flex-col gap-4 p-6">
          <h2 className="text-sm font-semibold">Identity</h2>

          <Field label="Full name">
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
                disabled={create.isPending}
              />
            )}
          </Field>

          <Field label="Email">
            {(props) => (
              <Input
                {...props}
                type="email"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                required
                disabled={create.isPending}
              />
            )}
          </Field>

          <Field label="Username">
            {(props) => (
              <Input
                {...props}
                value={username}
                onChange={(event) => {
                  setUsernameTouched(true);
                  setUsername(event.target.value);
                }}
                required
                disabled={create.isPending}
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
              value={designationId}
              onChange={setDesignationId}
              disabled={create.isPending}
            />
            <Field label="Employee ID">
              {(props) => (
                <Input
                  {...props}
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                  placeholder="e.g. EMP-001"
                  disabled={create.isPending}
                />
              )}
            </Field>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={countsOnLeaderboard}
              onChange={(event) => setCountsOnLeaderboard(event.target.checked)}
              disabled={create.isPending}
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
              onChange={(event) => setSetPassword(event.target.checked)}
              disabled={create.isPending}
            />
            Set a password now
          </label>

          {setPassword ? (
            <>
              <Field label="Password">
                {(props) => (
                  <Input
                    {...props}
                    type="password"
                    value={password}
                    onChange={(event) => setPassword_(event.target.value)}
                    required
                    autoComplete="new-password"
                    disabled={create.isPending}
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

          <Field label="Mobile">
            {(props) => (
              <Input
                {...props}
                value={mobile}
                onChange={(event) => setMobile(event.target.value)}
                placeholder="+919876543210"
                disabled={create.isPending}
              />
            )}
          </Field>
          <p className="-mt-2 text-xs text-muted-foreground">
            International format, with the country code — SMS, WhatsApp and Telegram all need it.
          </p>

          <fieldset className="flex flex-col gap-2" disabled={!hasMobile || create.isPending}>
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
                onChange={(event) => setWhatsapp(event.target.checked)}
              />
              WhatsApp
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={telegramOnMobile}
                onChange={(event) => setTelegram(event.target.checked)}
              />
              Telegram
            </label>
          </fieldset>

          <Field label="Discord handle">
            {(props) => (
              <Input
                {...props}
                value={discordHandle}
                onChange={(event) => setDiscord(event.target.value)}
                placeholder="e.g. ada.dev"
                disabled={create.isPending}
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
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!ready || create.isPending}>
            {create.isPending ? <Spinner /> : null}
            Create user
          </Button>
        </div>
      </form>
    </>
  );
}
