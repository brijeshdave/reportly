// Author: Brijesh Dave <https://github.com/brijeshdave>
// Your own account: profile, security, and preferences. Everything here acts on
// the caller, so nothing is permission-gated — a user with no groups still owns
// their password, their sessions, and their theme.
import {
  PAGE_SIZE_OPTIONS,
  isPasswordValid,
  nameSchema,
  TABLE_DENSITIES,
  THEME_PALETTES,
  type PageSize,
  type TableDensity,
  type ThemeMode,
  type ThemePalette,
  formatDateTime,
  type ToastPosition,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";

import { PasswordField } from "@/components/auth/password-field.js";
import { useForm } from "@/hooks/use-form.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { PageTabs, TabPanel } from "@/components/page-tabs.js";
import {
  UnsavedChangesNotice,
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/components/unsaved-changes.js";
import { useTheme } from "@/components/theme-provider.js";
import { PALETTE_LABELS } from "@/lib/theme.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { errorMessage } from "@/lib/error-message.js";
import { passwordRulesQuery, preferencesQuery, queryKeys, sessionQuery } from "@/lib/queries.js";
import {
  changePassword,
  disableTwoFactor,
  fetchMySessions,
  revokeMySession,
  type MySession,
} from "@/services/auth.js";
import { saveMyTableDefaults, saveMyToasts } from "@/services/settings.js";
import { updateMyProfile } from "@/services/users.js";
import { AvatarUpload } from "@/components/avatar-upload.js";
import { TwoFactorSetup } from "@/routes/profile/two-factor-setup.js";
import { ChannelsTab } from "@/routes/profile/channels-tab.js";
import { NotificationsTab } from "@/routes/profile/notifications-tab.js";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "channels", label: "Channels" },
  { id: "notifications", label: "Notifications" },
  { id: "security", label: "Security" },
  { id: "preferences", label: "Preferences" },
];

export function ProfilePage({ tab }: { tab: string }) {
  const navigate = useNavigate({ from: "/profile" });
  const activeTab = TABS.some((candidate) => candidate.id === tab) ? tab : "profile";
  const { data: session } = useQuery(sessionQuery);

  return (
    // Panels stay mounted once visited: a half-typed name is not lost when you
    // glance at Security, and a half-typed password survives the trip back.
    <UnsavedChangesProvider>
      <PageHeader title="Your account" description="Profile, security, and preferences." />

      {/* The router redirects an expired user here; say why, or it looks broken. */}
      {session?.passwordExpired ? (
        <Alert tone="error" className="mb-4">
          Your password needs changing before you can use the rest of Reportly — it has either
          expired, or it was chosen for you by an administrator. Change it under Security.
        </Alert>
      ) : null}

      <UnsavedChangesNotice />

      <PageTabs
        tabs={TABS}
        active={activeTab}
        onSelect={(id) => void navigate({ search: { tab: id }, replace: true })}
      />

      <div className="pt-6">
        <TabPanel id="profile" active={activeTab}>
          <ProfileTab />
        </TabPanel>
        <TabPanel id="channels" active={activeTab}>
          <ChannelsTab />
        </TabPanel>
        <TabPanel id="notifications" active={activeTab}>
          <NotificationsTab />
        </TabPanel>
        <TabPanel id="security" active={activeTab}>
          <SecurityTab />
        </TabPanel>
        <TabPanel id="preferences" active={activeTab}>
          <PreferencesTab />
        </TabPanel>
      </div>
    </UnsavedChangesProvider>
  );
}

function ProfileTab() {
  const { data: session } = useQuery(sessionQuery);
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  // `nameSchema` is the shared rule the API applies to this field, so an empty or
  // over-long name is refused here in the same words rather than after a round trip.
  const form = useForm({
    schema: z.object({ name: nameSchema }),
    initial: { name: session?.user.name ?? "" },
    toPayload: (v) => ({ name: v.name.trim() }),
    submit: (input) => updateMyProfile(input as { name: string }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
  });
  const typed = form.values.name.trim();

  // The password fields on Security are deliberately not tracked: they are kept
  // while you move between tabs, but warning on close about a half-typed password
  // would be noise, not safety.
  useUnsavedChanges("profile", typed !== (session?.user.name ?? ""));

  if (!session) return <Spinner />;

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <Card className="p-6">
        <h2 className="mb-4 text-sm font-semibold">Profile picture</h2>
        <AvatarUpload
          userId={session.user.id}
          name={session.user.name}
          version={session.user.avatarVersion}
          canEdit
        />
      </Card>

      <Card className="p-6">
        <form {...form.formProps} className="flex flex-col gap-4">
          {/* Whatever could not be blamed on a field. */}
          {form.formError ? <ErrorAlert error={form.formError} /> : null}
          {/* Hidden again the moment the name differs from what was saved, which is
              what typing in the box does — so the notice cannot sit over stale text. */}
          {saved && typed === session.user.name ? (
            <Alert tone="success">Profile updated.</Alert>
          ) : null}

          <Field label="Full name" required error={form.errorFor("name")}>
            {(props) => <Input {...props} {...form.register("name")} disabled={form.submitting} />}
          </Field>

          <Field label="Email" hint="Contact an administrator to change your email.">
            {(props) => <Input {...props} value={session.user.email} readOnly disabled />}
          </Field>

          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              // Only for having nothing to save, whose cause is on the screen. An
              // empty name is no longer a reason to go inert — it says so instead.
              disabled={form.submitting || typed === session.user.name}
            >
              {form.submitting ? <Spinner /> : null}
              Save changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function SecurityTab() {
  return (
    <div className="flex flex-col gap-4">
      <ChangePasswordCard />
      <TwoFactorCard />
      <SessionsCard />
    </div>
  );
}

function ChangePasswordCard() {
  // The rules come from the server, so the checklist always states the policy the
  // API will actually enforce.
  const { data: rules } = useQuery(passwordRulesQuery);
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  /**
   * Built from the rules rather than written out, because the policy is a setting:
   * `isPasswordValid` is the same function the API checks with, so the form cannot
   * refuse a password the server would take, or accept one it would not.
   *
   * All three messages exist because this form used to answer with a dead button.
   * An empty current password, an empty confirmation and a mismatch each disabled
   * Change password and said nothing about which of them it was.
   */
  const schema = useMemo(
    () =>
      z
        .object({
          currentPassword: z.string().min(1, "Type your current password."),
          newPassword: z
            .string()
            .min(1, "Choose a new password.")
            // Until the rules load there is nothing to check against, so the server
            // stays the judge rather than the form blocking on a policy it has not read.
            .refine((value) => (rules ? isPasswordValid(rules, value) : true), {
              message: "This does not meet every requirement listed above.",
            }),
          confirmPassword: z.string().min(1, "Type the new password again."),
        })
        .refine((v) => v.newPassword === v.confirmPassword, {
          message: "This does not match the new password.",
          path: ["confirmPassword"],
        }),
    [rules],
  );

  const form = useForm({
    schema,
    initial: { currentPassword: "", newPassword: "", confirmPassword: "" },
    submit: (input) => {
      const v = input as { currentPassword: string; newPassword: string };
      return changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword });
    },
    onSuccess: async () => {
      setSaved(true);
      form.reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
      // The session carries `passwordExpired`, and changing the password is
      // exactly what clears it. Without this refetch the notice would stay up and
      // the app stay shut until the user thought to reload — having already done
      // the one thing that was being asked of them.
      await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
    },
  });
  const { currentPassword, newPassword, confirmPassword } = form.values;

  return (
    <Card className="max-w-lg p-6">
      <h2 className="text-sm font-semibold">Password</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Changing it signs you out everywhere else.
      </p>

      <form {...form.formProps} className="mt-4 flex flex-col gap-4">
        {/* What was not about one field: a wrong current password is the server's
            to say, and it names the field, so it lands below rather than here. */}
        {form.formError ? <ErrorAlert error={form.formError} /> : null}
        {/* Cleared as soon as anything is typed again, so the notice cannot sit
            above a half-filled second attempt. */}
        {saved && currentPassword === "" && newPassword === "" && confirmPassword === "" ? (
          <Alert tone="success">Password changed.</Alert>
        ) : null}

        <PasswordField
          label="Current password"
          required
          name="currentPassword"
          value={currentPassword}
          onChange={(value) => form.set("currentPassword", value)}
          error={form.errorFor("currentPassword")}
          autoComplete="current-password"
          disabled={form.submitting}
        />

        <PasswordField
          label="New password"
          required
          name="newPassword"
          value={newPassword}
          onChange={(value) => form.set("newPassword", value)}
          error={form.errorFor("newPassword")}
          rules={rules}
          disabled={form.submitting}
        />

        <PasswordField
          label="Confirm new password"
          required
          name="confirmPassword"
          value={confirmPassword}
          onChange={(value) => form.set("confirmPassword", value)}
          error={form.errorFor("confirmPassword")}
          disabled={form.submitting}
        />

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={form.submitting}>
            {form.submitting ? <Spinner /> : null}
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TwoFactorCard() {
  const { data: session } = useQuery(sessionQuery);
  const [enrolling, setEnrolling] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState("");
  const queryClient = useQueryClient();

  const refreshSession = () => queryClient.invalidateQueries({ queryKey: queryKeys.session });

  const disable = useMutation({
    mutationFn: () => disableTwoFactor(password),
    onSuccess: async () => {
      setPassword("");
      await refreshSession();
    },
  });

  if (!session) return null;
  const enabled = session.user.twoFactorEnabled;

  return (
    <Card className="max-w-lg p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Two-factor authentication</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A code from your authenticator app, in addition to your password.
          </p>
        </div>
        <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</Badge>
      </div>

      <div className="mt-4">
        {enrolling ? (
          <TwoFactorSetup
            onCancel={() => setEnrolling(false)}
            onDone={async () => {
              setEnrolling(false);
              await refreshSession();
            }}
          />
        ) : enabled ? (
          <Button variant="destructive" size="sm" onClick={() => setDisabling(true)}>
            Turn off two-factor
          </Button>
        ) : (
          <Button size="sm" onClick={() => setEnrolling(true)}>
            Set up two-factor
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={disabling}
        onClose={() => setDisabling(false)}
        title="Turn off two-factor authentication?"
        description={
          <div className="flex flex-col gap-3">
            <p>Your account will be protected by your password alone.</p>
            <Field label="Current password">
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              )}
            </Field>
          </div>
        }
        confirmLabel="Turn off"
        destructive
        onConfirm={() => disable.mutateAsync()}
      />
    </Card>
  );
}

/** A best-effort description of a session's device, from its user agent. */
function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const browser = /Firefox|Edg|Chrome|Safari/.exec(userAgent)?.[0] ?? "Browser";
  const os = /Windows|Mac OS X|Linux|Android|iPhone|iPad/.exec(userAgent)?.[0] ?? "Unknown OS";
  return `${browser === "Edg" ? "Edge" : browser} on ${os}`;
}

function SessionsCard() {
  const [pending, setPending] = useState<MySession | null>(null);
  const queryClient = useQueryClient();

  const sessions = useQuery({ queryKey: ["sessions"], queryFn: fetchMySessions, retry: false });

  const revoke = useMutation({
    mutationFn: (token: string) => revokeMySession(token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold">Active sessions</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Where you're signed in. Revoking a session signs that device out.
      </p>

      <div className="mt-4">
        {sessions.isLoading ? <Spinner /> : null}
        {sessions.error ? <ErrorAlert error={sessions.error} /> : null}

        <ul className="flex flex-col gap-2">
          {(sessions.data ?? []).map((entry) => (
            <li
              key={entry.token}
              className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {describeDevice(entry.userAgent)}
                  {entry.current ? <Badge tone="success">This device</Badge> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {entry.ipAddress || "Unknown address"} · expires {formatDateTime(entry.expiresAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPending(entry)}
                disabled={revoke.isPending}
              >
                {entry.current ? "Sign out" : "Revoke"}
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Revoke this session?"
        description="That device is signed out immediately. If it's this one, you'll need to sign in again."
        confirmLabel="Revoke"
        destructive
        onConfirm={() => revoke.mutateAsync(pending!.token)}
      />
    </Card>
  );
}

const SELECT_CLASS =
  "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function PreferencesTab() {
  const { theme, setPalette, setMode } = useTheme();
  const { data: preferences } = useQuery(preferencesQuery);
  const queryClient = useQueryClient();

  const saveTable = useMutation({
    mutationFn: saveMyTableDefaults,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
    },
  });

  const saveToasts = useMutation({
    mutationFn: saveMyToasts,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
    },
  });

  const toasts = preferences?.toasts ?? {
    enabled: true,
    position: "bottom-right" as ToastPosition,
    seconds: 4,
  };

  // Send the whole object: a setting is stored whole, so omitting a field resets it.
  const current = preferences?.tableDefaults ?? {
    pageSize: 20 as PageSize,
    density: "comfortable",
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="max-w-lg p-6">
        <h2 className="text-sm font-semibold">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Overrides the organisation's default, for you only.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <Field label="Colour">
            {(props) => (
              <select
                {...props}
                value={theme.palette}
                onChange={(event) => setPalette(event.target.value as ThemePalette)}
                className={SELECT_CLASS}
              >
                {THEME_PALETTES.map((palette) => (
                  <option key={palette} value={palette}>
                    {PALETTE_LABELS[palette]}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Mode">
            {(props) => (
              <select
                {...props}
                value={theme.mode}
                onChange={(event) => setMode(event.target.value as ThemeMode)}
                className={SELECT_CLASS}
              >
                <option value="system">Match my system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            )}
          </Field>
        </div>
      </Card>

      <Card className="max-w-lg p-6">
        <h2 className="text-sm font-semibold">Tables</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your defaults. You can still change them from any table.
        </p>

        {saveTable.error ? (
          <Alert tone="error" className="mt-3">
            {errorMessage(saveTable.error)}
          </Alert>
        ) : null}

        <div className="mt-4 flex flex-col gap-4">
          <Field label="Rows per page">
            {(props) => (
              <select
                {...props}
                value={current.pageSize}
                onChange={(event) =>
                  saveTable.mutate({
                    ...current,
                    pageSize: Number(event.target.value) as PageSize,
                  })
                }
                disabled={saveTable.isPending}
                className={SELECT_CLASS}
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Row density">
            {(props) => (
              <select
                {...props}
                value={current.density}
                onChange={(event) =>
                  saveTable.mutate({ ...current, density: event.target.value as TableDensity })
                }
                disabled={saveTable.isPending}
                className={SELECT_CLASS}
              >
                {TABLE_DENSITIES.map((density) => (
                  <option key={density} value={density}>
                    {density === "comfortable" ? "Comfortable" : "Compact"}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Card>

      <Card className="max-w-lg p-6">
        <h2 className="text-sm font-semibold">Save confirmations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Saving an edit keeps you on the page, so a brief message says it worked.
        </p>

        {saveToasts.error ? (
          <Alert tone="error" className="mt-3">
            {errorMessage(saveToasts.error)}
          </Alert>
        ) : null}

        <div className="mt-4 flex flex-col gap-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={toasts.enabled}
              onChange={(event) => saveToasts.mutate({ ...toasts, enabled: event.target.checked })}
              disabled={saveToasts.isPending}
              className="mt-1 h-4 w-4 rounded border-border"
            />
            <span>
              Show them
              <span className="block text-xs text-muted-foreground">
                With this off, a save is silent — forms that show their own message still do.
              </span>
            </span>
          </label>

          <Field label="Where">
            {(props) => (
              <select
                {...props}
                value={toasts.position}
                onChange={(event) =>
                  saveToasts.mutate({ ...toasts, position: event.target.value as ToastPosition })
                }
                disabled={saveToasts.isPending || !toasts.enabled}
                className={SELECT_CLASS}
              >
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-center">Bottom centre</option>
                <option value="top-right">Top right</option>
              </select>
            )}
          </Field>

          <Field label="How long">
            {(props) => (
              <select
                {...props}
                value={String(toasts.seconds)}
                onChange={(event) =>
                  saveToasts.mutate({ ...toasts, seconds: Number(event.target.value) })
                }
                disabled={saveToasts.isPending || !toasts.enabled}
                className={SELECT_CLASS}
              >
                <option value="2">2 seconds</option>
                <option value="4">4 seconds</option>
                <option value="8">8 seconds</option>
                <option value="0">Until I dismiss it</option>
              </select>
            )}
          </Field>
        </div>
      </Card>
    </div>
  );
}
