// Author: Brijesh Dave <https://github.com/brijeshdave>
// Requesting a shift change: pick one of your own shifts in a department's month, add
// an optional suggested colleague to swap with, and a note. It goes to your reporting
// manager, who confirms who to swap with and approves — see Scheduling → Shift change.
import { formatDate, formatMonthYear, type ScheduleGrid } from "@reportly/shared";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { ErrorAlert } from "@/components/ui/error-alert.js";
import { SearchableSelect } from "@/components/searchable-select.js";
import { Alert, Field, Select, Spinner } from "@/components/ui/form.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { departmentOptions } from "@/lib/department-options.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchUserDepartments } from "@/services/departments.js";
import { fetchMyEntries, fetchSchedule, requestSwap } from "@/services/shifts.js";

export function ShiftChangeRequestPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const navigate = useNavigate();
  const me = session.user.id;

  const myDepartments = useQuery({
    queryKey: ["users", "departments", me],
    queryFn: () => fetchUserDepartments(me),
  });
  // A schedule belongs to the active company, so only this company's memberships
  // are candidates — the others cannot be scheduled against from here.
  const departments = (myDepartments.data ?? []).filter((d) => d.companyId === session.companyId);
  const deptOptions = departmentOptions(
    departments.map((d) => ({ value: d.departmentId, name: d.name, path: d.path })),
  );

  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const effectiveDept = departmentId ?? departments[0]?.departmentId ?? null;

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const step = (delta: number) => {
    const m = month + delta;
    if (m < 1) {
      setYear(year - 1);
      setMonth(12);
    } else if (m > 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(m);
    }
  };

  // My own cells, wherever I am rostered: a department has a rota per site plus a
  // central one, and the person asking for a change knows the day, not the rota.
  const mine = useQuery({
    queryKey: ["schedule", "my-entries", effectiveDept, year, month],
    queryFn: () => fetchMyEntries({ departmentId: effectiveDept as string, year, month }),
    enabled: effectiveDept !== null,
  });

  const [requesterEntryId, setRequesterEntryId] = useState("");
  const [counterpartEntryId, setCounterpartEntryId] = useState("");
  const [note, setNote] = useState("");

  // My own changeable cells this month (a working shift or a weekly off).
  const mineShifts = useMemo(
    () =>
      (mine.data ?? [])
        .filter((e) => (e.state === "working" && e.shiftId) || e.state === "off")
        .sort((a, b) => a.date.localeCompare(b.date)),
    [mine.data],
  );
  const cellLabel = (e: (typeof mineShifts)[number]) =>
    e.state === "off" ? "W/O" : (e.shiftName ?? "—");
  const chosen = mineShifts.find((e) => e.entryId === requesterEntryId);

  // The colleagues to suggest come from the rota the chosen cell is on — which is
  // also what makes a suggestion same-site by construction.
  const grid = useQuery({
    queryKey: ["schedule", effectiveDept, chosen?.locationId ?? "", year, month],
    queryFn: () =>
      fetchSchedule({
        departmentId: effectiveDept as string,
        ...(chosen?.locationId ? { locationId: chosen.locationId } : {}),
        year,
        month,
      }),
    enabled: effectiveDept !== null && chosen !== undefined,
  });
  const data = grid.data;
  // The department's HOD is never a swap target — they approve changes, not take them.
  const hodIds = useMemo(
    () => new Set((data?.members ?? []).filter((m) => m.isHod).map((m) => m.userId)),
    [data],
  );
  const candidates = useMemo(
    () =>
      chosen
        ? (data?.entries ?? []).filter(
            (e) =>
              e.date === chosen.date &&
              e.userId !== me &&
              e.state === "working" &&
              e.shiftId &&
              !hodIds.has(e.userId),
          )
        : [],
    [data, chosen, me, hodIds],
  );
  const nameOf = (userId: string) => data?.members.find((m) => m.userId === userId)?.name ?? "—";

  const submit = useMutation({
    mutationFn: () =>
      requestSwap((data as ScheduleGrid).schedule!.id, {
        requesterEntryId,
        counterpartEntryId: counterpartEntryId || null,
        note: note.trim() || undefined,
      }),
    onSuccess: () => navigate({ to: "/schedule/changes" }),
  });

  return (
    <>
      <PageHeader
        title="Request a shift change"
        description="Choose one of your shifts, optionally suggest who to swap with, and send it to your reporting manager."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void navigate({ to: "/schedule/changes" })}
          >
            Back
          </Button>
        }
      />

      <Card className="mt-2 max-w-xl p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1">
              <Field label="Department">
                {() =>
                  departments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      You are in no department at this company.
                    </p>
                  ) : (
                    <SearchableSelect
                      ariaLabel="Department"
                      value={effectiveDept ?? ""}
                      onChange={(value) => {
                        setDepartmentId(value || null);
                        setRequesterEntryId("");
                        setCounterpartEntryId("");
                      }}
                      options={deptOptions}
                      placeholder="Pick a department"
                    />
                  )
                }
              </Field>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="icon"
                onClick={() => step(-1)}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[8.5rem] text-center text-sm font-medium">
                {formatMonthYear(year, month)}
              </span>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => step(1)}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Driven by your own cells, not by whether a particular rota exists: a
              department now has one per site plus a central one, and "is there a
              schedule" is no longer a single yes or no. Having no shifts covers
              both cases a person can act on — no rota, or a rota without you. */}
          {mine.isLoading ? (
            <Spinner />
          ) : mine.error ? (
            <ErrorAlert error={mine.error} />
          ) : mineShifts.length === 0 ? (
            <Alert tone="info">
              You have no shifts to change in {formatMonthYear(year, month)}.
            </Alert>
          ) : (
            <>
              <Field label="Which shift?">
                {(props) => (
                  <Select
                    {...props}
                    value={requesterEntryId}
                    onChange={(e) => {
                      setRequesterEntryId(e.target.value);
                      setCounterpartEntryId("");
                    }}
                  >
                    <option value="">Choose a shift…</option>
                    {mineShifts.map((e) => (
                      <option key={e.entryId} value={e.entryId}>
                        {formatDate(`${e.date}T00:00:00`)} · {cellLabel(e)}
                        {/* Which rota it is on — a person on two of them would
                            otherwise see the same day twice with nothing to choose
                            between the entries. */}
                        {e.locationName ? ` · ${e.locationName}` : " · Central"}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {chosen ? (
                <Field label="Suggest swapping with (optional)">
                  {(props) => (
                    <Select
                      {...props}
                      value={counterpartEntryId}
                      onChange={(e) => setCounterpartEntryId(e.target.value)}
                    >
                      <option value="">No suggestion — let the manager choose</option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {nameOf(c.userId)} ·{" "}
                          {data?.shifts.find((sh) => sh.id === c.shiftId)?.name ?? "—"}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}

              <Field label="Note (optional)">
                {(props) => (
                  <textarea
                    {...props}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Why you need the change"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  />
                )}
              </Field>

              {submit.error ? <ErrorAlert error={submit.error} /> : null}

              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!requesterEntryId || submit.isPending}
                  onClick={() => submit.mutate()}
                >
                  Send request
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </>
  );
}
