// Author: Brijesh Dave <https://github.com/brijeshdave>
// Who holds this report, who worked it, and how it changed hands.
//
// Two lists that look similar and mean different things, so the panel says which
// is which: the **assignee** is who is on it now, **participants** are everyone who
// worked it. This panel is only about *who* — the points each worker earns are
// scored on the Points card, once the report is resolved.
import { formatDateTime } from "@reportly/shared";
import type { JournalEntry, JournalParticipant } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Users, X } from "lucide-react";
import { useState } from "react";

import { SearchableSelect } from "@/components/searchable-select.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card } from "@/components/ui/primitives.js";
import {
  assignReport,
  fetchHandovers,
  fetchParticipants,
  setParticipants,
} from "@/services/comments.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchDownline } from "@/services/departments.js";

export function AssignmentPanel({ report }: { report: JournalEntry }) {
  const queryClient = useQueryClient();
  const reportId = report.id;

  const { data: session } = useQuery(sessionQuery);
  const me = session?.user;

  // The same source the task editor uses: yourself plus your downline. One idea of
  // "who works for me", so the picker cannot offer somebody the API would refuse.
  const downline = useQuery({
    queryKey: ["downline", me?.id],
    queryFn: () => fetchDownline(me!.id),
    enabled: Boolean(me?.id),
  });
  const handovers = useQuery({
    queryKey: ["reports", reportId, "handovers"],
    queryFn: () => fetchHandovers(reportId),
  });
  const participants = useQuery({
    queryKey: ["reports", reportId, "participants"],
    queryFn: () => fetchParticipants(reportId),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["reports", reportId] });
    await queryClient.invalidateQueries({ queryKey: ["reports", reportId, "handovers"] });
    await queryClient.invalidateQueries({ queryKey: ["reports", reportId, "participants"] });
  };

  const [assigneeId, setAssigneeId] = useState<string>(report.assigneeId ?? "");
  const [reason, setReason] = useState("");

  const assign = useMutation({
    // "" is the empty option, which means nobody — a real destination, not a
    // missing value, so it is sent as an explicit null.
    mutationFn: () =>
      assignReport(reportId, {
        assigneeId: assigneeId || null,
        reason: reason.trim() || undefined,
      }),
    onSuccess: async () => {
      setReason("");
      await refresh();
    },
  });

  // Deduplicated: somebody reachable through two departments appears once.
  const people = [
    ...(me ? [{ id: me.id, name: `${me.name} (you)` }] : []),
    ...new Map(
      (downline.data ?? []).map((m) => [m.userId, { id: m.userId, name: m.name }]),
    ).values(),
  ];
  const current = participants.data ?? [];

  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <ArrowRightLeft className="h-4 w-4" />
        Who has this
      </h2>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            {/* Searchable: handing work over means finding one person in a downline,
                and the name is what you know. */}
            <SearchableSelect
              ariaLabel="Assignee"
              value={assigneeId}
              onChange={setAssigneeId}
              options={people.map((person) => ({ value: person.id, label: person.name }))}
              placeholder="Nobody"
            />
          </div>
          <Button
            size="sm"
            onClick={() => assign.mutate()}
            disabled={assign.isPending || assigneeId === (report.assigneeId ?? "")}
          >
            {assign.isPending ? <Spinner /> : null}
            Hand over
          </Button>
        </div>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why (optional) — e.g. Sam is off shift"
          className="h-9 rounded-xl border border-border bg-card px-3 text-sm"
        />
        {assign.error ? <ErrorAlert error={assign.error} /> : null}
      </div>

      {(handovers.data ?? []).length > 0 ? (
        <ol className="flex flex-col gap-1 border-t border-border pt-3 text-xs">
          {(handovers.data ?? []).map((h) => (
            <li key={h.id} className="flex flex-wrap items-baseline gap-1 text-muted-foreground">
              <span className="font-medium text-foreground">{h.toUserName ?? "Nobody"}</span>
              <span>
                {h.fromUserName ? `took it from ${h.fromUserName}` : "picked it up"} · by{" "}
                {h.byUserName} · {formatDateTime(h.handedAt)}
              </span>
              {h.reason ? <span className="italic">“{h.reason}”</span> : null}
            </li>
          ))}
        </ol>
      ) : null}

      <ParticipantsSection
        reportId={reportId}
        authorId={report.authorId}
        people={people}
        current={current}
        loading={participants.isLoading}
        onChanged={refresh}
      />
    </Card>
  );
}

/**
 * Who worked on the report — the membership.
 *
 * Editable any time: somebody joins on Tuesday and the record should say so on
 * Tuesday. Adding or removing here changes *who* is on the report; how the points
 * divide is a separate step on the Points card. Dropping somebody who was already
 * scored drops their score too — the server prunes it and re-freezes the ledger.
 */
function ParticipantsSection({
  reportId,
  authorId,
  people,
  current,
  loading,
  onChanged,
}: {
  reportId: string;
  authorId: string;
  people: { id: string; name: string }[];
  current: JournalParticipant[];
  loading: boolean;
  onChanged: () => void;
}) {
  const save = useMutation({
    mutationFn: (next: { userId: string }[]) => setParticipants(reportId, next),
    onSuccess: onChanged,
  });

  const asMembers = (rows: JournalParticipant[]) => rows.map((x) => ({ userId: x.userId }));
  const currentIds = current.map((p) => p.userId);
  const unlisted = people.filter((person) => !currentIds.includes(person.id));

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Users className="h-4 w-4" />
        Who worked on it
      </h3>
      <p className="text-xs text-muted-foreground">
        Everyone who worked this report. The points they each earn are set on the Points card once
        the report is resolved.
      </p>

      {loading ? <Spinner /> : null}

      {current.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {current.map((p) => (
            <li key={p.userId} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {p.userName}
                {p.userId === authorId ? (
                  <span className="ml-1 text-xs text-muted-foreground">· raised it</span>
                ) : null}
              </span>
              {/* Anyone but the author can be removed — the record of who worked on
                  something should be correctable as soon as it is wrong. The author
                  stays on the list so they can always be scored (zero, if they did
                  nothing). */}
              {p.userId === authorId ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${p.userName}`}
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate(asMembers(current.filter((x) => x.userId !== p.userId)))
                  }
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {unlisted.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Add somebody who worked on it</span>
          <div className="flex flex-wrap gap-1.5">
            {unlisted.map((person) => (
              <button
                key={person.id}
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate([...asMembers(current), { userId: person.id }])}
              >
                <Badge tone="neutral">+ {person.name}</Badge>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {save.error ? <ErrorAlert error={save.error} /> : null}
    </div>
  );
}
