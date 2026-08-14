// Author: Brijesh Dave <https://github.com/brijeshdave>
// Your own account: profile, security, and preferences. Everything here acts on
// the caller, so nothing is permission-gated — a user with no groups still owns
// their password, their sessions, and their theme.
import {
  PAGE_SIZE_OPTIONS,
  isPasswordValid,
  TABLE_DENSITIES,
  THEME_PALETTES,
  type PageSize,
  type TableDensity,
  type ThemeMode,
  type ThemePalette,
  formatDateTime,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { PasswordField } from "@/components/auth/password-field.js";
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
import { saveMyTableDefaults } from "@/services/settings.js";
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
  const [name, setName] = useState(session?.user.name ?? "");
  const queryClient = useQueryClient();

  // The password fields on Security are deliberately not tracked: they are kept
  // while you move between tabs, but warning on close about a half-typed password
  // would be noise, not safety.
  useUnsavedChanges("profile", name.trim() !== (session?.user.name ?? ""));

  const save = useMutation({
    mutationFn: () => updateMyProfile({ name: name.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
  });

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
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
          className="flex flex-col gap-4"
        >
          {save.error ? <ErrorAlert error={save.error} /> : null}
          {save.isSuccess ? <Alert tone="success">Profile updated.</Alert> : null}

          <Field label="Full name">
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={save.isPending}
              />
            )}
          </Field>

          <Field label="Email" hint="Contact an administrator to change your email.">
            {(props) => <Input {...props} value={session.user.email} readOnly disabled />}
          </Field>

          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={save.isPending || name.trim() === "" || name.trim() === session.user.name}
            >
              {save.isPending ? <Spinner /> : null}
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
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  // The rules come from the server, so the checklist always states the policy the
  // API will actually enforce.
  const { data: rules } = useQuery(passwordRulesQuery);

  const queryClient = useQueryClient();

  const change = useMutation({
    mutationFn: () => changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: async () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      // The session carries `passwordExpired`, and changing the password is
      // exactly what clears it. Without this refetch the notice would stay up and
      // the app stay shut until the user thought to reload — having already done
      // the one thing that was being asked of them.
      await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
    },
  });

  const mismatch = confirm.length > 0 && confirm !== next;
  // Until the rules load, let the server be the judge rather than blocking the form.
  const meetsPolicy = rules ? isPasswordValid(rules, next) : next.length > 0;
  const canSubmit =
    current.length > 0 && meetsPolicy && confirm.length > 0 && !mismatch && !change.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    change.mutate();
  };

  return (
    <Card className="max-w-lg p-6">
      <h2 className="text-sm font-semibold">Password</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Changing it signs you out everywhere else.
      </p>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
        {change.error ? <ErrorAlert error={change.error} /> : null}
        {change.isSuccess ? <Alert tone="success">Password changed.</Alert> : null}

        <PasswordField
          label="Current password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          disabled={change.isPending}
        />

        <PasswordField
          label="New password"
          value={next}
          onChange={setNext}
          rules={rules}
          disabled={change.isPending}
        />

        <PasswordField
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          error={mismatch ? "Passwords don't match" : null}
          disabled={change.isPending}
        />

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {change.isPending ? <Spinner /> : null}
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
    </div>
  );
}
