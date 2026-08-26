// Author: Brijesh Dave <https://github.com/brijeshdave>
// The severity ladder — how serious an issue is, ordered low → high.
//
// It carries no weight any more. Severity used to multiply a mark into points,
// and this tab said so; scoring is now a fixed pot of at most ten points shared
// among whoever worked the entry, judged by the author and again by their
// manager, and it consults severity nowhere. The box stayed editable long after
// it stopped doing anything, which is worse than useless — it told an
// administrator that tuning it changed what work was worth.
import { type CreateSeverity, type Severity } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card } from "@/components/ui/primitives.js";
import {
  createSeverity,
  deleteSeverity,
  fetchSeverities,
  updateSeverity,
} from "@/services/journal-config.js";

export function SeveritiesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const severities = useQuery({
    queryKey: ["report-config", "severities"],
    queryFn: fetchSeverities,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["report-config", "severities"] });

  const [draft, setDraft] = useState<CreateSeverity>({
    name: "",
    orderIndex: 0,
    // Ten to begin with, like every severity that already exists — a new one is
    // worth what an entry has always been worth until somebody decides otherwise.
    maxPoints: 10,
    status: "active",
  });

  const create = useMutation({
    mutationFn: () =>
      createSeverity({
        ...draft,
        name: draft.name.trim(),
        orderIndex: severities.data?.length ?? 0,
      }),
    onSuccess: async () => {
      setDraft({ name: "", orderIndex: 0, maxPoints: 10, status: "active" });
      await refresh();
    },
  });

  if (severities.isLoading) return <Spinner />;
  if (severities.error) return <ErrorAlert error={severities.error} />;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        How serious an issue is, lowest first. Severity labels the entry, drives the reliability
        figures, and sets <strong>the most that entry can be worth</strong> — a ceiling, not a fixed
        award: the author splits what they think was earned, their manager confirms or nudges it,
        and neither may go above the ceiling. Every severity starts at ten, which is what an entry
        was worth before this existed.
      </p>

      <Card className="divide-y divide-border">
        <div className="grid grid-cols-[1fr_6rem_5rem_auto] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Name</span>
          <span>Max points</span>
          <span>Status</span>
          <span />
        </div>

        {(severities.data ?? []).map((severity) => (
          <SeverityRow
            key={severity.id}
            severity={severity}
            canManage={canManage}
            onChange={refresh}
          />
        ))}
      </Card>

      {canManage ? (
        <Card className="flex flex-col gap-3 p-4">
          <h3 className="text-sm font-semibold">Add a severity</h3>
          {create.error ? <ErrorAlert error={create.error} /> : null}
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Name</span>
              <Input
                value={draft.name}
                onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
                placeholder="e.g. Emergency"
              />
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

function SeverityRow({
  severity,
  canManage,
  onChange,
}: {
  severity: Severity;
  canManage: boolean;
  onChange: () => void;
}) {
  const [name, setName] = useState(severity.name);
  const [maxPoints, setMaxPoints] = useState(String(severity.maxPoints));
  const active = severity.status === "active";

  const save = useMutation({
    mutationFn: (patch: Partial<Severity>) => updateSeverity(severity.id, patch),
    onSuccess: onChange,
  });
  const remove = useMutation({
    mutationFn: () => deleteSeverity(severity.id),
    onSuccess: onChange,
  });

  const dirty = name.trim() !== severity.name || Number(maxPoints) !== severity.maxPoints;

  if (!canManage) {
    return (
      <div className="grid grid-cols-[1fr_6rem_5rem_auto] items-center gap-3 px-4 py-2 text-sm">
        <span className="font-medium">{severity.name}</span>
        <span className="text-muted-foreground">{severity.maxPoints}</span>
        <Badge tone={active ? "success" : "neutral"}>{active ? "active" : "retired"}</Badge>
        <span />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[1fr_6rem_5rem_auto] items-center gap-3 px-4 py-2 text-sm">
      <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8" />
      {/* Half-point steps, like every other number in the scoring model. */}
      <Input
        type="number"
        min="0"
        max="10"
        step="0.5"
        value={maxPoints}
        onChange={(event) => setMaxPoints(event.target.value)}
        className="h-8"
        aria-label={`Max points for ${severity.name}`}
      />
      <button
        type="button"
        onClick={() => save.mutate({ status: active ? "inactive" : "active" })}
        title={active ? "Retire" : "Reactivate"}
      >
        <Badge tone={active ? "success" : "neutral"}>{active ? "active" : "retired"}</Badge>
      </button>
      <div className="flex items-center gap-1">
        {dirty ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => save.mutate({ name: name.trim(), maxPoints: Number(maxPoints) })}
            disabled={save.isPending}
          >
            Save
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Delete ${severity.name}`}
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
