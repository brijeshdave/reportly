// Author: Brijesh Dave <https://github.com/brijeshdave>
// Department detail: rename/move via the editor, deactivate or delete, and manage
// membership. Membership carries the HOD flag, so it is edited as a table (member
// + HOD) rather than a plain id-set picker. Deleting is refused by the API while
// the department has sub-departments or members; that refusal surfaces here.
import { PERMISSIONS, type DepartmentRank, type Location, type User } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, UsersRound, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Avatar } from "@/components/avatar.js";
import { MultiSelect } from "@/components/ui/multi-select.js";
import { Can, usePermission } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { HistoryTab } from "@/components/history-tab.js";
import { PageTabs, TabPanel } from "@/components/page-tabs.js";
import {
  UnsavedChangesNotice,
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/components/unsaved-changes.js";
import { Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { fetchCompanyLocations } from "@/services/locations.js";
import {
  deleteDepartment,
  fetchDepartment,
  fetchDepartmentMembers,
  fetchOrgPeople,
  setDepartmentMembers,
  setDepartmentStatus,
} from "@/services/departments.js";
import { searchUsers } from "@/services/users.js";

const TABS = [
  { id: "members", label: "Members" },
  { id: "history", label: "History" },
];

export function DepartmentDetailPage({ departmentId, tab }: { departmentId: string; tab: string }) {
  const navigate = useNavigate();
  const tabNavigate = useNavigate({ from: "/departments/$departmentId" });
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const department = useQuery({
    queryKey: ["departments", "detail", departmentId],
    queryFn: () => fetchDepartment(departmentId),
  });

  const toggleStatus = useMutation({
    mutationFn: (status: "active" | "inactive") => setDepartmentStatus(departmentId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["departments"] }),
  });

  const remove = useMutation({
    mutationFn: () => deleteDepartment(departmentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["departments"] });
      await navigate({ to: "/departments" });
    },
  });

  if (department.isLoading) return <Spinner />;
  if (department.error) return <ErrorAlert error={department.error} />;
  if (!department.data) return null;

  const active = department.data.status === "active";
  const activeTab = TABS.some((candidate) => candidate.id === tab) ? tab : "members";

  return (
    <UnsavedChangesProvider>
      <PageHeader
        title={department.data.name}
        description="Its members, and where it sits in the org tree. A user can be Head of Department here and a plain member elsewhere."
        actions={
          <div className="flex items-center gap-2">
            {!active ? <Badge tone="neutral">Inactive</Badge> : null}
            <Can permission={PERMISSIONS.DEPARTMENTS_UPDATE}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void navigate({
                    to: "/departments/$departmentId/edit",
                    params: { departmentId },
                  })
                }
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => toggleStatus.mutate(active ? "inactive" : "active")}
                disabled={toggleStatus.isPending}
              >
                {active ? "Deactivate" : "Reactivate"}
              </Button>
            </Can>
            <Can permission={PERMISSIONS.DEPARTMENTS_DELETE}>
              <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            </Can>
          </div>
        }
      />

      {toggleStatus.error ? <ErrorAlert className="mt-2" error={toggleStatus.error} /> : null}
      {remove.error ? <ErrorAlert className="mt-2" error={remove.error} /> : null}

      <UnsavedChangesNotice />

      <PageTabs
        tabs={TABS}
        active={activeTab}
        onSelect={(id) => void tabNavigate({ search: { tab: id }, replace: true })}
      />

      <div className="pt-6">
        <TabPanel id="members" active={activeTab}>
          <MembersTab departmentId={departmentId} companyId={department.data.companyId} />
        </TabPanel>
        <TabPanel id="history" active={activeTab}>
          <HistoryTab entityType="departments" id={departmentId} />
        </TabPanel>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${department.data.name}?`}
        description="This is refused while the department has sub-departments or members. Deactivating instead keeps everything and can be undone."
        confirmLabel="Delete department"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </UnsavedChangesProvider>
  );
}

/**
 * Membership, and with it the reporting line — the thing report visibility is
 * computed from, so it is edited deliberately rather than inferred.
 *
 * Three facts per person:
 *   - **rank** — what to call them. A label, nothing more.
 *   - **reports to** — who is above them. This is the hierarchy. It may name
 *     somebody in another department, because a Head of Department reports up to
 *     Management, not sideways into their own team.
 *   - **sites** — which locations their membership covers. None means all of them.
 *//**
 * Membership, and with it the reporting line.
 *
 * This lists only the people who are *in* the department. The earlier version drew
 * every user in the install with three dropdowns each, which is legible at twenty
 * people and a wall of noise at two hundred — you cannot see the team you are
 * arranging for all the people who are not on it. Adding somebody is now a search,
 * answered by the server, so the size of the install stops mattering.
 */
function MembersTab({ departmentId, companyId }: { departmentId: string; companyId: string }) {
  const canAssign = usePermission(PERMISSIONS.DEPARTMENTS_ASSIGN);
  const queryClient = useQueryClient();

  const members = useQuery({
    queryKey: ["departments", "members", departmentId],
    queryFn: () => fetchDepartmentMembers(departmentId),
  });
  const org = useQuery({ queryKey: ["departments", "people"], queryFn: fetchOrgPeople });
  const sites = useQuery({
    queryKey: ["locations", "of-company", companyId],
    queryFn: () => fetchCompanyLocations(companyId),
  });

  const [draft, setDraft] = useState<Map<string, Membership> | null>(null);
  const saved = useMemo(() => {
    const map = new Map<string, Membership>();
    for (const member of members.data ?? []) {
      map.set(member.userId, {
        name: member.name,
        email: member.email,
        designation: member.designation,
        avatarVersion: member.avatarVersion ?? null,
        rank: member.rank,
        reportsToId: member.reportsToId,
        locationIds: [...member.locationIds].sort(),
      });
    }
    return map;
  }, [members.data]);

  const current = draft ?? saved;
  const dirty = draft !== null && !sameMembership(current, saved);
  useUnsavedChanges("members", dirty);

  const save = useMutation({
    mutationFn: () =>
      setDepartmentMembers(
        departmentId,
        [...current].map(([userId, m]) => ({
          userId,
          rank: m.rank,
          reportsToId: m.reportsToId,
          locationIds: m.locationIds,
        })),
      ),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["departments"] });
    },
  });

  if (members.isLoading || sites.isLoading || org.isLoading) return <Spinner />;
  if (members.error) return <ErrorAlert error={members.error} />;

  const edit = (userId: string, patch: Partial<Membership>) => {
    const next = new Map(current);
    const existing = next.get(userId);
    if (existing) next.set(userId, { ...existing, ...patch });
    setDraft(next);
  };

  const add = (user: User) => {
    if (current.has(user.id)) return;
    const next = new Map(current);
    next.set(user.id, {
      name: user.name,
      email: user.email,
      designation: user.designation ?? null,
      avatarVersion: user.avatarVersion ?? null,
      rank: "member",
      reportsToId: null,
      locationIds: [],
    });
    setDraft(next);
  };

  const drop = (userId: string) => {
    const next = new Map(current);
    next.delete(userId);
    // Nobody may be left reporting to someone who has gone: a dangling manager
    // would quietly drop their team out of every downline above them.
    for (const [id, m] of next) {
      if (m.reportsToId === userId) next.set(id, { ...m, reportsToId: null });
    }
    setDraft(next);
  };

  const allSites = sites.data ?? [];

  // Manager candidates: everyone already in the company's org, plus everyone about
  // to be added here — a whole team can be built in one save. Anyone else, the API
  // would refuse, so they are not offered.
  const orgPeople = org.data ?? [];
  const candidates = [
    ...new Map([
      ...orgPeople.map((p) => [p.userId, { userId: p.userId, name: p.name }] as const),
      ...[...current].map(([userId, m]) => [userId, { userId, name: m.name }] as const),
    ]).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  // Heads first, then leads, then everyone else — the shape of the team, at a glance.
  const RANK_ORDER: Record<DepartmentRank, number> = { hod: 0, lead: 1, member: 2 };
  const rows = [...current].sort(
    ([, a], [, b]) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank] || a.name.localeCompare(b.name),
  );
  const hodCount = rows.filter(([, m]) => m.rank === "hod").length;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              {current.size} {current.size === 1 ? "member" : "members"}
              {hodCount > 0 ? ` · ${hodCount} HOD` : ""}
            </h2>
            <p className="text-xs text-muted-foreground">
              Who reports to whom is the hierarchy — the rank beside it is only a label.
            </p>
          </div>
          {canAssign ? (
            <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending ? <Spinner /> : null}
              Save members
            </Button>
          ) : null}
        </div>

        {save.error ? <ErrorAlert error={save.error} /> : null}
        {canAssign ? <AddMember onAdd={add} alreadyIn={new Set(current.keys())} /> : null}
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="Nobody in this department yet"
          description="Search above to add the first person."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(([userId, membership]) => (
            <MemberRow
              key={userId}
              userId={userId}
              membership={membership}
              candidates={candidates.filter((c) => c.userId !== userId)}
              sites={allSites}
              canAssign={canAssign}
              onEdit={(patch) => edit(userId, patch)}
              onRemove={() => drop(userId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One person's row: who they are, and the three facts that place them. */
function MemberRow({
  userId,
  membership,
  candidates,
  sites,
  canAssign,
  onEdit,
  onRemove,
}: {
  userId: string;
  membership: Membership;
  candidates: { userId: string; name: string }[];
  sites: Location[];
  canAssign: boolean;
  onEdit: (patch: Partial<Membership>) => void;
  onRemove: () => void;
}) {
  return (
    <Card className="flex flex-wrap items-center gap-3 p-3">
      <Avatar userId={userId} name={membership.name} version={membership.avatarVersion} size="md" />

      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium">{membership.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {membership.designation ?? membership.email}
        </p>
      </div>

      <label className="flex flex-col gap-0.5 text-[11px]">
        <span className="text-muted-foreground">Rank</span>
        <select
          value={membership.rank}
          onChange={(event) => onEdit({ rank: event.target.value as DepartmentRank })}
          disabled={!canAssign}
          aria-label={`Rank: ${membership.name}`}
          className="h-8 w-40 rounded-lg border border-border bg-card px-2 text-xs"
        >
          <option value="hod">Head of Department</option>
          <option value="lead">Team leader</option>
          <option value="member">Member</option>
        </select>
      </label>

      <label className="flex flex-col gap-0.5 text-[11px]">
        <span className="text-muted-foreground">Reports to</span>
        <select
          value={membership.reportsToId ?? ""}
          onChange={(event) => onEdit({ reportsToId: event.target.value || null })}
          disabled={!canAssign}
          aria-label={`Reports to: ${membership.name}`}
          className="h-8 w-44 rounded-lg border border-border bg-card px-2 text-xs"
        >
          <option value="">Nobody (top of the line)</option>
          {candidates.map((candidate) => (
            <option key={candidate.userId} value={candidate.userId}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex w-40 flex-col gap-0.5 text-[11px]">
        <span className="text-muted-foreground">Sites</span>
        {/* No sites picked means every site — so that is what the button says. */}
        <MultiSelect
          label={`Sites: ${membership.name}`}
          options={sites.map((site) => ({ value: site.id, label: site.name }))}
          selected={membership.locationIds}
          onChange={(locationIds) => onEdit({ locationIds })}
          emptyLabel="All sites"
          disabled={!canAssign}
        />
      </div>

      {canAssign ? (
        <Button
          size="icon"
          variant="ghost"
          onClick={onRemove}
          aria-label={`Remove ${membership.name}`}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </Card>
  );
}

/**
 * Add somebody by searching for them. The server does the matching, so this stays
 * the same size whether the install has fifty people or fifty thousand.
 */
function AddMember({ onAdd, alreadyIn }: { onAdd: (user: User) => void; alreadyIn: Set<string> }) {
  const [term, setTerm] = useState("");

  const results = useQuery({
    queryKey: ["users", "search", term],
    queryFn: () => searchUsers(term),
    enabled: term.trim().length > 1,
  });

  const found = (results.data ?? []).filter((user) => !alreadyIn.has(user.id));

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search a person by name to add them…"
        aria-label="Add a person"
      />

      {term.trim().length > 1 ? (
        <div className="divide-y divide-border rounded-xl border border-border">
          {results.isLoading ? <p className="px-3 py-2 text-xs">Searching…</p> : null}
          {!results.isLoading && found.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Nobody new matches “{term}”.</p>
          ) : null}
          {found.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => {
                onAdd(user);
                setTerm("");
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
            >
              <Avatar userId={user.id} name={user.name} version={user.avatarVersion} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{user.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {user.designation ?? user.email}
                </span>
              </span>
              <Plus className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One person's place in this department, plus what it takes to draw them. */
interface Membership {
  name: string;
  email: string;
  designation: string | null;
  avatarVersion: number | null;
  rank: DepartmentRank;
  reportsToId: string | null;
  locationIds: string[];
}

function sameMembership(a: Map<string, Membership>, b: Map<string, Membership>): boolean {
  if (a.size !== b.size) return false;
  for (const [userId, left] of a) {
    const right = b.get(userId);
    if (!right) return false;
    if (left.rank !== right.rank || left.reportsToId !== right.reportsToId) return false;
    if (left.locationIds.length !== right.locationIds.length) return false;
    const l = [...left.locationIds].sort();
    const r = [...right.locationIds].sort();
    if (l.some((value, index) => value !== r[index])) return false;
  }
  return true;
}
