// Author: Brijesh Dave <https://github.com/brijeshdave>
// Users list. Server-side everything via DataTable. There are two ways to add a
// person: invite them (a dialog — it asks only for a name and an address) or
// create them outright (a page — it asks for a login name, channels and possibly a
// password). Every action is gated by the same permission the API enforces.
import { PERMISSIONS, type User, formatDate, formatDateTime } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Download, Mail, Upload, UserPlus } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Avatar } from "@/components/avatar.js";
import { Can, usePermission } from "@/components/can.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import { ImportDialog } from "@/components/import-dialog.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { fetchDesignationOptions } from "@/services/designations.js";
import {
  downloadUserTemplate,
  exportUsers,
  fetchLockedOutUsers,
  importUsers,
  inviteUser,
} from "@/services/users.js";

const baseColumns: TableColumn<User>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link
        to="/users/$userId"
        params={{ userId: row.original.id }}
        className="flex items-center gap-2 font-medium text-foreground hover:underline"
      >
        <Avatar
          userId={row.original.id}
          name={row.original.name}
          version={row.original.avatarVersion}
          size="sm"
        />
        {row.original.name}
      </Link>
    ),
  },
  { id: "email", accessorKey: "email", header: "Email" },
  { id: "username", accessorKey: "username", header: "Username" },
  { id: "designation", accessorKey: "designation", header: "Designation" },
  { id: "mobile", accessorKey: "mobile", header: "Mobile" },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge tone={row.original.status === "active" ? "success" : "neutral"}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Joined",
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

export function UsersListPage() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const canImport = usePermission(PERMISSIONS.USERS_IMPORT);
  // Whoever may release somebody is whoever may know they are stuck. Without this
  // permission the column is not drawn at all — "this person keeps failing their
  // password" is not a fact a directory listing should hand to every colleague.
  const canSeeLockouts = usePermission(PERMISSIONS.USERS_MANAGE_2FA);
  // Attendance data about a colleague, so the column is simply absent without it —
  // the API does not send the fields either.
  const canSeePresence = usePermission(PERMISSIONS.USERS_SESSIONS_READ);
  const navigate = useNavigate();
  const list = useListResource<User>({ resource: "users", path: "/users" });

  // One request for the whole page, not one per row: the lockouts are a short list
  // of people the counter is holding out, so the table asks once and matches.
  const lockedOut = useQuery({
    queryKey: ["users", "locked-out"],
    queryFn: fetchLockedOutUsers,
    enabled: canSeeLockouts,
    // A lockout window is minutes long, so a cached answer goes stale quickly.
    staleTime: 15_000,
  });

  const columns = useMemo<TableColumn<User>[]>(() => {
    const locked = new Set((lockedOut.data ?? []).map((row) => row.userId));

    /**
     * One column about sign-in state, not two.
     *
     * Last seen and the lockout badge answer the same question — "can this person
     * get in, and when were they last here" — and side by side they read as a
     * column of dates beside a column of dashes. The two permissions are still
     * separate, so what the cell contains depends on what the viewer may know:
     * a person who may release lockouts but not see attendance gets the badge
     * alone, under a header that says only that.
     */
    const signIn: TableColumn<User>[] =
      canSeePresence || canSeeLockouts
        ? [
            {
              id: "lastLoginAt",
              ...(canSeePresence ? { accessorKey: "lastLoginAt" } : {}),
              header: canSeePresence ? "Last seen" : "Sign-in",
              // The lock lives in Redis rather than in the query the server sorts,
              // so this only sorts when it is showing the stored column.
              enableSorting: canSeePresence,
              cell: ({ row }) => (
                <span className="flex items-center gap-2 whitespace-nowrap">
                  {canSeeLockouts && locked.has(row.original.id) ? (
                    <Badge tone="danger">Locked out</Badge>
                  ) : null}
                  {canSeePresence && row.original.signedIn ? (
                    // "Has a live session", which is as close to "here now" as this
                    // app can honestly claim — it cannot know they left the desk.
                    <Badge tone="success">Signed in</Badge>
                  ) : null}
                  {canSeePresence ? (
                    row.original.lastLoginAt ? (
                      formatDateTime(row.original.lastLoginAt)
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )
                  ) : locked.has(row.original.id) ? null : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
              ),
            },
          ]
        : [];

    return [...baseColumns, ...signIn];
  }, [canSeeLockouts, canSeePresence, lockedOut.data]);

  // Designations are a fixed catalogue, so the filter picks from them rather than
  // guessing the spelling — searchable, since an org can have plenty.
  const designations = useQuery({
    queryKey: ["designations", "options"],
    queryFn: fetchDesignationOptions,
  });
  const filterDefs = useMemo<FilterDef[]>(
    () => [
      { field: "createdAt", label: "Joined", kind: "daterange" },
      { field: "name", label: "Name", kind: "text" },
      { field: "email", label: "Email", kind: "text" },
      { field: "username", label: "Username", kind: "text" },
      {
        field: "designation",
        label: "Designation",
        kind: "combobox",
        options: (designations.data ?? []).map((d) => ({ value: d.name, label: d.name })),
      },
      {
        field: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
      // Both only for somebody allowed to see presence at all: offering a filter
      // over a column that is not there would be a control that quietly does
      // nothing.
      ...(canSeePresence
        ? ([
            {
              field: "signedIn",
              label: "Signed in now",
              kind: "select",
              options: [
                { value: "true", label: "Signed in" },
                { value: "false", label: "Not signed in" },
              ],
            },
            {
              // The "long time inactive" list, asked for in as many words. A date
              // range could express it by setting only its upper bound, but that
              // asks somebody to reason backwards — and quietly leaves out
              // everybody who has never signed in, who are most of the answer.
              field: "notSeenForDays",
              label: "Not seen for",
              kind: "select",
              options: [
                { value: "7", label: "Over a week" },
                { value: "30", label: "Over a month" },
                { value: "90", label: "Over three months" },
                { value: "365", label: "Over a year" },
              ],
            },
            // And the plain range, for a question about a particular window.
            { field: "lastLoginAt", label: "Last seen", kind: "daterange" },
          ] satisfies FilterDef[])
        : []),
    ],
    [designations.data, canSeePresence],
  );

  return (
    <>
      <PageHeader
        title="Users"
        description="People who can sign in. Access comes from their groups."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void exportUsers()}>
              <Download className="h-4 w-4" /> Export
            </Button>
            {canImport ? (
              <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import
              </Button>
            ) : null}
            <Can permission={PERMISSIONS.USERS_CREATE}>
              <Button size="sm" variant="secondary" onClick={() => setInviteOpen(true)}>
                <Mail className="h-4 w-4" />
                Invite
              </Button>
              <Button size="sm" onClick={() => void navigate({ to: "/users/new" })}>
                <UserPlus className="h-4 w-4" />
                New user
              </Button>
            </Can>
          </div>
        }
      />

      {importOpen ? (
        <ImportDialog
          title="Import users"
          description="People are matched by email. New people are invited — no passwords in the file; they get a set-password link. Groups and Companies (separated by | or ;) place them; a blank cell leaves that unchanged. The Superadmin group is refused. Rows are validated first."
          onClose={() => setImportOpen(false)}
          downloadTemplate={downloadUserTemplate}
          runImport={importUsers}
          onImported={() => list.refetch()}
        />
      ) : null}

      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        quickSearch={{ field: "name", placeholder: "Search people" }}
        quickToggle={{
          field: "status",
          label: "Active or retired",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Retired" },
          ],
        }}
        initialColumnVisibility={{ designation: false, mobile: false }}
        emptyTitle="No users yet"
        emptyDescription="Invite someone, or create them outright."
        renderCard={(user) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Link
                to="/users/$userId"
                params={{ userId: user.id }}
                className="truncate text-sm font-medium hover:underline"
              >
                {user.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <Badge tone={user.status === "active" ? "success" : "neutral"}>{user.status}</Badge>
          </div>
        )}
      />

      <InviteUserDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}

function InviteUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const invite = useMutation({
    mutationFn: inviteUser,
    onSuccess: async (user) => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      setSent(user.email);
      setName("");
      setEmail("");
    },
  });

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    invite.mutate({ name: name.trim(), email: email.trim() });
  };

  const close = () => {
    setSent(null);
    invite.reset();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/30" onClick={close} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Invite user"
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="text-base font-semibold">Invite a user</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          They'll get an email to set a password. They have no access until you add them to a group.
        </p>

        {sent ? (
          <div className="mt-4 flex flex-col gap-4">
            <Alert tone="success">Invitation sent to {sent}.</Alert>
            <div className="flex justify-end">
              <Button size="sm" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
            {invite.error ? <ErrorAlert error={invite.error} /> : null}

            <Field label="Full name">
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  autoFocus
                  disabled={invite.isPending}
                />
              )}
            </Field>

            <Field label="Email">
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={invite.isPending}
                />
              )}
            </Field>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={close} disabled={invite.isPending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={invite.isPending}>
                {invite.isPending ? <Spinner /> : null}
                Send invitation
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
