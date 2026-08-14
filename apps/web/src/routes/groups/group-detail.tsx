// Author: Brijesh Dave <https://github.com/brijeshdave>
// Group detail. Each assignment tab replaces its whole set on save, so every tab
// loads the current assignments first. System groups are read-only here: their
// definition is fixed, and cloning is how you get an editable copy.
import { PERMISSIONS, type Group, type Role, type User } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useState } from "react";

import { AssignmentPicker, type PickerOption } from "@/components/assignment-picker.js";
import { Can, usePermission } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { HistoryTab } from "@/components/history-tab.js";
import { PageTabs, TabPanel } from "@/components/page-tabs.js";
import { Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import {
  UnsavedChangesNotice,
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/components/unsaved-changes.js";
import { useOptions } from "@/hooks/use-options.js";
import {
  deleteGroup,
  fetchGroup,
  fetchGroupAssignments,
  fetchGroupImpact,
  setGroupAssignment,
  type AssignmentKind,
  type GroupAssignments,
} from "@/services/groups.js";

const TABS = [
  { id: "members", label: "Members" },
  { id: "roles", label: "Roles" },
  { id: "history", label: "History" },
];

export function GroupDetailPage({ groupId, tab }: { groupId: string; tab: string }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const navigate = useNavigate();
  const tabNavigate = useNavigate({ from: "/groups/$groupId" });
  const queryClient = useQueryClient();

  const group = useQuery({
    queryKey: ["groups", "detail", groupId],
    queryFn: () => fetchGroup(groupId),
  });

  const assignments = useQuery({
    queryKey: ["groups", "assignments", groupId],
    queryFn: () => fetchGroupAssignments(groupId),
  });

  const remove = useMutation({
    mutationFn: () => deleteGroup(groupId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["groups"] });
      await navigate({ to: "/groups" });
    },
  });

  if (group.isLoading || assignments.isLoading) return <Spinner />;
  if (group.error) return <ErrorAlert error={group.error} />;
  if (assignments.error) return <ErrorAlert error={assignments.error} />;
  if (!group.data || !assignments.data) return null;

  const activeTab = TABS.some((candidate) => candidate.id === tab) ? tab : "members";

  return (
    // Tab panels stay mounted once visited, so a half-finished selection survives
    // a trip to another tab; the provider marks the tabs still holding one.
    <UnsavedChangesProvider>
      <PageHeader
        title={group.data.name}
        description={
          group.data.isSystem
            ? "A system group. Its roles are fixed — clone it to make changes."
            : "Members get this group's roles. Where they may use them is set on each person."
        }
        actions={
          !group.data.isSystem ? (
            <Can permission={PERMISSIONS.GROUPS_DELETE}>
              <Button size="sm" variant="destructive" onClick={() => setConfirmOpen(true)}>
                Delete group
              </Button>
            </Can>
          ) : (
            <Badge tone="brand">System</Badge>
          )
        }
      />

      <UnsavedChangesNotice />

      <PageTabs
        tabs={TABS}
        active={activeTab}
        onSelect={(id) => void tabNavigate({ search: { tab: id }, replace: true })}
      />

      <div className="pt-6">
        <TabPanel id="members" active={activeTab}>
          <MembersTab group={group.data} assignments={assignments.data} />
        </TabPanel>
        <TabPanel id="roles" active={activeTab}>
          <RolesTab group={group.data} assignments={assignments.data} />
        </TabPanel>
        <TabPanel id="history" active={activeTab}>
          <HistoryTab entityType="groups" id={groupId} />
        </TabPanel>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Delete ${group.data.name}?`}
        description={<GroupDeleteImpact groupId={groupId} />}
        confirmLabel="Delete group"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </UnsavedChangesProvider>
  );
}

/**
 * A group holds no data of its own — every foreign key pointing at it is a join
 * row — so deleting it destroys nothing and is not guarded. It does revoke its
 * members' access, which is the part worth stating plainly.
 */
function GroupDeleteImpact({ groupId }: { groupId: string }) {
  const impact = useQuery({
    queryKey: ["groups", "impact", groupId],
    queryFn: () => fetchGroupImpact(groupId),
  });

  if (impact.isLoading) return <Spinner />;

  const members = impact.data?.members ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <p>
        {members === 0
          ? "This group has no members."
          : `${members} ${members === 1 ? "person loses" : "people lose"} the permissions this group grants them.`}
      </p>
      <p className="text-xs">
        Nothing else is deleted: the users and roles it points at all survive.
      </p>
    </div>
  );
}

/** Saves one assignment kind, then refreshes the group's assignments. */
function useAssignmentSaver(groupId: string, kind: AssignmentKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => setGroupAssignment(groupId, kind, ids),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["groups", "assignments", groupId] });
      // Membership changes a user's permissions, so their session view is stale.
      if (kind === "users") await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

/** The props every assignment tab takes. */
interface TabProps {
  group: Group;
  assignments: GroupAssignments;
}

function SystemGroupNotice() {
  return (
    <EmptyState
      icon={Lock}
      title="This group is fixed"
      description="System groups cannot be edited. Clone this group to get an editable copy of its roles."
    />
  );
}

function MembersTab({ group, assignments }: TabProps) {
  const canAssign = usePermission(PERMISSIONS.GROUPS_ASSIGN);
  const users = useOptions<User>("users", "/users");
  const save = useAssignmentSaver(group.id, "users");
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges("members", dirty);

  // Membership is editable even for a system group; only its definition is fixed.
  if (users.isLoading) return <Spinner />;
  if (users.error) return <ErrorAlert error={users.error} />;

  const options: PickerOption[] = (users.data ?? []).map((user) => ({
    id: user.id,
    label: user.name,
    description: user.email + (user.status === "inactive" ? " · inactive" : ""),
  }));

  return (
    <Card className="p-6">
      <AssignmentPicker
        options={options}
        selectedIds={assignments.users}
        onSave={(ids) => save.mutateAsync(ids)}
        onDirtyChange={setDirty}
        disabled={!canAssign}
        emptyMessage="Invite a user first."
      />
    </Card>
  );
}

function RolesTab({ group, assignments }: TabProps) {
  const canAssign = usePermission(PERMISSIONS.GROUPS_ASSIGN);
  const roles = useOptions<Role>("roles", "/roles", !group.isSystem);
  const save = useAssignmentSaver(group.id, "roles");
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges("roles", dirty);

  if (group.isSystem) return <SystemGroupNotice />;
  if (roles.isLoading) return <Spinner />;
  if (roles.error) return <ErrorAlert error={roles.error} />;

  const options: PickerOption[] = (roles.data ?? []).map((role) => ({
    id: role.id,
    label: role.name,
    description: `${role.permissions.length} permissions`,
  }));

  return (
    <Card className="p-6">
      <AssignmentPicker
        options={options}
        selectedIds={assignments.roles}
        onSave={(ids) => save.mutateAsync(ids)}
        onDirtyChange={setDirty}
        disabled={!canAssign}
      />
    </Card>
  );
}
