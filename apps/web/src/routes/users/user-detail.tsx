// Author: Brijesh Dave <https://github.com/brijeshdave>
// User detail. Tabs are pages' worth of content, not modals. Groups lead because
// they are the only thing that grants a user any access at all.
import {
  PERMISSIONS,
  type DepartmentRank,
  type Group,
  type Location,
  type Role,
  type User,
  type UserDepartment,
  formatDate,
  formatDateTime,
} from "@reportly/shared";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  KeyRound,
  LockOpen,
  MonitorSmartphone,
  Network,
  ShieldOff,
  UsersRound,
} from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/avatar.js";
import { DesignationPicker } from "@/components/designation-picker.js";
import { AvatarUpload } from "@/components/avatar-upload.js";
import { Can, usePermission } from "@/components/can.js";
import { HistoryTab } from "@/components/history-tab.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { PageTabs, TabPanel } from "@/components/page-tabs.js";
import { MultiSelect } from "@/components/multi-select.js";
import { SearchableSelect } from "@/components/searchable-select.js";
import { ancestorTrail, departmentOptions } from "@/lib/department-options.js";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/components/unsaved-changes.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import {
  fetchDepartmentMembers,
  fetchDepartments,
  fetchDownline,
  fetchUserDepartments,
} from "@/services/departments.js";
import { fetchCompanyLocations } from "@/services/locations.js";
import { sessionQuery } from "@/lib/queries.js";
import { RolePermissionMatrix } from "@/routes/roles/role-permissions.js";
import {
  fetchLockedOutUsers,
  fetchUser,
  fetchUserGroups,
  fetchUserSessions,
  resetUserPassword,
  resetUserTwoFactor,
  revokeUserSession,
  unlockUser,
  setUserStatus,
  updateUser,
  fetchAllCompanies,
  fetchAllGroups,
  fetchUserAccess,
  fetchUserScope,
  saveUserCompanies,
  saveUserDepartments,
  saveUserGroups,
  saveUserLocations,
} from "@/services/users.js";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "groups", label: "Groups" },
  { id: "scope", label: "Companies & locations" },
  { id: "access", label: "Effective access" },
  { id: "departments", label: "Departments" },
  { id: "security", label: "Security" },
  { id: "sessions", label: "Sessions" },
  { id: "history", label: "History" },
];

export function UserDetailPage({ userId, tab }: { userId: string; tab: string }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: "/users/$userId" });

  const user = useQuery({
    queryKey: ["users", "detail", userId],
    queryFn: () => fetchUser(userId),
  });

  const canSeeSessions = usePermission(PERMISSIONS.USERS_SESSIONS_READ);

  const toggleStatus = useMutation({
    mutationFn: (next: "active" | "inactive") => setUserStatus(userId, next),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  if (user.isLoading) return <Spinner />;
  if (user.error) return <ErrorAlert error={user.error} />;
  if (!user.data) return null;

  const active = user.data.status === "active";
  // The Sessions tab lists a colleague's devices, addresses and times. Without the
  // permission it is not drawn at all, rather than drawn and answering 403 — and
  // a link that lands on a refusal reads as a bug.
  const tabs = canSeeSessions ? TABS : TABS.filter((candidate) => candidate.id !== "sessions");
  const activeTab = tabs.some((candidate) => candidate.id === tab) ? tab : "profile";

  return (
    // No tab here holds a draft today, but the panels keep their state anyway, so
    // the next form added to one cannot lose what was typed into it.
    <UnsavedChangesProvider>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar
              userId={user.data.id}
              name={user.data.name}
              version={user.data.avatarVersion}
              size="lg"
            />
            {user.data.name}
          </span>
        }
        description={user.data.email}
        actions={
          <Can permission={PERMISSIONS.USERS_UPDATE}>
            <Button
              size="sm"
              variant={active ? "destructive" : "primary"}
              onClick={() => setConfirmOpen(true)}
            >
              {active ? "Deactivate" : "Reactivate"}
            </Button>
          </Can>
        }
      />

      <PageTabs
        tabs={tabs}
        active={activeTab}
        onSelect={(id) => void navigate({ search: { tab: id }, replace: true })}
      />

      <div className="pt-6">
        <TabPanel id="profile" active={activeTab}>
          <ProfileTab user={user.data} />
        </TabPanel>
        <TabPanel id="groups" active={activeTab}>
          <GroupsTab userId={userId} />
        </TabPanel>

        <TabPanel id="scope" active={activeTab}>
          <UserScopeTab userId={userId} />
        </TabPanel>

        <TabPanel id="access" active={activeTab}>
          <AccessTab userId={userId} />
        </TabPanel>
        <TabPanel id="departments" active={activeTab}>
          <DepartmentsTab userId={userId} />
        </TabPanel>
        <TabPanel id="security" active={activeTab}>
          <SecurityTab user={user.data} />
        </TabPanel>
        <TabPanel id="sessions" active={activeTab}>
          {canSeeSessions ? <SessionsTab userId={userId} /> : null}
        </TabPanel>
        <TabPanel id="history" active={activeTab}>
          <HistoryTab entityType="users" id={userId} />
        </TabPanel>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={active ? "Deactivate this user?" : "Reactivate this user?"}
        description={
          active
            ? "They will be signed out and unable to sign in again until reactivated. Nothing is deleted."
            : "They will be able to sign in again with their existing password."
        }
        confirmLabel={active ? "Deactivate" : "Reactivate"}
        destructive={active}
        onConfirm={() => toggleStatus.mutateAsync(active ? "inactive" : "active")}
      />
    </UnsavedChangesProvider>
  );
}

/** A channel's proof, as an administrator sees it — read-only: only the person
 * holding an address can prove it, so there is no button here to do it for them. */
function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge tone="success">Verified</Badge>
  ) : (
    <Badge tone="neutral">Unverified</Badge>
  );
}

function ProfileTab({ user }: { user: User }) {
  const canUpdate = usePermission(PERMISSIONS.USERS_UPDATE);
  const queryClient = useQueryClient();

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [username, setUsername] = useState(user.username);
  const [designationId, setDesignationId] = useState<string | null>(user.designationId ?? null);
  const [employeeId, setEmployeeId] = useState(user.employeeId ?? "");
  const [countsOnLeaderboard, setCountsOnLeaderboard] = useState(user.countsOnLeaderboard);
  const [mobile, setMobile] = useState(user.mobile ?? "");
  const [whatsappOnMobile, setWhatsapp] = useState(user.whatsappOnMobile);
  const [telegramOnMobile, setTelegram] = useState(user.telegramOnMobile);
  const [discordHandle, setDiscord] = useState(user.discordHandle ?? "");

  const save = useMutation({
    mutationFn: () =>
      updateUser(user.id, {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        username: username.trim().toLowerCase(),
        designationId,
        employeeId: employeeId.trim() === "" ? null : employeeId.trim(),
        countsOnLeaderboard,
        mobile: mobile.trim() === "" ? null : mobile.trim(),
        whatsappOnMobile,
        telegramOnMobile,
        discordHandle: discordHandle.trim() === "" ? null : discordHandle.trim(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  // Name, email and username moved into the form beside it — repeating them here
  // as facts invited the reasonable conclusion that they could not be changed.
  const rows: [string, string][] = [
    ["Status", user.status],
    ["Joined", formatDateTime(user.createdAt)],
    ["Last updated", formatDateTime(user.updatedAt)],
  ];

  const dirty =
    name.trim() !== user.name ||
    email.trim().toLowerCase() !== user.email ||
    username.trim().toLowerCase() !== user.username ||
    designationId !== (user.designationId ?? null) ||
    employeeId.trim() !== (user.employeeId ?? "") ||
    countsOnLeaderboard !== user.countsOnLeaderboard ||
    mobile.trim() !== (user.mobile ?? "") ||
    whatsappOnMobile !== user.whatsappOnMobile ||
    telegramOnMobile !== user.telegramOnMobile ||
    discordHandle.trim() !== (user.discordHandle ?? "");

  return (
    // Two columns on wide screens: the picture and read-only facts on the left, the
    // editable form on the right. Stacked, the page runs taller than the viewport and
    // leaves dead space below; side by side it fits.
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <div className="flex flex-col gap-4">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold">Profile picture</h2>
          <AvatarUpload
            userId={user.id}
            name={user.name}
            version={user.avatarVersion}
            canEdit={canUpdate}
          />
        </Card>

        <Card className="p-6">
          <dl className="grid gap-4 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="text-sm font-semibold">Employment &amp; contact</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Their login name, job title, and how they can be reached. HOD is separate — it is set per
          department under Departments.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
          className="mt-4 flex flex-col gap-4"
        >
          {save.error ? <ErrorAlert error={save.error} /> : null}
          {save.isSuccess && !dirty ? <Alert tone="success">Saved.</Alert> : null}

          <Field label="Name">
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!canUpdate || save.isPending}
              />
            )}
          </Field>

          {/* Changing this clears the address's verified mark — a proof is about
              an address, not a person, so moving it puts it out of reach of the
              code that proved it. The service already does that; the hint is here
              so the consequence is visible before the change, not after. */}
          <Field label="Email" hint="Changing this marks the new address unverified">
            {(props) => (
              <Input
                {...props}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={!canUpdate || save.isPending}
              />
            )}
          </Field>

          <Field label="Username">
            {(props) => (
              <Input
                {...props}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={!canUpdate || save.isPending}
              />
            )}
          </Field>

          <DesignationPicker
            value={designationId}
            currentName={user.designation}
            onChange={setDesignationId}
            disabled={!canUpdate || save.isPending}
          />
          <Field label="Employee ID">
            {(props) => (
              <Input
                {...props}
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                placeholder="e.g. EMP-001"
                disabled={!canUpdate || save.isPending}
              />
            )}
          </Field>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={countsOnLeaderboard}
              onChange={(event) => setCountsOnLeaderboard(event.target.checked)}
              disabled={!canUpdate || save.isPending}
            />
            <span>
              Count on the leaderboard
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Include their points in the standings. Turn off for someone who should not compete —
                a manager who only reviews, or a shared account.
              </span>
            </span>
          </label>

          <hr className="border-border" />

          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Contact channels</h3>
            <VerifiedBadge verified={user.emailVerified} />
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Only the person holding an address can prove it, from their own account — so these are
            editable here, but not verifiable here. Changing an address drops its proof.
          </p>

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Mobile">
                {(props) => (
                  <Input
                    {...props}
                    value={mobile}
                    onChange={(event) => setMobile(event.target.value)}
                    placeholder="+919876543210"
                    disabled={!canUpdate || save.isPending}
                  />
                )}
              </Field>
            </div>
            <div className="pb-2">
              <VerifiedBadge verified={user.mobileVerified} />
            </div>
          </div>

          <fieldset
            className="flex flex-col gap-2"
            disabled={!canUpdate || save.isPending || mobile.trim() === ""}
          >
            <legend className="sr-only">Apps on this mobile</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={whatsappOnMobile}
                onChange={(event) => setWhatsapp(event.target.checked)}
              />
              On WhatsApp
              {user.whatsappOnMobile ? <VerifiedBadge verified={user.whatsappVerified} /> : null}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={telegramOnMobile}
                onChange={(event) => setTelegram(event.target.checked)}
              />
              On Telegram
              {user.telegramOnMobile ? <VerifiedBadge verified={user.telegramVerified} /> : null}
            </label>
          </fieldset>

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Discord handle">
                {(props) => (
                  <Input
                    {...props}
                    value={discordHandle}
                    onChange={(event) => setDiscord(event.target.value)}
                    placeholder="e.g. ada.dev"
                    disabled={!canUpdate || save.isPending}
                  />
                )}
              </Field>
            </div>
            <div className="pb-2">
              <VerifiedBadge verified={user.discordVerified} />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!canUpdate || save.isPending || !dirty}>
              {save.isPending ? <Spinner /> : null}
              Save changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/** The departments this user belongs to, and where they are Head of Department. */
const RANK_LABEL: Record<DepartmentRank, string> = {
  hod: "Head of Department",
  lead: "Team leader",
  member: "Member",
};

/**
 * Where this person sits in the organisation: the departments they are in, who they
 * report to in each, and everyone beneath them.
 *
 * The downline is the interesting half — it is the set the reports feature will
 * scope on, so showing it here is how you check the reporting line says what you
 * meant before it starts deciding who can read what.
 */
function DepartmentsTab({ userId }: { userId: string }) {
  const canEdit = usePermission(PERMISSIONS.DEPARTMENTS_ASSIGN);
  const departments = useQuery({
    queryKey: ["users", "departments", userId],
    queryFn: () => fetchUserDepartments(userId),
  });
  const downline = useQuery({
    queryKey: ["users", "downline", userId],
    queryFn: () => fetchDownline(userId),
  });

  if (departments.isLoading) return <Spinner />;
  if (departments.error) return <ErrorAlert error={departments.error} />;

  const rows = departments.data ?? [];
  const below = downline.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <DepartmentAssigner userId={userId} current={rows} />

      {rows.length === 0 ? (
        <EmptyState
          icon={Network}
          title="Not in any department"
          description="Pick one above, or add them from that department's Members tab."
        />
      ) : null}
      {/* The same memberships, for somebody who cannot change them. Anybody who
          can sees the editable rows above, and two renderings of one fact on one
          screen is the thing that makes a person wonder which is the real one. */}
      {canEdit ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((entry) => (
            <Card key={entry.departmentId} className="flex flex-col gap-1 p-4">
              <div className="flex items-center justify-between gap-3">
                <Link
                  to="/departments/$departmentId"
                  params={{ departmentId: entry.departmentId }}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {entry.name}
                </Link>
                <Badge tone={entry.rank === "hod" ? "brand" : "neutral"}>
                  {RANK_LABEL[entry.rank]}
                </Badge>
              </div>
              {/* This list is the one place that spans companies, and a name is
                  unique only within one — so it says which, and where in that
                  company's tree the department sits. */}
              <p className="truncate text-xs text-muted-foreground">
                {entry.companyName}
                {ancestorTrail(entry.path, entry.name) === ""
                  ? null
                  : ` · ${ancestorTrail(entry.path, entry.name)}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.reportsToName ? (
                  <>Reports to {entry.reportsToName}</>
                ) : (
                  <>Reports to nobody — top of this line</>
                )}
              </p>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-6">
        <h2 className="text-sm font-semibold">Downline</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Everyone below them in the reporting line, at any depth. This is the set they will be able
          to see reports for.
        </p>

        {downline.isLoading ? <Spinner /> : null}
        {below.length === 0 && !downline.isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Nobody reports to them.</p>
        ) : null}

        <div className="mt-3 flex flex-col gap-1">
          {below.map((person) => (
            <div
              key={`${person.departmentId}:${person.userId}`}
              className="flex items-center gap-2 text-sm"
              // Indent by depth, so the shape of the chain is visible at a glance.
              style={{ paddingLeft: `${(person.depth - 1) * 1.25}rem` }}
            >
              <span className="text-muted-foreground">{person.depth === 1 ? "└─" : "└─"}</span>
              <Link
                to="/users/$userId"
                params={{ userId: person.userId }}
                className="font-medium hover:underline"
              >
                {person.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {RANK_LABEL[person.rank]} · {person.departmentName}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/**
 * The one thing an administrator can do to somebody else's second factor: take it
 * away. They cannot turn it on (only the person holding the authenticator can),
 * and they cannot read it — so this tab is a status and a single recovery action.
 *
 * Removing a factor leaves the account on its password alone, so it is deliberately
 * a confirmed, audited step that emails the person, not a quiet toggle.
 */
/**
 * The sign-in lockout, and the way out of it.
 *
 * Read from the live counter, not from a column: a lockout lasts minutes and a
 * stored copy of it would be stale the moment the window expired. So this card
 * refetches rather than trusting what it drew a minute ago.
 *
 * Releasing is not a profile edit and is audited, because it is the shape of a
 * favour and the shape of an attack alike — somebody who can talk an administrator
 * into clearing the counter has bought themselves another run of guesses.
 */
function LockoutCard({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const locked = useQuery({
    queryKey: ["users", "locked-out"],
    queryFn: fetchLockedOutUsers,
    // The window is measured in minutes, so an answer from ten minutes ago is
    // fiction. Cheap to ask: one Redis scan, and only for people who may act on it.
    staleTime: 15_000,
  });
  const state = locked.data?.find((row) => row.userId === user.id);

  const release = useMutation({
    mutationFn: () => unlockUser(user.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users", "locked-out"] });
    },
  });

  return (
    <Card className="flex items-center justify-between gap-3 p-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Sign-in lockout</h2>
          {state ? <Badge tone="danger">Locked out</Badge> : <Badge tone="neutral">Clear</Badge>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {state
            ? `${state.attempts} failed sign-ins out of ${state.max}. ${
                state.retryAfterSeconds
                  ? `Clears on its own in ${Math.ceil(state.retryAfterSeconds / 60)} min.`
                  : "Clears on its own shortly."
              } Releasing lets them try again now.`
            : "Nothing is holding this account back. Too many failed sign-ins in a row would show here, with a way to release them."}
        </p>
        {release.error ? (
          <div className="mt-3">
            <ErrorAlert error={release.error} />
          </div>
        ) : null}
        {release.isSuccess ? (
          <p className="mt-2 text-xs text-success">
            {release.data.cleared === 0
              ? "There was nothing left to clear — the window had already expired."
              : "Released. They can sign in again straight away."}
          </p>
        ) : null}
      </div>

      <Button
        size="sm"
        variant="secondary"
        disabled={!state || release.isPending}
        onClick={() => release.mutate()}
      >
        <LockOpen className="h-4 w-4" />
        Release
      </Button>
    </Card>
  );
}

function SecurityTab({ user }: { user: User }) {
  const canManage = usePermission(PERMISSIONS.USERS_MANAGE_2FA);
  const canResetPassword = usePermission(PERMISSIONS.USERS_RESET_PASSWORD);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState("");
  const queryClient = useQueryClient();

  const reset = useMutation({
    mutationFn: () => resetUserTwoFactor(user.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const setPw = useMutation({
    mutationFn: () => resetUserPassword(user.id, password),
    onSuccess: async () => {
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {reset.error ? <ErrorAlert error={reset.error} /> : null}

      {canResetPassword ? (
        <Card className="p-6">
          <h2 className="text-sm font-semibold">Set a password</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Set a new password for {user.name} — the way in when the emailed link is not an option
            (and how you sign in as them to test). They must change it at next sign-in, and every
            session is signed out.
          </p>
          {setPw.error ? (
            <div className="mt-3">
              <ErrorAlert error={setPw.error} />
            </div>
          ) : null}
          {setPw.isSuccess ? (
            <Alert tone="success">
              Password set. They can sign in with it now and will be asked to choose their own.
            </Alert>
          ) : null}
          <form
            className="mt-3 flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPw.mutate();
            }}
          >
            <div className="flex-1">
              <Field label="New password">
                {(props) => (
                  <Input
                    {...props}
                    type="text"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="e.g. Test@1234"
                    autoComplete="off"
                    disabled={setPw.isPending}
                  />
                )}
              </Field>
            </div>
            <Button size="sm" type="submit" disabled={setPw.isPending || password.trim() === ""}>
              <KeyRound className="h-4 w-4" />
              Set password
            </Button>
          </form>
        </Card>
      ) : null}
      {reset.isSuccess ? (
        <Alert tone="success">
          {reset.data.wasEnabled
            ? "Two-factor removed. They have been signed out everywhere and emailed about it — they can enrol again after signing in."
            : "This account had no two-factor enrolled, so there was nothing to remove."}
        </Alert>
      ) : null}

      {canManage ? <LockoutCard user={user} /> : null}

      <Card className="flex items-center justify-between gap-3 p-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Two-factor authentication</h2>
            {user.twoFactorEnabled ? (
              <Badge tone="success">On</Badge>
            ) : (
              <Badge tone="neutral">Off</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {user.twoFactorEnabled
              ? "Only they can turn this off. If they have lost their authenticator and their recovery codes, removing it here is the only way back in."
              : "They can enrol from their own account. You cannot turn it on for them — it needs the authenticator in their hands."}
          </p>
        </div>

        {canManage && user.twoFactorEnabled ? (
          <Button size="sm" variant="destructive" onClick={() => setConfirmOpen(true)}>
            <ShieldOff className="h-4 w-4" />
            Remove
          </Button>
        ) : null}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Remove two-factor from ${user.name}?`}
        description="Their account will be protected by its password alone until they enrol again. They are signed out everywhere and emailed that this happened. Do this only when they have genuinely lost both their authenticator and their recovery codes — anyone who can persuade you to do it gets past their second factor."
        confirmLabel="Remove two-factor"
        destructive
        onConfirm={() => reset.mutateAsync()}
      />
    </div>
  );
}

/**
 * Where this user is signed in, and a way to sign a device out. Reads our own
 * sessions table rather than better-auth's admin plugin, which authorised on a
 * different column and wrote no audit events.
 */
function SessionsTab({ userId }: { userId: string }) {
  const canRevoke = usePermission(PERMISSIONS.USERS_UPDATE);
  const queryClient = useQueryClient();

  const sessions = useQuery({
    queryKey: ["users", "sessions", userId],
    queryFn: () => fetchUserSessions(userId),
  });

  const revoke = useMutation({
    mutationFn: (token: string) => revokeUserSession(userId, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users", "sessions", userId] }),
  });

  if (sessions.isLoading) return <Spinner />;
  if (sessions.error) return <ErrorAlert error={sessions.error} />;

  const rows = sessions.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={MonitorSmartphone}
        title="Not signed in anywhere"
        description="This user has no live sessions."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {revoke.error ? <ErrorAlert error={revoke.error} /> : null}

      {rows.map((session) => (
        <Card key={session.token} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate text-sm font-medium">
              {session.userAgent ?? "Unknown device"}
              {session.current ? <Badge tone="success">This device</Badge> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {session.ipAddress ?? "no address"} · signed in {formatDateTime(session.createdAt)} ·
              expires {formatDate(session.expiresAt)}
            </p>
          </div>

          {canRevoke ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(session.token)}
            >
              Sign out
            </Button>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function GroupsTab({ userId }: { userId: string }) {
  const canAssign = usePermission(PERMISSIONS.GROUPS_ASSIGN);
  const queryClient = useQueryClient();

  const groups = useQuery({
    queryKey: ["users", "groups", userId],
    queryFn: () => fetchUserGroups(userId),
  });
  const all = useQuery({ queryKey: ["groups", "picker"], queryFn: fetchAllGroups });

  const [draft, setDraft] = useState<string[] | null>(null);
  const chosen = draft ?? (groups.data ?? []).map((g: Group) => g.id);
  useUnsavedChanges("groups", draft !== null);

  const save = useMutation({
    mutationFn: () => saveUserGroups(userId, chosen),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["users", "groups", userId] });
      // What they may do is derived from these, so the effective view is stale now.
      await queryClient.invalidateQueries({ queryKey: ["users", "access", userId] });
    },
  });

  if (groups.isLoading) return <Spinner />;
  if (groups.error) return <ErrorAlert error={groups.error} />;

  const options = (all.data ?? []).map((g) => ({ value: g.id, label: g.name }));

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {save.error ? <ErrorAlert error={save.error} /> : null}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Groups</span>
        <MultiSelect
          values={chosen}
          onChange={setDraft}
          options={options}
          placeholder="No group — no permissions"
          disabled={!canAssign}
          // Without this the control's only accessible name is whatever happens to
          // be picked, so a screen reader announces "No group — no permissions"
          // where the name of the field should be.
          ariaLabel="Groups"
        />
        <span className="text-xs text-muted-foreground">
          A group is a bundle of roles. Without one this person can sign in but do nothing.
        </span>
      </label>

      {canAssign ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={draft === null || save.isPending}
          >
            {save.isPending ? <Spinner /> : null}
            Save groups
          </Button>
          {draft !== null ? (
            <Button size="sm" variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}

      {(groups.data ?? []).length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(groups.data ?? []).map((group: Group) => (
            <Card key={group.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <Link
                  to="/groups/$groupId"
                  params={{ groupId: group.id }}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {group.name}
                </Link>
                <p className="text-xs text-muted-foreground">Added {formatDate(group.createdAt)}</p>
              </div>
              {group.isSystem ? <Badge tone="brand">System</Badge> : null}
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={UsersRound}
          title="Not in any group"
          description="This user has no permissions. Add them to a group above."
        />
      )}
    </div>
  );
}

/**
 * Where this person may work. A group says what they may do; this says where —
 * which companies they can open, and (optionally) which sites within them. Leaving
 * the sites empty means every site of those companies, which is what most people
 * want; narrowing is for someone who belongs to one plant.
 */
function UserScopeTab({ userId }: { userId: string }) {
  const canAssign = usePermission(PERMISSIONS.USERS_UPDATE);
  const queryClient = useQueryClient();

  const scope = useQuery({
    queryKey: ["users", "scope", userId],
    queryFn: () => fetchUserScope(userId),
  });
  const companies = useQuery({ queryKey: ["companies", "picker"], queryFn: fetchAllCompanies });

  const [companyIds, setCompanyIds] = useState<string[] | null>(null);
  const [locationIds, setLocationIds] = useState<string[] | null>(null);

  const chosenCompanies = companyIds ?? scope.data?.companies ?? [];
  const chosenLocations = locationIds ?? scope.data?.locations ?? [];
  useUnsavedChanges("scope", companyIds !== null || locationIds !== null);

  // Only the chosen companies' sites can be picked — the API refuses any other.
  const locationQueries = useQueries({
    queries: chosenCompanies.map((companyId) => ({
      queryKey: ["locations", "of-company", companyId],
      queryFn: () => fetchCompanyLocations(companyId),
      staleTime: 60_000,
    })),
  });

  const save = useMutation({
    mutationFn: async () => {
      // Companies first: a site may only be kept once its company is held.
      await saveUserCompanies(userId, chosenCompanies);
      await saveUserLocations(
        userId,
        chosenLocations.filter((id) =>
          locationQueries.flatMap((q) => q.data ?? []).some((l: Location) => l.id === id),
        ),
      );
    },
    onSuccess: async () => {
      setCompanyIds(null);
      setLocationIds(null);
      await queryClient.invalidateQueries({ queryKey: ["users", "scope", userId] });
    },
  });

  if (scope.isLoading || companies.isLoading) return <Spinner />;
  if (scope.error) return <ErrorAlert error={scope.error} />;

  const companyOptions = (companies.data ?? []).map((c) => ({ value: c.id, label: c.name }));
  const companyNames = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  const locationOptions = locationQueries
    .flatMap((q) => q.data ?? [])
    .map((l: Location) => ({
      value: l.id,
      label: l.name,
      hint: companyNames.get(l.companyId),
    }));

  const dirty = companyIds !== null || locationIds !== null;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {save.error ? <ErrorAlert error={save.error} /> : null}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Companies</span>
        <MultiSelect
          values={chosenCompanies}
          onChange={(ids) => {
            setCompanyIds(ids);
            // Sites of a company they no longer hold cannot stay.
            setLocationIds(chosenLocations);
          }}
          options={companyOptions}
          placeholder="No company — no access"
          ariaLabel="Companies"
          disabled={!canAssign}
        />
        <span className="text-xs text-muted-foreground">
          Which companies this person can switch to. Without one they can sign in but see nothing.
        </span>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Sites</span>
        <MultiSelect
          values={chosenLocations}
          onChange={setLocationIds}
          options={locationOptions}
          placeholder="Every site of those companies"
          disabled={!canAssign || chosenCompanies.length === 0}
          ariaLabel="Locations"
        />
        <span className="text-xs text-muted-foreground">
          Leave empty for every site. Naming sites narrows them to those only.
        </span>
      </label>

      {canAssign ? (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? <Spinner /> : null}
            Save scope
          </Button>
          {dirty ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setCompanyIds(null);
                setLocationIds(null);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Why this person can do what they can: the roles their groups add up to, and the
 * merged permission set those roles grant — shown with the same grouped matrix the
 * role pages use, so the two read identically.
 */
function AccessTab({ userId }: { userId: string }) {
  const access = useQuery({
    queryKey: ["users", "access", userId],
    queryFn: () => fetchUserAccess(userId),
  });

  if (access.isLoading) return <Spinner />;
  if (access.error) return <ErrorAlert error={access.error} />;
  if (!access.data) return null;

  const { roles, permissions } = access.data;

  if (roles.length === 0) {
    return (
      <EmptyState
        icon={UsersRound}
        title="No permissions"
        description="This user is in no group, so no role grants them anything. Add them to a group on the Groups tab."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Roles they hold</h3>
        <div className="flex flex-wrap gap-1.5">
          {roles.map((role) => (
            <Link key={role.id} to="/roles/$roleId" params={{ roleId: role.id }}>
              <Badge tone={role.isSystem ? "brand" : "neutral"}>{role.name}</Badge>
            </Link>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Held through their groups. Everything below is what these roles add up to.
        </p>
      </div>

      <RolePermissionMatrix
        role={{
          id: userId,
          name: "This user",
          isSystem: false,
          permissions: permissions as Role["permissions"],
          createdAt: "",
          updatedAt: "",
        }}
      />
    </div>
  );
}

/**
 * Put this person into departments from their own page. Rank defaults to member for
 * a new placement; an existing one keeps the rank (and the person it reports to)
 * that the department's own Members tab set — editing from here never disturbs the
 * rest of that department.
 */
/** A department's name, found anywhere in the tree. */
/** `GET /departments` answers flat, so this is a lookup, not a tree walk. */
function nameOf(nodes: { id: string; name: string }[], id: string): string {
  return nodes.find((node) => node.id === id)?.name ?? "";
}

/**
 * One membership: the rank, who they report to, and which sites it covers.
 *
 * These used to be reachable only from each department's own Members tab, which
 * meant setting up one person across three departments was three screens. The
 * candidates come from the department itself — the API refuses anyone else — so
 * they are fetched per row rather than guessed at.
 */
function MembershipRow({
  userId,
  membership,
  name,
  where,
  onEdit,
}: {
  userId: string;
  membership: {
    departmentId: string;
    rank: string;
    reportsToId: string | null;
    locationIds: string[];
    isCentral: boolean;
  };
  name: string;
  /** Which company it is in, and where in that company's tree. */
  where: string;
  onEdit: (
    patch: Partial<{
      rank: string;
      reportsToId: string | null;
      locationIds: string[];
      isCentral: boolean;
    }>,
  ) => void;
}) {
  const members = useQuery({
    queryKey: ["departments", membership.departmentId, "members"],
    queryFn: () => fetchDepartmentMembers(membership.departmentId),
  });
  const { data: session } = useSuspenseQuery(sessionQuery);
  const sites = useQuery({
    queryKey: ["locations", "of-company", session.companyId],
    queryFn: () => fetchCompanyLocations(session.companyId!),
    enabled: Boolean(session.companyId),
  });

  // Never offer somebody themselves: a person cannot report to themselves, and the
  // API refuses the edge anyway.
  const candidates = (members.data ?? []).filter((m) => m.userId !== userId);

  return (
    <Card className="flex flex-wrap items-end gap-3 p-3">
      {/* These rows span companies, and a department name is unique only within
          one — so the row says which. It was truncating to "Mainte…" twice over
          with nothing to choose between them. */}
      <div className="flex min-w-0 flex-[2] basis-48 flex-col">
        <Link
          to="/departments/$departmentId"
          params={{ departmentId: membership.departmentId }}
          className="truncate text-sm font-medium hover:underline"
        >
          {name}
        </Link>
        {where === "" ? null : (
          <span className="truncate text-xs text-muted-foreground">{where}</span>
        )}
      </div>

      <label className="flex flex-col gap-0.5 text-[11px]">
        <span className="text-muted-foreground">Rank</span>
        <select
          value={membership.rank}
          onChange={(event) => onEdit({ rank: event.target.value })}
          aria-label={`Rank in ${name}`}
          className="h-8 w-40 rounded-lg border border-border bg-card px-2 text-xs"
        >
          <option value="hod">Head of Department</option>
          <option value="lead">Team leader</option>
          <option value="member">Member</option>
        </select>
      </label>

      <div className="flex w-56 flex-col gap-0.5 text-[11px]">
        <span className="text-muted-foreground">Reports to</span>
        <SearchableSelect
          value={membership.reportsToId ?? ""}
          onChange={(value) => onEdit({ reportsToId: value || null })}
          options={candidates.map((c) => ({ value: c.userId, label: c.name }))}
          placeholder="Nobody (top of the line)"
          ariaLabel={`Reports to in ${name}`}
        />
      </div>

      <div className="flex w-40 flex-col gap-0.5 text-[11px]">
        <span className="text-muted-foreground">Sites</span>
        <MultiSelect
          values={membership.isCentral ? [] : membership.locationIds}
          onChange={(locationIds) => onEdit({ locationIds })}
          options={(sites.data ?? []).map((site) => ({ value: site.id, label: site.name }))}
          placeholder={membership.isCentral ? "Travels — central rota" : "All sites"}
          ariaLabel={`Sites in ${name}`}
          disabled={membership.isCentral}
        />
      </div>

      {/* Also here, not only on the department's own Members tab: placing somebody
          is done from whichever page you happen to be on, and "central" is part of
          placing them. Clearing the sites with it keeps the two from disagreeing
          about where this person works. */}
      <label className="flex w-28 items-start gap-2 text-[11px]">
        <input
          type="checkbox"
          checked={membership.isCentral}
          onChange={(event) => onEdit({ isCentral: event.target.checked, locationIds: [] })}
          aria-label={`Central staff in ${name}`}
          className="mt-0.5 h-3.5 w-3.5 rounded border-border"
        />
        <span>
          <span className="block text-muted-foreground">Central</span>
          <span className="block text-[10px] text-muted-foreground">Travels between sites</span>
        </span>
      </label>
    </Card>
  );
}

function DepartmentAssigner({ userId, current }: { userId: string; current: UserDepartment[] }) {
  const canAssign = usePermission(PERMISSIONS.DEPARTMENTS_ASSIGN);
  const { data: session } = useSuspenseQuery(sessionQuery);
  const queryClient = useQueryClient();
  const all = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });

  // The draft holds the whole membership, not just which departments — rank, who
  // they report to and which sites, because those are the things somebody came to
  // this page to set and previously had to go department by department for.
  type Membership = {
    departmentId: string;
    rank: string;
    reportsToId: string | null;
    locationIds: string[];
    /** Travelling staff — rostered on the department's central rota. */
    isCentral: boolean;
  };
  const [draft, setDraft] = useState<Membership[] | null>(null);
  const chosen: Membership[] =
    draft ??
    current.map((d) => ({
      departmentId: d.departmentId,
      rank: d.rank,
      reportsToId: d.reportsToId,
      locationIds: d.locationIds,
      isCentral: d.isCentral,
    }));
  useUnsavedChanges("departments", draft !== null);

  const setChosenIds = (ids: string[]) => {
    const byId = new Map(chosen.map((m) => [m.departmentId, m]));
    setDraft(
      // A department kept keeps everything about the membership; a new one starts
      // as an ordinary member with nobody above them and every site.
      ids.map(
        (departmentId) =>
          byId.get(departmentId) ?? {
            departmentId,
            rank: "member",
            reportsToId: null,
            locationIds: [],
            isCentral: false,
          },
      ),
    );
  };

  const edit = (departmentId: string, patch: Partial<Membership>) =>
    setDraft(chosen.map((m) => (m.departmentId === departmentId ? { ...m, ...patch } : m)));

  const save = useMutation({
    mutationFn: () => saveUserDepartments(userId, chosen),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["users", "departments", userId] });
      await queryClient.invalidateQueries({ queryKey: ["users", "downline", userId] });
    },
  });

  if (!canAssign) return null;

  // Every department of the company, each carrying its ancestors as a second line.
  //
  // Indentation alone said where a department sat only while you could see its
  // neighbours, which a search box immediately takes away: filter to "support" and
  // two entries appear with nothing to tell them apart. The path is searchable too,
  // so "facilities support" finds the right one directly. (It also used to recurse
  // into a `children` field the flat payload has never had, so nothing was carried
  // at all — the nesting now comes from `path`.)
  //
  // Note the list is already one company's — `GET /departments` is scoped to the
  // active company — so this is about siblings in a tree, not about tenants.
  // Which company a membership is in, and where in that company's tree. The list
  // above is the active company's, so anything not already held is in that one.
  const activeCompany = session.companies.find((c) => c.id === session.companyId)?.name ?? "";
  const whereOf = (departmentId: string): string => {
    const held = current.find((d) => d.departmentId === departmentId);
    const node = (all.data ?? []).find((d) => d.id === departmentId);
    const trail = held
      ? ancestorTrail(held.path, held.name)
      : node
        ? ancestorTrail(node.path, node.name)
        : "";
    return [held?.companyName ?? activeCompany, trail].filter((part) => part !== "").join(" · ");
  };

  return (
    <div className="flex max-w-2xl flex-col gap-2">
      {save.error ? <ErrorAlert error={save.error} /> : null}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Departments</span>
        <MultiSelect
          values={chosen.map((m) => m.departmentId)}
          onChange={setChosenIds}
          options={departmentOptions(
            (all.data ?? []).map((d) => ({ value: d.id, name: d.name, path: d.path })),
          )}
          placeholder="Not in any department"
        />
      </label>

      {chosen.length > 0 ? (
        <div className="flex flex-col gap-2">
          {chosen.map((membership) => (
            <MembershipRow
              key={membership.departmentId}
              userId={userId}
              membership={membership}
              name={
                current.find((d) => d.departmentId === membership.departmentId)?.name ??
                nameOf(all.data ?? [], membership.departmentId)
              }
              where={whereOf(membership.departmentId)}
              onEdit={(patch) => edit(membership.departmentId, patch)}
            />
          ))}
        </div>
      ) : null}
      {draft !== null ? (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Spinner /> : null}
            Save departments
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
