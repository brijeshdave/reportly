// Author: Brijesh Dave <https://github.com/brijeshdave>
// Downtime on a report — how long the *thing* was out of service, which is not the
// same as how long the *person* spent on it. Those two numbers get conflated
// everywhere, and once they are added together neither means anything, so they are
// two records and this panel says which is which.
//
// An entry left open (no end time) is the normal way to record a breakdown you are
// still in the middle of: save it now, come back and close it when the line runs.
import {
  type DowntimeEntry,
  type DowntimeTargetKind,
  type JournalTarget,
  formatDateTime,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Input, Select, Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card } from "@/components/ui/primitives.js";
import {
  createDowntime,
  deleteDowntime,
  fetchReportDowntime,
  updateDowntime,
} from "@/services/downtime.js";

/** datetime-local ↔ ISO, in the viewer's own time zone. */
const toIso = (local: string): string | undefined =>
  local ? new Date(local).toISOString() : undefined;
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "2h 05m" — minutes alone stop being readable somewhere around the first hour.
 *
 * Floored at zero: a span can only come out negative if something started in the
 * future (a mistyped date, a clock running ahead), and "-3h 20m of downtime" is a
 * worse answer than "0m" for a thing that has not gone down yet.
 */
export function formatMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Only physical things go down — a department or a person cannot. */
const downtimeKinds = new Set(["asset", "device"]);

export function DowntimePanel({
  reportId,
  targets,
  canWrite,
}: {
  reportId: string;
  targets: JournalTarget[];
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const entries = useQuery({
    queryKey: ["downtime", "report", reportId],
    queryFn: () => fetchReportDowntime(reportId),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["downtime"] });
  };

  const [adding, setAdding] = useState(false);

  // Downtime rides on the report's scope, so the only things offerable are the
  // ones this report is already about — and of those, only the ones whose TYPE
  // says an outage is worth recording. A PC on an entry is a thing the work was
  // about, not a thing that stopped production.
  const options = targets.filter((t) => downtimeKinds.has(t.kind) && t.tracksDowntime);
  const excluded = targets.filter((t) => downtimeKinds.has(t.kind) && !t.tracksDowntime);

  if (entries.isLoading) return <Spinner />;

  const list = entries.data ?? [];
  const openCount = list.filter((e) => !e.endedAt).length;

  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Downtime</h2>
        {openCount > 0 ? <Badge tone="warning">{openCount} still down</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        How long <strong>production</strong> was stopped, per machine — not how long you spent,
        which is the work time on the entry itself. Leave this empty when nothing stopped: plenty of
        work costs no downtime at all.
      </p>

      {entries.error ? <ErrorAlert error={entries.error} /> : null}

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">None recorded.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((entry) => (
            <DowntimeRow key={entry.id} entry={entry} canWrite={canWrite} onChange={refresh} />
          ))}
        </ul>
      )}

      {canWrite ? (
        options.length === 0 ? (
          // Two different empty states, because they need two different actions:
          // name a machine, or say that this kind of machine can stop production.
          excluded.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing on this entry stops production — {excluded.map((t) => t.label).join(", ")}{" "}
              {excluded.length === 1 ? "is" : "are"} not the kind of thing downtime is recorded for.
              If one of them does halt something, tick <strong>downtime</strong> against its type in
              Assets or Journal setup.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Add an asset or a device to <strong>what this report is about</strong> first —
              downtime is recorded against the thing that was down.
            </p>
          )
        ) : adding ? (
          <AddDowntimeForm
            reportId={reportId}
            options={options}
            onDone={async () => {
              setAdding(false);
              await refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <div>
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Record downtime
            </Button>
          </div>
        )
      ) : null}
    </Card>
  );
}

function DowntimeRow({
  entry,
  canWrite,
  onChange,
}: {
  entry: DowntimeEntry;
  canWrite: boolean;
  onChange: () => void;
}) {
  const [endedAt, setEndedAt] = useState(toLocalInput(entry.endedAt));
  const open = !entry.endedAt;

  const save = useMutation({
    mutationFn: () => updateDowntime(entry.id, { endedAt: toIso(endedAt) ?? null }),
    onSuccess: onChange,
  });
  const remove = useMutation({ mutationFn: () => deleteDowntime(entry.id), onSuccess: onChange });

  const dirty = endedAt !== toLocalInput(entry.endedAt);

  return (
    <li className="rounded-xl border border-border p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">{entry.targetLabel}</span>
        {open ? (
          <Badge tone="warning">still down</Badge>
        ) : (
          <Badge tone="neutral">{formatMinutes(entry.durationMinutes ?? 0)}</Badge>
        )}
        {canWrite ? (
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto"
            aria-label={`Delete downtime on ${entry.targetLabel}`}
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        From {formatDateTime(entry.startedAt)}
        {entry.reason ? ` · ${entry.reason}` : ""}
      </p>

      {canWrite ? (
        <div className="mt-2 flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{open ? "Closed at" : "Ended"}</span>
            <Input
              type="datetime-local"
              value={endedAt}
              onChange={(event) => setEndedAt(event.target.value)}
              className="h-8"
            />
          </label>
          {dirty ? (
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              Save
            </Button>
          ) : null}
        </div>
      ) : null}

      {save.error ? <ErrorAlert error={save.error} /> : null}
      {remove.error ? <ErrorAlert error={remove.error} /> : null}
    </li>
  );
}

function AddDowntimeForm({
  reportId,
  options,
  onDone,
  onCancel,
}: {
  reportId: string;
  options: JournalTarget[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const first = options[0]!;
  const [target, setTarget] = useState(`${first.kind}:${first.id}`);
  const [startedAt, setStartedAt] = useState(toLocalInput(new Date().toISOString()));
  const [endedAt, setEndedAt] = useState("");
  const [reason, setReason] = useState("");

  const create = useMutation({
    mutationFn: () => {
      const [kind, ...rest] = target.split(":");
      return createDowntime({
        reportId,
        targetKind: kind as DowntimeTargetKind,
        targetId: rest.join(":"),
        startedAt: toIso(startedAt)!,
        endedAt: toIso(endedAt),
        reason: reason.trim() || undefined,
      });
    },
    onSuccess: onDone,
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
      {create.error ? <ErrorAlert error={create.error} /> : null}

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">What was down</span>
        <Select value={target} onChange={(event) => setTarget(event.target.value)}>
          {options.map((option) => (
            <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Went down at</span>
          <Input
            type="datetime-local"
            value={startedAt}
            onChange={(event) => setStartedAt(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Back up at</span>
          <Input
            type="datetime-local"
            value={endedAt}
            onChange={(event) => setEndedAt(event.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Leave &ldquo;back up&rdquo; empty if it is still down — it will wait in the pending queue
        until you close it.
      </p>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Reason (optional)</span>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Belt seized"
        />
      </label>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending || !startedAt}>
          {create.isPending ? <Spinner /> : null}
          Record
        </Button>
      </div>
    </div>
  );
}
