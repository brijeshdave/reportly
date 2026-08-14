// Author: Brijesh Dave <https://github.com/brijeshdave>
// The schedule calendar: pick a department and a month, and see (or build) the roster.
// A scheduler can start a month — blank or carried forward from the one before —
// assign cells, publish to freeze the plan, and roll the whole thing into next month.
// The Scheduled/Actual toggle appears once published, so an approved swap reads as a
// difference from the plan.
import {
  PERMISSIONS,
  formatMonthYear,
  nextMonth,
  previousMonth,
  type CreateSchedule,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Lock,
  LockOpen,
  Trophy,
} from "lucide-react";
import { useState } from "react";

import { usePermission } from "@/components/can.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Select, Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchDepartments, fetchUserDepartments } from "@/services/departments.js";
import {
  createSchedule,
  fetchSchedule,
  lockSchedule,
  publishSchedule,
  unlockSchedule,
} from "@/services/shifts.js";
import { ScheduleGridView, type ScheduleView } from "@/routes/shifts/schedule-grid.js";

function flattenDepartments(
  nodes: { id: string; name: string; children?: unknown[] }[],
  depth = 0,
): { id: string; label: string }[] {
  return nodes.flatMap((node) => [
    { id: node.id, label: `${"— ".repeat(depth)}${node.name}` },
    ...flattenDepartments(
      (node.children ?? []) as { id: string; name: string; children?: unknown[] }[],
      depth + 1,
    ),
  ]);
}

export function SchedulePage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const canManage = session.isSuperadmin || usePermission(PERMISSIONS.SHIFTS_MANAGE);
  const queryClient = useQueryClient();

  const departments = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const myDepartments = useQuery({
    queryKey: ["users", "departments", session.user.id],
    queryFn: () => fetchUserDepartments(session.user.id),
  });

  const now = new Date();
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [view, setView] = useState<ScheduleView>("actual");

  // Default to the viewer's own department when they are in exactly one and are not a
  // company-wide scheduler; otherwise they pick.
  const mine = myDepartments.data ?? [];
  const defaultDept = !canManage && mine.length === 1 ? mine[0]!.departmentId : null;
  const effectiveDept = touched ? departmentId : (departmentId ?? defaultDept);
  const options = flattenDepartments(departments.data ?? []);

  const grid = useQuery({
    queryKey: ["schedule", effectiveDept, year, month],
    queryFn: () => fetchSchedule({ departmentId: effectiveDept!, year, month }),
    enabled: effectiveDept !== null,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["schedule", effectiveDept, year, month] });

  const create = useMutation({
    mutationFn: (input: CreateSchedule) => createSchedule(input),
    onSuccess: invalidate,
  });
  const publish = useMutation({
    mutationFn: (scheduleId: string) => publishSchedule(scheduleId),
    onSuccess: invalidate,
  });
  const lock = useMutation({
    mutationFn: ({ scheduleId, locked }: { scheduleId: string; locked: boolean }) =>
      locked ? lockSchedule(scheduleId) : unlockSchedule(scheduleId),
    onSuccess: invalidate,
  });

  const step = (dir: 1 | -1) => {
    const to = dir === 1 ? nextMonth(year, month) : previousMonth(year, month);
    setYear(to.year);
    setMonth(to.month);
    setView("actual");
  };

  const schedule = grid.data?.schedule ?? null;
  const published = schedule?.status === "published";
  const locked = schedule?.locked ?? false;
  // A locked schedule can only be unlocked by the department's HOD (or a superadmin).
  const isHod =
    session.isSuperadmin || mine.some((d) => d.departmentId === effectiveDept && d.rank === "hod");
  // The brush is disabled while locked — only swaps move a locked schedule.
  const canEdit = canManage && !locked;

  return (
    <>
      <PageHeader
        title="Schedule"
        description="Who works which shift, by department and month. Build a month, publish it to lock the plan, then carry it forward."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Department"
              value={effectiveDept ?? ""}
              onChange={(e) => {
                setTouched(true);
                setDepartmentId(e.target.value || null);
              }}
              className="w-48"
            >
              <option value="">Choose a department…</option>
              {options.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1 rounded-lg border border-border px-1">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => step(-1)}
                className="p-1 hover:text-foreground text-muted-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[8.5rem] text-center text-sm font-medium">
                {formatMonthYear(year, month)}
              </span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => step(1)}
                className="p-1 hover:text-foreground text-muted-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {published ? (
              <Select
                aria-label="View"
                value={view}
                onChange={(e) => setView(e.target.value as ScheduleView)}
                className="w-32"
              >
                <option value="actual">Actual</option>
                <option value="scheduled">Scheduled</option>
                <option value="changes">Changes (diff)</option>
              </Select>
            ) : null}
          </div>
        }
      />

      {effectiveDept === null ? (
        <EmptyState
          icon={Trophy}
          title="Pick a department"
          description="Choose a department above to see its schedule."
        />
      ) : grid.isLoading ? (
        <Spinner />
      ) : grid.error ? (
        <ErrorAlert error={grid.error} />
      ) : !grid.data ? null : schedule === null ? (
        <Card className="p-6">
          <EmptyState
            icon={CalendarPlus}
            title={`No schedule for ${formatMonthYear(year, month)}`}
            description={
              canManage
                ? "Start one from scratch, or carry the previous month's roster forward."
                : "This month has not been scheduled yet."
            }
          />
          {canManage ? (
            <div className="mt-4 flex justify-center gap-2">
              {create.error ? <ErrorAlert error={create.error} /> : null}
              <Button
                size="sm"
                variant="secondary"
                disabled={create.isPending}
                onClick={() => create.mutate({ departmentId: effectiveDept, year, month })}
              >
                Start blank
              </Button>
              <Button
                size="sm"
                disabled={create.isPending}
                onClick={() => {
                  const from = previousMonth(year, month);
                  create.mutate({
                    departmentId: effectiveDept,
                    year,
                    month,
                    carryForwardFrom: from,
                  });
                }}
              >
                Carry forward last month
              </Button>
            </div>
          ) : null}
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Badge tone={published ? "success" : "neutral"}>
                {published ? "Published" : "Draft"}
              </Badge>
              {locked ? (
                <Badge tone="warning">
                  <Lock className="mr-1 h-3 w-3" />
                  Locked
                </Badge>
              ) : null}
              <span className="text-muted-foreground">
                {grid.data.coverage.uncovered.length} uncovered · {grid.data.coverage.gaps.length}{" "}
                gaps
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* Lock is a scheduler's act; unlock is the HOD's alone. */}
              {locked ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!isHod || lock.isPending}
                  title={isHod ? undefined : "Only the Head of Department can unlock this"}
                  onClick={() => lock.mutate({ scheduleId: schedule.id, locked: false })}
                >
                  <LockOpen className="h-4 w-4" />
                  Unlock
                </Button>
              ) : canManage ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={lock.isPending}
                  onClick={() => lock.mutate({ scheduleId: schedule.id, locked: true })}
                >
                  <Lock className="h-4 w-4" />
                  Lock
                </Button>
              ) : null}
              {canEdit ? (
                <>
                  {!published ? (
                    <Button
                      size="sm"
                      disabled={publish.isPending}
                      onClick={() => publish.mutate(schedule.id)}
                    >
                      Publish
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={create.isPending}
                    onClick={() => {
                      const to = nextMonth(year, month);
                      create.mutate({
                        departmentId: effectiveDept,
                        year: to.year,
                        month: to.month,
                        carryForwardFrom: { year, month },
                      });
                      setYear(to.year);
                      setMonth(to.month);
                      setView("actual");
                    }}
                  >
                    <CalendarPlus className="h-4 w-4" />
                    Create next month
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          {publish.error ? <ErrorAlert error={publish.error} /> : null}
          {lock.error ? <ErrorAlert error={lock.error} /> : null}

          <ScheduleGridView
            grid={grid.data}
            view={view}
            canManage={canEdit}
            onChanged={invalidate}
          />

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" /> uncovered
              shift (hover a day for detail)
            </span>
            <span>
              {canEdit
                ? "Click days to select — Ctrl/⌘ for separate, Shift for a range, or “Add all…” a weekday — then set them together"
                : locked
                  ? "Locked — only approved swaps can change it"
                  : ""}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm ring-1 ring-amber-400" /> pending
              change
            </span>
            {published ? (
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm ring-1 ring-indigo-400" /> changed
                from plan — use the “Changes (diff)” view to see moves; hover a cell for detail
              </span>
            ) : null}
            <span className="flex items-center gap-1">
              <ArrowLeftRight className="h-3 w-3" /> request/approve under Scheduling → Shift change
            </span>
          </div>
        </div>
      )}
    </>
  );
}
