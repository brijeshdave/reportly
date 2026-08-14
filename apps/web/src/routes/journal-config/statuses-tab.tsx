// Author: Brijesh Dave <https://github.com/brijeshdave>
// The status workflow. The engine reads the group (open / resolved / rejected) and
// the terminal flag; the name is the organisation's to choose.
import { STATUS_GROUPS, type CreateReportStatus, type JournalStatus } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card } from "@/components/ui/primitives.js";
import {
  createStatus,
  deleteStatus,
  fetchStatuses,
  updateStatus,
} from "@/services/journal-config.js";

const GROUP_TONE = { open: "brand", resolved: "success", rejected: "neutral" } as const;

export function StatusesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const statuses = useQuery({ queryKey: ["report-config", "statuses"], queryFn: fetchStatuses });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["report-config", "statuses"] });

  const [draft, setDraft] = useState<CreateReportStatus>({
    name: "",
    group: "open",
    isTerminal: false,
    orderIndex: 0,
    status: "active",
  });

  const create = useMutation({
    mutationFn: () =>
      createStatus({
        ...draft,
        name: draft.name.trim(),
        isTerminal: draft.group !== "open",
        orderIndex: statuses.data?.length ?? 0,
      }),
    onSuccess: async () => {
      setDraft({ name: "", group: "open", isTerminal: false, orderIndex: 0, status: "active" });
      await refresh();
    },
  });

  if (statuses.isLoading) return <Spinner />;
  if (statuses.error) return <ErrorAlert error={statuses.error} />;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Every status belongs to a <strong>group</strong> the engine understands, whatever you call
        it: <em>open</em> (still being worked), <em>resolved</em> (a good ending), or{" "}
        <em>rejected</em> (not a real issue). A terminal status ends the workflow.
      </p>

      <Card className="divide-y divide-border">
        <div className="grid grid-cols-[1fr_7rem_6rem_5rem_auto] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Name</span>
          <span>Group</span>
          <span>Ends it?</span>
          <span>Status</span>
          <span />
        </div>
        {(statuses.data ?? []).map((status) => (
          <StatusRow key={status.id} status={status} canManage={canManage} onChange={refresh} />
        ))}
      </Card>

      {canManage ? (
        <Card className="flex flex-col gap-3 p-4">
          <h3 className="text-sm font-semibold">Add a status</h3>
          {create.error ? <ErrorAlert error={create.error} /> : null}
          <div className="grid grid-cols-[1fr_8rem_auto] items-end gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Name</span>
              <Input
                value={draft.name}
                onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
                placeholder="e.g. Awaiting parts"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Group</span>
              <select
                value={draft.group}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    group: event.target.value as CreateReportStatus["group"],
                  }))
                }
                className="h-10 rounded-xl border border-border bg-card px-2 text-sm"
              >
                {STATUS_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={create.isPending || draft.name.trim() === ""}
            >
              {create.isPending ? <Spinner /> : null}
              Add
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function StatusRow({
  status,
  canManage,
  onChange,
}: {
  status: JournalStatus;
  canManage: boolean;
  onChange: () => void;
}) {
  const [name, setName] = useState(status.name);
  const active = status.status === "active";

  const save = useMutation({
    mutationFn: (patch: Partial<JournalStatus>) => updateStatus(status.id, patch),
    onSuccess: onChange,
  });
  const remove = useMutation({ mutationFn: () => deleteStatus(status.id), onSuccess: onChange });

  if (!canManage) {
    return (
      <div className="grid grid-cols-[1fr_7rem_6rem_5rem_auto] items-center gap-3 px-4 py-2 text-sm">
        <span className="font-medium">{status.name}</span>
        <Badge tone={GROUP_TONE[status.group]}>{status.group}</Badge>
        <span className="text-xs text-muted-foreground">{status.isTerminal ? "yes" : "no"}</span>
        <Badge tone={active ? "success" : "neutral"}>{active ? "active" : "retired"}</Badge>
        <span />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[1fr_7rem_6rem_5rem_auto] items-center gap-3 px-4 py-2 text-sm">
      <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8" />
      <select
        value={status.group}
        onChange={(event) => save.mutate({ group: event.target.value as JournalStatus["group"] })}
        className="h-8 rounded-lg border border-border bg-card px-1 text-xs"
      >
        {STATUS_GROUPS.map((group) => (
          <option key={group} value={group}>
            {group}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs">
        <input
          type="checkbox"
          checked={status.isTerminal}
          onChange={(event) => save.mutate({ isTerminal: event.target.checked })}
        />
        ends
      </label>
      <button
        type="button"
        onClick={() => save.mutate({ status: active ? "inactive" : "active" })}
        title={active ? "Retire" : "Reactivate"}
      >
        <Badge tone={active ? "success" : "neutral"}>{active ? "active" : "retired"}</Badge>
      </button>
      <div className="flex items-center gap-1">
        {name.trim() !== status.name ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => save.mutate({ name: name.trim() })}
            disabled={save.isPending}
          >
            Save
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Delete ${status.name}`}
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
